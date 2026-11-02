// Usage:
//   npx tsx tools/benchmark/src/cli.ts --mode mock
//   npx tsx tools/benchmark/src/cli.ts --mode live --sample scopecheck --doc quote-a --max-attempts 2
// Live mode reads CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN from the environment. They are
// never printed, logged or written to disk.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteAdmission } from './admission';
import { oracleAi, restAi, type Ai } from './ai';
import { formatSummary, runBenchmark } from './run';
import { loadSample, SAMPLES_DIR } from './samples';
import { LocalTransport, ReplayTransport, type Transport } from './transport';
import { estimateNeurons } from './usage';
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
let statePath: string | null = null;

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
  // Account-wide free allowance is 10,000 neurons/day. Stay under a self-imposed budget using the estimate.
  const day = new Date().toISOString().slice(0, 10);
  statePath = join(STATE_DIR, 'live-usage.json');
  const state = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as { day: string; neuronsEstimated: number }) : { day, neuronsEstimated: 0 };
  const budget = Number(args.get('neuron-budget') ?? 8000);
  if (state.day === day && state.neuronsEstimated >= budget) fail(`estimated neurons used today (${Math.round(state.neuronsEstimated)}) already reach the budget (${budget}). Stop here.`);
  ai = model === profileModel ? restAi(accountId, token) : withModel(restAi(accountId, token), model);
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
  limits: { maxChars: 24_000, maxBlocks: 400 },
  attemptBudget,
  simulateCoverageConfirmation: simulate,
  identityRecovery: args.get('no-identity-recovery') !== 'true',
  schemaOverrides,
  recordedProfiles: replayProfiles,
  measuredNeurons: args.has('measured-neurons') ? Number(args.get('measured-neurons')) : undefined,
});
console.log(formatSummary(result));

if (mode === 'live' && statePath) {
  const day = new Date().toISOString().slice(0, 10);
  const prev = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as { day: string; neuronsEstimated: number }) : { day, neuronsEstimated: 0 };
  const add = result.usage.promptTokens !== null ? estimateNeurons(result.usage.promptTokens, result.usage.completionTokens ?? 0, model) : 0;
  writeFileSync(statePath, JSON.stringify({ day, neuronsEstimated: (prev.day === day ? prev.neuronsEstimated : 0) + add }));
}
if (mode === 'replay' && result.requests.some((r) => !r.ok)) {
  console.error('error: a requested document had no saved claims; do not trust this comparison');
  process.exitCode = 4;
}
counter.close();

const outDir = join(SAMPLES_DIR, 'benchmark-results');
mkdirSync(outDir, { recursive: true });
const out = args.get('out') ?? join(outDir, `${mode}-${label}-${result.startedAt.replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ ...result, settings: mode === 'live' ? { inferenceTimeoutMs: timeoutMs, maxRepairAttempts: 1, note: 'Worker configured timeout is 25000 ms' } : undefined }, null, 2) + '\n');
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
  for (const o of observations) console.log(`OBSERVATION: ${o}`);
  if (stops.length) {
    console.log(`STOP CONDITIONS:\n - ${stops.join('\n - ')}`);
    process.exitCode = 3;
  } else console.log('stop conditions: none');
}
