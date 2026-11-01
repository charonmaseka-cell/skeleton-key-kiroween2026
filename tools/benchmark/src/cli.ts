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
import { LocalTransport } from './transport';
import { estimateNeurons } from './usage';
import { PROFILES } from '../../../services/extraction-api/src/profiles';

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) args.set(a.slice(2), argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true');
}

const mode = args.get('mode') === 'live' ? 'live' : 'mock';
const sampleIds = (args.get('sample') ?? 'scopecheck,packcheck').split(',');
const docFilter = args.get('doc')?.split(',');
const label = args.get('label') ?? (docFilter ? docFilter.join('+') : 'all');
const simulate = args.get('simulate-coverage') === 'true';
const REPO = new URL('../../../', import.meta.url).pathname;
const STATE_DIR = join(REPO, '.benchmark-state');

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const model = PROFILES['scopecheck.quote.v1']!.model;
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
  ai = restAi(accountId, token);
} else {
  counter = new SqliteAdmission(':memory:');
  attemptBudget = 1000;
  ceiling = 1000;
  ai = oracleAi(sampleIds.map(loadSample));
}

const transport = new LocalTransport({
  ai,
  counter,
  env: { DAILY_ADMISSION_CEILING: String(ceiling), MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: mode === 'live' ? '45000' : '5000' },
});

console.log(mode === 'live' ? `LIVE: model=${model} doc(s)=${docFilter!.join(',')} attempt budget=${attemptBudget} (admission ceiling today=${ceiling})` : 'MOCK: no model will be called');
const result = await runBenchmark({
  mode,
  model: mode === 'live' ? model : 'mock-oracle',
  label,
  transport,
  sampleIds,
  docFilter,
  limits: { maxChars: 24_000, maxBlocks: 400 },
  attemptBudget,
  simulateCoverageConfirmation: simulate,
  measuredNeurons: args.has('measured-neurons') ? Number(args.get('measured-neurons')) : undefined,
});
console.log(formatSummary(result));

if (mode === 'live' && statePath) {
  const day = new Date().toISOString().slice(0, 10);
  const prev = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as { day: string; neuronsEstimated: number }) : { day, neuronsEstimated: 0 };
  const add = result.usage.promptTokens !== null ? estimateNeurons(result.usage.promptTokens, result.usage.completionTokens ?? 0) : 0;
  writeFileSync(statePath, JSON.stringify({ day, neuronsEstimated: (prev.day === day ? prev.neuronsEstimated : 0) + add }));
}
counter.close();

const outDir = join(SAMPLES_DIR, 'benchmark-results');
mkdirSync(outDir, { recursive: true });
const out = args.get('out') ?? join(outDir, `${mode}-${label}-${result.startedAt.replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(`results: ${out.replace(REPO, '')}`);
