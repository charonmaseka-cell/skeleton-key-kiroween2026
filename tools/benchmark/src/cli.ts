// Chunking (all modes): --max-chars N (default 24000, the Worker limit), --max-blocks N (default 400), --overlap N blocks
// (default 0). A live run first prints a PREFLIGHT of the chunk plan and refuses to start when it cannot work.
//   --min-chunks N      refuse unless every requested document splits into at least N chunks (multi-chunk runs)
//   --preflight-only    print the plan and stop; no model, no credentials needed
//   --chunking size|output  size (default): split by characters and blocks. output: output-aware, from text and schema.
//   --values-per-request N  output-aware value budget per request (default 14; an estimate, see chunking.ts)
//   --frozen-plan FILE  use exactly the chunks recorded in FILE (refused if the document text changed)
//   --resume-from FILE  with --frozen-plan: reuse the chunks that succeeded in an earlier live result; send only the rest
//   --write-plan FILE   build the output-aware plan for --sample, write it to FILE, and stop (no model, no credentials)
//   --run-neuron-cap N  neurons this run may add, charged by conservative reservation (default 6000)
//   --daily-neuron-cap N  cumulative neurons for the day, baseline included (default 8000)
// Usage:
//   npx tsx tools/benchmark/src/cli.ts --mode mock
//   npx tsx tools/benchmark/src/cli.ts --mode live --sample scopecheck --doc quote-a --max-attempts 2
// Live mode reads CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN from the environment. They are
// never printed, logged or written to disk.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteAdmission } from './admission';
import { NeuronBudget, budgetedAi, loadDailyBaseline, worstCaseNeurons } from './budget';
import { formatPlan, planRun } from './preflight';
import { DEFAULT_MAX_VALUES, buildFrozenPlan, frozenChunker, outputChunker, sizeChunker, type Chunker, type FrozenPlan } from './chunking';
import { buildMessages } from '../../../services/extraction-api/src/profiles';
import { oracleAi, restAi, type Ai } from './ai';
import { formatSummary, runBenchmark } from './run';
import { loadSample, SAMPLES_DIR } from './samples';
import { LocalTransport, ReplayTransport, type Transport } from './transport';
import { modelConfig, withModel } from './candidates';
import { PROFILES } from '../../../services/extraction-api/src/profiles';

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) args.set(a.slice(2), argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true');
}

// Integration runs use the Worker's configured timeout (services/extraction-api/wrangler.toml, 25 s).
// Results up to and including the model comparison ran with 45 s; that setting is preserved in their records
// (docs/build-log.md) and was not stored in the result files. New results store the value used.
const WORKER_TIMEOUT_MS = 25_000;
const timeoutMs = Number(args.get('timeout-ms') ?? WORKER_TIMEOUT_MS);
const mode = args.get('mode') === 'live' ? 'live' : args.get('mode') === 'replay' ? 'replay' : 'mock';
const sampleIds = (args.get('sample') ?? 'scopecheck,packcheck').split(',');
const docFilter = args.get('doc')?.split(',');
const schemaOverrides: Record<string, string> = {};
for (const pair of (args.get('profile') ?? '').split(',').filter(Boolean)) {
  const [doc, id] = pair.split('=');
  if (!doc || !id || !PROFILES[id]) { console.error(`error: --profile expects doc=profileId with a known profile (got "${pair}")`); process.exit(1); }
  schemaOverrides[doc] = id;
}
const label = args.get('label') ?? (docFilter ? docFilter.join('+') : 'all');
const simulate = args.get('simulate-coverage') === 'true';
const intArg = (name: string, def: number, min: number, max: number) => {
  const v = Number(args.get(name) ?? def);
  if (!Number.isInteger(v) || v < min || v > max) { console.error(`error: --${name} must be an integer from ${min} to ${max}`); process.exit(1); }
  return v;
};
// The chunk limits are configuration, never a constant: a benchmark of multi-chunk behaviour must be able to set them.
const limits = { maxChars: intArg('max-chars', 24_000, 200, 100_000), maxBlocks: intArg('max-blocks', 400, 1, 2_000), overlap: intArg('overlap', 0, 0, 20) };
const minChunks = intArg('min-chunks', 1, 1, 100);
const outputParams = { ...limits, maxValues: intArg('values-per-request', DEFAULT_MAX_VALUES, 1, 60), headingContext: true };
if (args.get('write-plan')) {
  const sampleId = sampleIds[0]!;
  const plan = await buildFrozenPlan(sampleId, outputParams, schemaOverrides);
  writeFileSync(args.get('write-plan')!, JSON.stringify(plan, null, 2) + '\n');
  console.log(`plan written: ${args.get('write-plan')} (${plan.docs.map((d) => `${d.docId}: ${d.chunks.length} chunks`).join(', ')})`);
  process.exit(0);
}
let resume: Record<string, { okChunks: number[]; claims: unknown[] }> | undefined;
if (args.get('resume-from')) {
  if (!args.get('frozen-plan')) { console.error('error: --resume-from needs --frozen-plan (the chunk numbers must mean the same chunks)'); process.exit(1); }
  const prior = JSON.parse(readFileSync(args.get('resume-from')!, 'utf8')) as { requests: { docId: string; chunk: number; ok: boolean }[]; samples: { docs: { docId: string; claimsReturned?: unknown[] }[] }[] };
  resume = {};
  for (const d of prior.samples.flatMap((x) => x.docs)) resume[d.docId] = { okChunks: prior.requests.filter((r) => r.docId === d.docId && r.ok).map((r) => r.chunk), claims: d.claimsReturned ?? [] };
}
let chunker: Chunker;
if (args.get('frozen-plan')) {
  const plan = JSON.parse(readFileSync(args.get('frozen-plan')!, 'utf8')) as FrozenPlan;
  if (plan.version !== 1 || plan.sample !== sampleIds[0] || sampleIds.length !== 1) { console.error('error: --frozen-plan needs the one sample it was built for'); process.exit(1); }
  chunker = frozenChunker(plan);
} else chunker = args.get('chunking') === 'output' ? outputChunker(outputParams) : sizeChunker(limits);
const REPO = new URL('../../../', import.meta.url).pathname;
const STATE_DIR = join(REPO, '.benchmark-state');

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// Model selection is benchmark configuration only (candidates.ts). Default: the model the profiles name.
const profileModel = PROFILES['scopecheck.quote.v1']!.model;
const model = args.get('model') ?? profileModel;
if (args.has('model')) {
  if (mode !== 'live') fail('--model applies to live runs only');
  modelConfig(model); // throws for a model that is not registered as a candidate
}
let ai: Ai;
let counter: SqliteAdmission;
let attemptBudget: number;
let ceiling: number;
let neuronBudget: NeuronBudget | undefined;

