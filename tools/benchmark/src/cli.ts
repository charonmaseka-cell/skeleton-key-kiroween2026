// Chunking (all modes): --max-chars N (default 24000, the Worker limit), --max-blocks N (default 400), --overlap N blocks
// (default 0). A live run first prints a PREFLIGHT of the chunk plan and refuses to start when it cannot work.
//   --min-chunks N      refuse unless every requested document splits into at least N chunks (multi-chunk runs)
//   --preflight-only    print the plan and stop; no model, no credentials needed
//   --chunking size|output  size (default): split by characters and blocks. output: output-aware, from text and schema.
//   --values-per-request N  output-aware value budget per request (default 14; an estimate, see chunking.ts)
//   --frozen-plan FILE  use exactly the chunks recorded in FILE (refused if the document text changed)
//   --resume-from FILE  with --frozen-plan: reuse the chunks that succeeded in an earlier live result; send only the rest
//   --concurrency N     requests in flight at once for a document, 1 to 3 (default 1). Reservations are claimed atomically.
//   --max-repairs N     repairs the Worker may make per request, 0 or 1 (default 1); in-flight requests are budgeted for them
//   --batch-id ID       live: one allowance shared by every invocation of the batch (a first run, a resume, a retry). Create it with
//                       --batch-attempts N --batch-neurons N; the caps are then FIXED and cannot be raised or reset on resume. The
//                       attempts and estimated neurons already used are subtracted; chunks that succeeded in earlier invocations are reused
//                       and never resent. Do not combine with --max-attempts or --run-neuron-cap.
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
import { NeuronBudget, budgetedAi, loadDailyBaseline, requestClaim } from './budget';
import { formatPlan, planRun } from './preflight';
import { DEFAULT_MAX_VALUES, buildFrozenPlan, frozenChunker, outputChunker, sizeChunker, type Chunker, type FrozenPlan } from './chunking';
import { oracleAi, restAi, type Ai } from './ai';
import { Batch, batchAi } from './batch';
import { recordingAi } from './recording';
import { AUDIT_VERSION, formatSummary, runBenchmark } from './run';
import { LEGACY_PARSER_VERSION, PARSER_VERSION } from '@skeleton-key/ingest';
import { scopeRule } from '../../../apps/scopecheck/src/adapter/rules';
import { loadSample, SAMPLES_DIR } from './samples';
import { LocalTransport, ReplayTransport, type Transport } from './transport';
import { modelConfig, withModel } from './candidates';
import { PROFILES } from '../../../services/extraction-api/src/profiles';

