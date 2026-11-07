// The SC-T12 fresh set, ONE run through the production Worker, quotations under scopecheck.quote.v2 (tender stays rfq.v1).
// Foreground, concurrency 1, one attempt per part. Rules (owner, 5 Nov):
//  - hard stop at 5,000 settled neurons, and nothing is sent if the run's hold (computed here exactly as the Worker computes it) is over 5,000
//    or does not fit the day's remaining headroom;
//  - a run is NEVER cut partway for budget: the hold already bounds its spend, so there is no mid-run budget abort;
//  - any failed request stops further sending (the Worker's own run keeps what was done); nothing is retried;
//  - the UTC date must match RUN_DAY_UTC (default 2026-11-08), so a run is always a deliberate choice of day and the headroom is known.
// Run from the repository root: RUN_DAY_UTC=<today> npx tsx --tsconfig packages/ui/tsconfig.json tools/benchmark/src/fresh-run-via-worker.ts [--dry-run]
// Claims are written byte for byte; no rule, label or plan is touched.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePdf } from '@skeleton-key/ingest';
import { analyseAll, newClientSession, planEntry, type ClientConfig } from '../../../packages/ui/src/extraction-client';
import { chunkForSchema } from '../../../packages/ui/src/schema-fields';
import { getProfile } from '../../../services/extraction-api/src/profiles';
import { plannedNeurons } from '../../../services/extraction-api/src/run-plan';

const WORKER = 'https://skeleton-key-extraction.teddykgroup.workers.dev';
const ORIGIN = 'https://skeleton-key-scopecheck.pages.dev';
const REPO = new URL('../../../', import.meta.url).pathname;
const HARD_STOP = 5_000;
const DAY = process.env.RUN_DAY_UTC ?? '2026-11-08';
const DRY = process.argv.includes('--dry-run');
const DOCS = [
  { docId: 'rfq', schemaId: 'scopecheck.rfq.v1' },
  { docId: 'quote-a', schemaId: 'scopecheck.quote.v2' },
  { docId: 'quote-b', schemaId: 'scopecheck.quote.v2' },
];
type Budget = { attempts: number; charged: number; unsettled: number; overruns: number };
async function health() {
  const j = (await (await fetch(`${WORKER}/health`, { signal: AbortSignal.timeout(20_000) })).json()) as { checks: { durableObject: { budgetToday: Budget }; admission: { open: boolean; dailyCeiling: number; dailyNeuronBudget: number } } };
  return { b: j.checks.durableObject.budgetToday, a: j.checks.admission };
}

const docs = [];
for (const d of DOCS) docs.push({ ...d, blocks: await parsePdf(new Uint8Array(readFileSync(join(REPO, 'samples/scopecheck-fresh', `${d.docId}.pdf`))), d.docId) });

// The run's hold, computed exactly as the Worker prices it (worst case of every part at its enforced output cap).
let hold = 0;
const plan: { doc: string; blocks: number; schemaId: string; bodyBytes: number; values: number; neurons: number }[] = [];
for (const d of docs) {
  const { chunks, oversized } = chunkForSchema(d.schemaId, d.blocks);
  if (oversized.length) throw new Error(`${d.docId}: oversized blocks`);
  for (const c of chunks) {
    const e = planEntry(d.schemaId, c);
    const n = plannedNeurons(getProfile(d.schemaId)!, e)!.neurons;
    hold += n;
    plan.push({ doc: d.docId, blocks: c.length, ...e, neurons: Number(n.toFixed(3)) });
  }
}
hold = Number(hold.toFixed(3));
const h0 = await health();
const remaining = Number((h0.a.dailyNeuronBudget - h0.b.charged).toFixed(3));
console.log(JSON.stringify({ utcNow: new Date().toISOString(), plannedParts: plan.length, perDoc: Object.fromEntries(DOCS.map((d) => [d.docId, plan.filter((p) => p.doc === d.docId).length])), holdNeurons: hold, hardStop: HARD_STOP, remainingToday: remaining, attemptsLeft: h0.a.dailyCeiling - h0.b.attempts, ledgerToday: h0.b }, null, 1));
if (DRY) process.exit(0);