if (mode === 'live') {
  const allowance = Number(args.get('max-attempts'));
  if (!Number.isInteger(allowance) || allowance < 1 || allowance > 50) fail('live mode requires --max-attempts N (1-50): the inference attempts this run may use, repairs included');
  if (!docFilter) fail('live mode requires --doc <id[,id]> so the run is limited to named documents');
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) fail('live mode needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN set as sandbox secrets (values are never printed)');
  mkdirSync(STATE_DIR, { recursive: true });
  counter = new SqliteAdmission(join(STATE_DIR, 'admission.sqlite'));
  attemptBudget = allowance;
  // Hard server-style ceiling: attempts already used today + this run's allowance.
  ceiling = counter.usedToday(Date.now()) + allowance;
  const day = new Date().toISOString().slice(0, 10);
  const statePath = join(STATE_DIR, 'live-usage.json');
  const runCap = intArg('run-neuron-cap', 6_000, 1, 10_000);
  const dailyCap = intArg('daily-neuron-cap', 8_000, 1, 10_000);
  const baseline = loadDailyBaseline(statePath, day);
  if (baseline >= dailyCap) fail(`the day's cumulative charge (${Math.round(baseline)} neurons) already reaches the daily cap (${dailyCap}). Stop here.`);
  neuronBudget = new NeuronBudget({ model, runCap, dailyCap, dailyBaseline: baseline, statePath, day });
  // Every attempt, repairs included, reserves its worst case BEFORE the call and is refused if it would pass a cap.
  ai = budgetedAi(model === profileModel ? restAi(accountId, token) : withModel(restAi(accountId, token), model), neuronBudget);
} else if (mode === 'replay') {
  counter = new SqliteAdmission(':memory:');
  attemptBudget = 1000; // not binding: replay charges nothing
  ceiling = 0;
  ai = { run: async () => { throw new Error('replay mode never calls a model'); } } as unknown as Ai;
} else {
  counter = new SqliteAdmission(':memory:');
  attemptBudget = 1000;
  ceiling = 1000;
  ai = oracleAi(sampleIds.map(loadSample));
}

// ---- preflight: before any inference ----
if (mode === 'live' || args.get('preflight-only') === 'true') {
  const plan = await planRun({
    samples: sampleIds,
    docFilter,
    schemaOverrides,
    limits,
    chunker,
    skipChunks: resume ? Object.fromEntries(Object.entries(resume).map(([k, v]) => [k, v.okChunks])) : undefined,
    timeoutMs,
    model,
    minChunks,
    attemptBudget: mode === 'live' ? attemptBudget : Number(args.get('max-attempts') ?? 16),
    runNeuronCap: mode === 'live' ? neuronBudget!.summary.runCap : Number(args.get('run-neuron-cap') ?? 6000),
    dailyHeadroom: mode === 'live' ? neuronBudget!.summary.dailyCap - neuronBudget!.summary.dailyBaseline : undefined,
  });
  console.log(formatPlan(plan));
  if (plan.problems.length) {
    console.error('No inference was attempted. Nothing was charged.');
    process.exit(2);
  }
  if (args.get('preflight-only') === 'true') process.exit(0);
}