const processStart = Date.now();
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
const concurrency = intArg('concurrency', 1, 1, 3);
const maxRepairs = intArg('max-repairs', 1, 0, 1);
const outputParams = { ...limits, maxValues: intArg('values-per-request', DEFAULT_MAX_VALUES, 1, 60), headingContext: true };
if (args.get('write-plan')) {
  const sampleId = sampleIds[0]!;
  const plan = await buildFrozenPlan(sampleId, outputParams, schemaOverrides);
  writeFileSync(args.get('write-plan')!, JSON.stringify(plan, null, 2) + '\n');
  console.log(`plan written: ${args.get('write-plan')} (${plan.docs.map((d) => `${d.docId}: ${d.chunks.length} chunks`).join(', ')})`);
  process.exit(0);
}
let resume: Record<string, { okChunks: number[]; claims: unknown[] }> | undefined;
// A batch (live) keeps one allowance across invocations. It is opened here, before anything is planned, so that the chunks its
// earlier invocations completed are reused and the attempts and neurons they used are already subtracted.
const REPO_ROOT = new URL('../../../', import.meta.url).pathname;
let batch: Batch | undefined;
if (args.get('batch-id')) {
  if (mode !== 'live') { console.error('error: --batch-id applies to live runs only'); process.exit(1); }
  if (args.has('max-attempts') || args.has('run-neuron-cap')) { console.error('error: with --batch-id the allowance comes from the batch; do not pass --max-attempts or --run-neuron-cap'); process.exit(1); }
  const caps = args.has('batch-attempts') || args.has('batch-neurons') ? { attempts: Number(args.get('batch-attempts')), neurons: Number(args.get('batch-neurons')) } : undefined;
  try {
    batch = Batch.open(join(REPO_ROOT, '.benchmark-state', 'batches', `${args.get('batch-id')}.json`), args.get('batch-id')!, caps);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
}
const resumeFiles = [...(batch?.state.resultFiles ?? []), ...(args.get('resume-from')?.split(',') ?? [])];
if (resumeFiles.length) {
  if (!args.get('frozen-plan')) { console.error('error: resuming needs --frozen-plan (the chunk numbers must mean the same chunks)'); process.exit(1); }
  resume = {};
  // Several files may be given; a later file replaces an earlier one for the same document (a resumed result already carries the earlier chunks).
  for (const file of resumeFiles) {
    const prior = JSON.parse(readFileSync(file.startsWith('/') ? file : join(REPO_ROOT, file), 'utf8')) as { requests: { docId: string; chunk: number; ok: boolean }[]; samples: { docs: { docId: string; claimsReturned?: unknown[] }[] }[] };
    for (const d of prior.samples.flatMap((x) => x.docs)) resume[d.docId] = { okChunks: prior.requests.filter((r) => r.docId === d.docId && r.ok).map((r) => r.chunk), claims: d.claimsReturned ?? [] };
  }
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
let rawLogFile: string | undefined;

if (mode === 'live') {
  const allowance = batch ? batch.remainingAttempts : Number(args.get('max-attempts'));
  if (!Number.isInteger(allowance) || allowance < 1 || allowance > 50) fail(batch ? `batch ${batch.state.id} has no attempts left (${batch.state.attemptsUsed} of ${batch.state.attemptCap} used)` : 'live mode requires --max-attempts N (1-50): the inference attempts this run may use, repairs included');
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
  const runCap = batch ? batch.remainingNeurons : intArg('run-neuron-cap', 6_000, 1, 10_000);
  if (!(runCap > 0)) fail(`batch has no estimated neurons left (${batch?.state.neuronsCharged} of ${batch?.state.neuronCap} used)`);
  const dailyCap = intArg('daily-neuron-cap', 8_000, 1, 10_000);
  const baseline = loadDailyBaseline(statePath, day);
  if (baseline >= dailyCap) fail(`the day's cumulative charge (${Math.round(baseline)} neurons) already reaches the daily cap (${dailyCap}). Stop here.`);
  neuronBudget = new NeuronBudget({ model, runCap, dailyCap, dailyBaseline: baseline, statePath, day });
  // Raw model responses are appended to a file as they arrive (see recording.ts).
  mkdirSync(join(SAMPLES_DIR, 'benchmark-results'), { recursive: true });
  rawLogFile = join(SAMPLES_DIR, 'benchmark-results', `raw-${label}-${new Date(processStart).toISOString().replace(/[:.]/g, '-')}.jsonl`);
  // The override is applied OUTSIDE the recorder, so the raw log names the model that was actually called (before 2 Nov 2026 it
  // named the profile's model, because the recorder sat inside the override).
  const raw = model === profileModel ? recordingAi(restAi(accountId, token), rawLogFile) : withModel(recordingAi(restAi(accountId, token), rawLogFile), model);
  // Every attempt, repairs included, reserves its worst case BEFORE the call and is refused if it would pass a cap.
  if (batch) {
    batch.begin(label);
    ai = batchAi(raw, batch, (inner) => budgetedAi(inner, neuronBudget!), () => neuronBudget!);
  } else ai = budgetedAi(raw, neuronBudget);
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
  const plan = args.get('frozen-plan') ? (JSON.parse(readFileSync(args.get('frozen-plan')!, 'utf8')) as FrozenPlan) : undefined;
  for (const f of from.split(',')) {
    const r = JSON.parse(readFileSync(f, 'utf8')) as { samples: { docs: { docId: string; claimsReturned?: unknown[]; profile?: { id: string } }[] }[] };
    for (const sm of r.samples) for (const d of sm.docs) {
      if (docFilter && !docFilter.includes(d.docId)) continue;
      if (!d.claimsReturned) fail(`${f} has no saved claims (older result format)`);
      // With a frozen plan the saved claims of a document are split back into the requests they came from (by the
      // chunk's own block ids), so the replay has the same chunks, and so the same coverage record, as the live run.
      const pd = plan?.docs.find((x) => x.docId === d.docId);
      if (pd) for (const c of pd.chunks) saved.push(d.claimsReturned.filter((cl) => c.blockIds.includes((cl as { blockId?: string }).blockId ?? '')));
      else saved.push(d.claimsReturned);
      if (d.profile) recordedProfiles[d.docId] = d.profile.id;
    }
  }
  transport = new ReplayTransport(saved);
  replayProfiles = recordedProfiles;
} else {
  transport = new LocalTransport({
    ai,
    counter,
    env: { DAILY_ADMISSION_CEILING: String(ceiling), MAX_REPAIR_ATTEMPTS: String(maxRepairs), INFERENCE_TIMEOUT_MS: mode === 'live' ? String(timeoutMs) : '5000' },
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
  concurrency,
  maxRepairAttempts: maxRepairs,
  // live stop conditions: a stopping service error, an unrecovered schema error, an unsupported value accepted as validated, or
  // a budget refusal each end the sending. Labels play no part in any of them.
  stopOnServiceErrors: mode === 'live',
  stopOnSchemaError: mode === 'live',
  stopOnUnsupportedValue: mode === 'live',
  stopOnBudget: mode === 'live',
  // an atomic claim, made in the same synchronous step as the check, just before each request is dispatched
  claim: mode === 'live' ? requestClaim(neuronBudget!, model) : undefined,
  attemptBudget,
  simulateCoverageConfirmation: simulate,
  identityRecovery: args.get('no-identity-recovery') !== 'true',
  schemaOverrides,
  recordedProfiles: replayProfiles,
  measuredNeurons: args.has('measured-neurons') ? Number(args.get('measured-neurons')) : undefined,
});
// A call can outlive the Worker's timeout: wait (bounded) for it to settle so its reported usage is charged before the
// ledger and the result are written. A call still outstanding keeps its reservation.
if (neuronBudget) {
  const idle = await neuronBudget.whenIdle(35_000);
  if (!idle) console.log(`WARNING: ${neuronBudget.outstanding.size} model call(s) still outstanding; their reservations stand and may be settled later`);
  batch?.syncNeurons(neuronBudget.runTotal);
}
const finishedAt = new Date().toISOString();
console.log(formatSummary(result));

if (mode === 'replay' && result.requests.some((r) => !r.ok)) {
  console.error('error: a requested document had no saved claims; do not trust this comparison');
  process.exitCode = 4;
}
counter.close();

const outDir = join(SAMPLES_DIR, 'benchmark-results');
mkdirSync(outDir, { recursive: true });
const out = args.get('out') ?? join(outDir, `${mode}-${label}-${result.startedAt.replace(/[:.]/g, '-')}.json`);
const replayInfo = mode === 'replay' ? {
  note: 'OFFLINE REPLAY of saved model responses. No model was called. The responses are NOT results of the parser, rules or audit named under rescoredWith: they were produced earlier, from the text of the parser named under responsesProducedWith.',
  source: args.get('from')!.split(','),
  responsesProducedWith: { parser: LEGACY_PARSER_VERSION, note: 'text lines only; no cell metadata (a result file without a parser field was made by ingest/1)' },
  rescoredWith: { parser: PARSER_VERSION, scopeRuleVersion: scopeRule.version, auditVersion: AUDIT_VERSION, chunkPlan: args.get('frozen-plan') ?? 'size-only default' },
} : undefined;
writeFileSync(out, JSON.stringify({ ...result, replay: replayInfo, finishedAt, wallClockMs: Date.now() - processStart, auditVersion: AUDIT_VERSION, settings: mode === 'live' ? { inferenceTimeoutMs: timeoutMs, maxRepairAttempts: 1, note: 'Worker configured timeout is 25000 ms', chunkLimits: limits, resumedFrom: args.get('resume-from'), chunking: args.get('frozen-plan') ? { kind: 'frozen-plan', file: args.get('frozen-plan') } : args.get('chunking') === 'output' ? { kind: 'output-aware', ...outputParams } : { kind: 'size' }, rawResponses: rawLogFile ? rawLogFile.replace(REPO, '') : undefined, batch: batch?.state, neuronBudget: neuronBudget ? { ...neuronBudget.summary, perAttempt: neuronBudget.attempts, note: 'CHARGES against a budget (measured estimates, or the conservative reservation where usage was unknown); not dashboard-confirmed consumption' } : undefined } : undefined }, null, 2) + '\n');
console.log(`results: ${out.replace(REPO, '')}`);
if (batch) {
  batch.end(out.replace(REPO, ''), result.summary.stop?.reason ?? null);
  // the batch state lives in the (git-ignored) state directory; keep a copy with the results
  writeFileSync(join(outDir, `batch-${batch.state.id}.json`), JSON.stringify(batch.state, null, 2) + '\n');
  console.log(`batch ${batch.state.id}: ${batch.state.attemptsUsed} of ${batch.state.attemptCap} attempts, ${Math.round(batch.state.neuronsCharged * 10) / 10} of ${batch.state.neuronCap} estimated neurons used`);
}

// Stop conditions for live batches. What STOPS sending is decided inside the runner, request by request, never from labels: a
// stopping service error, an unrecovered schema error, an unsupported value accepted as validated, a budget refusal. Everything
// that compares with labels (a value different from its label, a conservative hold, a miss) is an observation only.
if (mode === 'live') {
  const stops: string[] = [];
  const stop = result.summary.stop;
  if (stop) stops.push(`${stop.reason} at ${stop.docId}#${stop.chunk}${stop.detail ? `: ${stop.detail}` : ''}; no later chunk was sent`);
  if (neuronBudget?.capReached) stops.push(`neuron cap reached (${JSON.stringify({ runCharged: neuronBudget.summary.runCharged, dailyAfter: neuronBudget.summary.dailyAfter, overruns: neuronBudget.summary.overruns })}); no further calls are allowed`);
  for (const r of result.requests) if (!r.ok && !r.code?.startsWith('stopped_after_') && !r.reused) console.log(`FAILED REQUEST: ${r.docId}#${r.chunk} ${r.code ?? r.status}`);
  for (const sm of result.samples) for (const d of sm.docs) {
    const o = d.extraction.outcomes;
    const parts = [`${o.correct} correct`, `${o.wrong_value} differ from label but visible in evidence`, `${o.correct_conservative + o.held_for_review} held`, `${o.missed} missed`, `${o.wrongly_validated} validated against a label that wanted review`];
    console.log(`OBSERVATION: ${d.docId}: ${parts.join(', ')}`);
  }
  if (stops.length) {
    console.log(`STOP CONDITIONS:\n - ${stops.join('\n - ')}`);
    process.exitCode = 3;
  } else {
    console.log('stop conditions: none');
    if (result.requests.some((r) => !r.ok && !r.reused)) process.exitCode = 3;
  }
}
