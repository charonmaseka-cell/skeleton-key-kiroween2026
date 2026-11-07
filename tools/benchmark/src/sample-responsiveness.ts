// Responsiveness of the bundled SAMPLE path, measured on its own. Sample mode keeps the extraction CACHED (source blocks and
// the recorded claims in samples/fixtures) and EXECUTES the checks afresh every time: claim validation, item identity,
// matching, rules, the comparison ledger, review state and the export model. No model is called and nothing is sent.
//
// This is NOT a measure of live processing. Live processing is dominated by model requests (minutes; see
// docs/results/sc-t4-scopecheck-baseline.md). Numbers here are Node on a development machine, one process, no rendering: they bound the
// computation, not what a browser shows. Run: npx tsx tools/benchmark/src/sample-responsiveness.ts [--write FILE]
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluateSession, emptySession, buildLiveFixture, type DomainAdapter, type Fixture } from '@skeleton-key/ui';
import { scopeCheckAdapter } from '../../../apps/scopecheck/src/adapter';
import { packCheckAdapter } from '../../../apps/packcheck/src/adapter';
import { FIXTURES as SCOPE } from '../../../apps/scopecheck/src/fixtures';
import { FIXTURES as PACK } from '../../../apps/packcheck/src/fixtures';
import { parsePdf } from '@skeleton-key/ingest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const WARM_RUNS = 100;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;
const r1 = (n: number) => Math.round(n * 10) / 10;

function measure(name: string, adapter: DomainAdapter, fx: Fixture) {
  const t0 = performance.now();
  const first = evaluateSession(adapter, fx, emptySession(), 1);
  const cold = performance.now() - t0;
  const warm: number[] = [];
  for (let i = 0; i < WARM_RUNS; i++) {
    const t = performance.now();
    evaluateSession(adapter, fx, emptySession(), 1);
    warm.push(performance.now() - t);
  }
  const claims = fx.docs.reduce((n, d) => n + d.claims.length, 0);
  return { name, docs: fx.docs.length, blocks: fx.docs.reduce((n, d) => n + d.blocks.length, 0), claims, findings: first.items.length, firstRunMs: r1(cold), warmMedianMs: r1(pct(warm, 50)), warmP95Ms: r1(pct(warm, 95)), warmMaxMs: r1(Math.max(...warm)) };
}

const rows = [
  ...SCOPE.map((f) => measure(`ScopeCheck sample: ${f.id}`, scopeCheckAdapter, f)),
  ...PACK.map((f) => measure(`PackCheck sample: ${f.id}`, packCheckAdapter, f)),
];

// Scale check: the three full-length documents (239 saved claims, 232 blocks) through the same code path.
const RESULTS = new URL('../../../samples/benchmark-results/', import.meta.url).pathname;
const baselineFile = readdirSync(RESULTS).find((f) => f.startsWith('live-sc-t4-quote-b-'));
if (baselineFile) {
  const saved = JSON.parse(readFileSync(join(RESULTS, baselineFile), 'utf8')) as { samples: { docs: { docId: string; claimsReturned: unknown[] }[] }[] };
  const docs = [];
  for (const id of ['rfq', 'quote-a', 'quote-b']) {
    const blocks = await parsePdf(new Uint8Array(readFileSync(new URL(`../../../samples/scopecheck-realistic/${id}.pdf`, import.meta.url))), id);
    const claims = saved.samples[0]!.docs.find((d) => d.docId === id)!.claimsReturned;
    docs.push({ id, role: id === 'rfq' ? 'rfq' : 'quote', fileName: `${id}.pdf`, profile: id === 'rfq' ? 'scopecheck.rfq.v1' : 'scopecheck.quote.v1', result: { docId: id, blocks, claims, chunks: [{ index: 0, blockIds: blocks.map((b) => b.id), status: 'ok' as const, claims: claims.length }] } });
  }
  rows.push(measure('ScopeCheck full-length (saved responses, same code path)', scopeCheckAdapter, buildLiveFixture(docs)));
}

console.table(rows);
if (process.argv.includes('--write')) writeFileSync(process.argv[process.argv.indexOf('--write') + 1]!, JSON.stringify({ measuredAt: new Date().toISOString(), runtime: process.version, warmRuns: WARM_RUNS, note: 'Node, one process, no rendering; computation only', rows }, null, 2) + '\n');