const today = new Date().toISOString().slice(0, 10);
if (today !== DAY) throw new Error(`not sending: today is ${today} UTC, the owner named ${DAY}`);
if (!h0.a.open) throw new Error('admission is closed');
if (hold > HARD_STOP) throw new Error(`not sending: the hold ${hold} is over the hard stop ${HARD_STOP}`);
if (hold > remaining) throw new Error(`not sending: the hold ${hold} does not fit the remaining headroom ${remaining}`);
if (h0.b.attempts !== 0 || h0.b.charged !== 0) console.log('NOTE: the day already has usage; headroom is not the full allowance');

let failedRequest: string | null = null;
const ctrl = new AbortController();
const fetchImpl = (async (url: string, init: RequestInit) => {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), origin: ORIGIN } });
  if (res.status !== 200 && failedRequest === null) {
    failedRequest = `${String(url).replace(WORKER, '')} -> HTTP ${res.status}`;
    ctrl.abort();
  }
  return res;
}) as unknown as typeof fetch;
const cfg: ClientConfig = { baseUrl: WORKER, fetchImpl, concurrency: 1 };
const out = await analyseAll(cfg, newClientSession(), docs, { signal: ctrl.signal, onProgress: (id, done, total) => console.log(`  ${id}: ${done}/${total}`), onAdmitted: (i) => console.log('admitted:', JSON.stringify(i)) });
const h1 = await health();
const settled = Number((h1.b.charged - h0.b.charged).toFixed(3));
const report = { settledNeurons: settled, attempts: h1.b.attempts - h0.b.attempts, overruns: h1.b.overruns - h0.b.overruns, unsettled: h1.b.unsettled, failedRequest, stoppedBy: out.stoppedBy, hold, plan, remainingAfter: Number((h1.a.dailyNeuronBudget - h1.b.charged).toFixed(3)), attemptsLeftAfter: h1.a.dailyCeiling - h1.b.attempts, docs: out.results.map((r) => ({ docId: r.docId, chunks: r.chunks.map((c) => c.status + (c.error ? `:${c.error}` : '')), claims: r.claims.length })) };
writeFileSync(join(REPO, '.benchmark-state', 'fresh-v2-result.json') /* local scratch, not committed */, JSON.stringify(report, null, 2) + '\n');
console.log('RESULT', JSON.stringify(report, null, 1));
if (settled > HARD_STOP) console.log(`!! settled ${settled} is over the hard stop ${HARD_STOP}`);
if (failedRequest || out.stoppedBy || !out.results.every((r) => r.chunks.length > 0 && r.chunks.every((c) => c.status === 'ok'))) {
  console.error('NOT RECORDED: a part did not come back ok. Report and stop.');
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rec = {
  kind: 'production-worker-recording', mode: 'live', label: 'sc-t12-fresh-quote-v2', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', startedAt: new Date().toISOString(),
  provenance: { note: 'One run of the SC-T12 fresh set through the production public Worker: tender under scopecheck.rfq.v1, quotations under scopecheck.quote.v2 (adds line_total). concurrency 1, one attempt per part, claims unedited. The accepted v1 recording (live-sc-t12-fresh-resume2-*) is unchanged.', worker: WORKER, hold, settledNeurons: settled, plan, pdfSha256: Object.fromEntries(DOCS.map((d) => [d.docId, createHash('sha256').update(readFileSync(join(REPO, 'samples/scopecheck-fresh', `${d.docId}.pdf`))).digest('hex')])) },
  samples: [{ sampleId: 'scopecheck-fresh', docs: out.results.map((r) => ({ docId: r.docId, profile: { id: DOCS.find((d) => d.docId === r.docId)!.schemaId, source: 'recorded' }, claimsReturned: r.claims })) }],
};
const file = join('samples', 'benchmark-results', `live-sc-t12-fresh-quote-v2-${stamp}.json`);
if (existsSync(join(REPO, file))) throw new Error('refusing to overwrite a recording');
writeFileSync(join(REPO, file), JSON.stringify(rec, null, 2) + '\n');
console.log('RECORDED', file);