let transport: Transport;
let replayProfiles: Record<string, string> | undefined;
if (mode === 'replay') {
  const from = args.get('from');
  if (!from) fail('replay mode requires --from <result.json[,result.json]>');
  const saved: unknown[][] = [];
  const recordedProfiles: Record<string, string> = {};
  for (const f of from.split(',')) {
    const r = JSON.parse(readFileSync(f, 'utf8')) as { samples: { docs: { docId: string; claimsReturned?: unknown[]; profile?: { id: string } }[] }[] };
    for (const sm of r.samples) for (const d of sm.docs) {
      if (!d.claimsReturned) fail(`${f} has no saved claims (older result format)`);
      saved.push(d.claimsReturned);
      if (d.profile) recordedProfiles[d.docId] = d.profile.id;
    }
  }
  transport = new ReplayTransport(saved);
  replayProfiles = recordedProfiles;
} else {
  transport = new LocalTransport({
    ai,
    counter,
    env: { DAILY_ADMISSION_CEILING: String(ceiling), MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: mode === 'live' ? String(timeoutMs) : '5000' },
  });
}

console.log(mode === 'replay' ? 'REPLAY: no model will be called' : mode === 'live' ? `LIVE: model=${model} doc(s)=${docFilter!.join(',')} attempt budget=${attemptBudget} (admission ceiling today=${ceiling})` : 'MOCK: no model will be called');
const result = await runBenchmark({
  mode,
  model: mode === 'live' ? model : mode === 'replay' ? 'replay' : 'mock-oracle',
  label,
  transport,
  sampleIds,
  docFilter,
  limits,
  chunker,
  resume,
  gate: mode === 'live' ? (schemaId, chunk) => {
    const profile = PROFILES[schemaId]!;
    return neuronBudget!.refusal(worstCaseNeurons({ messages: buildMessages(profile, chunk, false), max_tokens: profile.maxOutputTokens }, model).neurons);
  } : undefined,
  attemptBudget,
  simulateCoverageConfirmation: simulate,
  identityRecovery: args.get('no-identity-recovery') !== 'true',
  schemaOverrides,
  recordedProfiles: replayProfiles,
  measuredNeurons: args.has('measured-neurons') ? Number(args.get('measured-neurons')) : undefined,
});
console.log(formatSummary(result));

if (mode === 'replay' && result.requests.some((r) => !r.ok)) {
  console.error('error: a requested document had no saved claims; do not trust this comparison');
  process.exitCode = 4;
}
counter.close();

const outDir = join(SAMPLES_DIR, 'benchmark-results');
mkdirSync(outDir, { recursive: true });
const out = args.get('out') ?? join(outDir, `${mode}-${label}-${result.startedAt.replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ ...result, settings: mode === 'live' ? { inferenceTimeoutMs: timeoutMs, maxRepairAttempts: 1, note: 'Worker configured timeout is 25000 ms', chunkLimits: limits, resumedFrom: args.get('resume-from'), chunking: args.get('frozen-plan') ? { kind: 'frozen-plan', file: args.get('frozen-plan') } : args.get('chunking') === 'output' ? { kind: 'output-aware', ...outputParams } : { kind: 'size' }, neuronBudget: neuronBudget ? { ...neuronBudget.summary, perAttempt: neuronBudget.attempts, note: 'CHARGES against a budget (measured estimates, or the conservative reservation where usage was unknown); not dashboard-confirmed consumption' } : undefined } : undefined }, null, 2) + '\n');
console.log(`results: ${out.replace(REPO, '')}`);

// Stop conditions for live batches (see the PR): the exit code lets a caller halt the batch.
if (mode === 'live') {
  const stops: string[] = [];
  for (const r of result.requests) if (!r.ok) stops.push(`request failed: ${r.code ?? r.status} (doc ${r.docId})`);
  const observations: string[] = [];
  for (const sm of result.samples) for (const d of sm.docs) {
    // Stop: a validated value that is not supported by its own evidence, or an ambiguous value that was validated.
    if (d.extraction.outcomes.wrongly_validated > 0) stops.push(`${d.docId}: ambiguous value was validated`);
    const suspect = d.facts.filter((f) => f.audit === 'suspect');
    if (suspect.length) stops.push(`${d.docId}: ${suspect.length} validated value(s) not visible in their evidence (audit)`);
    // Observation only: validated, supported by evidence, but different from the label (for example an incomplete item name).
    if (d.extraction.outcomes.wrong_value > 0) observations.push(`${d.docId}: ${d.extraction.outcomes.wrong_value} validated value(s) differ from the label but are visible in their evidence`);
  }
  if (neuronBudget?.capReached) stops.push(`neuron cap reached (${JSON.stringify({ runCharged: neuronBudget.summary.runCharged, dailyAfter: neuronBudget.summary.dailyAfter, overruns: neuronBudget.summary.overruns })}); no further calls are allowed`);
  for (const o of observations) console.log(`OBSERVATION: ${o}`);
  if (stops.length) {
    console.log(`STOP CONDITIONS:\n - ${stops.join('\n - ')}`);
    process.exitCode = 3;
  } else console.log('stop conditions: none');
}
