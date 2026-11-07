// Scores a recorded set of claims for the SC-T12 fresh set with the app's own rules (evaluateSession) and the benchmark's own scorers.
// Run from the repository root (the UI package needs its own JSX settings):
//   npx tsx --tsconfig packages/ui/tsconfig.json tools/benchmark/src/score-fresh.ts <result.json>
import { readFileSync } from 'node:fs';
import { emptySession, evaluateSession, type Fixture } from '@skeleton-key/ui';
import { scopeCheckAdapter } from '../../../apps/scopecheck/src/adapter';
import { loadBlocks, loadSample } from './samples';
import { scoreExtraction, scoreFindings } from './score';

const file = process.argv[2]!;
const profileOf: Record<string, string> = JSON.parse(process.argv[3] ?? '{}');
const sample = loadSample('scopecheck-fresh');
const rec = JSON.parse(readFileSync(file, 'utf8')) as { samples: { docs: { docId: string; profile?: { id: string }; claimsReturned: unknown[] }[] }[] };
const byDoc = new Map(rec.samples.flatMap((s) => s.docs).map((d) => [d.docId, d]));
const docs = [];
const blocksBy: Record<string, Awaited<ReturnType<typeof loadBlocks>>> = {};
for (const d of sample.docs) {
  const blocks = await loadBlocks('scopecheck-fresh', d);
  blocksBy[d.id] = blocks;
  const r = byDoc.get(d.id)!;
  const legacy = blocks.map((b) => { const x: Record<string, unknown> = { ...b }; delete x.parser; delete x.layout; delete x.cells; return x; });
  docs.push({ id: d.id, role: d.role, title: d.id, profile: profileOf[d.id] ?? r.profile?.id ?? d.schemaId, recordedIn: file, blocks: legacy, claims: r.claimsReturned });
}
const fixture = { id: 'fresh', title: 'fresh', description: '', sample: true, label: 'Sample (fictional)', extraction: { model: 'x', note: '' }, docs } as unknown as Fixture;
const v = evaluateSession(scopeCheckAdapter, fixture, emptySession(), 1);
const findings = v.items.map((i) => i.finding);
const exclusionBlocks: Record<string, Set<string>> = {};
for (const d of sample.docs) {
  const rows = new Set(d.facts.filter((f) => f.field === 'exclusion').map((f) => d.lines[f.line]));
  exclusionBlocks[d.id] = new Set(blocksBy[d.id]!.filter((b) => rows.has(b.text)).map((b) => b.id));
}
const f = scoreFindings(findings, sample.expectedFindings, { coverageConfirmed: false, mustNotFlag: sample.mustNotFlag, exclusionBlocks });
const out: Record<string, unknown> = {
  profiles: Object.fromEntries(docs.map((d) => [d.id, d.profile])),
  findings: { expected: f.expected, produced: f.produced, exact: f.matchedExactState, conservative: f.conservative, missed: f.missed, falseCritical: f.falseCritical, overConfident: f.overConfident, unexpected: f.unexpectedOther },
  comparisons: { planned: v.exportModel.comparisons.planned, agree: v.exportModel.comparisons.agree, flagged: v.exportModel.comparisons.flagged, notEvaluated: v.exportModel.comparisons.notEvaluated },
  priceFindings: findings.filter((x) => /^price\./.test(x.code)).map((x) => `${x.code}|${x.subjectId}|${x.responseDocId}|${x.state}`),
  lineTotals: Object.fromEntries(docs.map((d) => [d.id, (d.claims as { field: string }[]).filter((c) => c.field === 'line_total').length])),
  claims: Object.fromEntries(docs.map((d) => [d.id, (d.claims as unknown[]).length])),
  extraction: {} as Record<string, unknown>,
};
for (const d of sample.docs) {
  const facts = [...v.effective.values()].filter((e) => e.fact.docId === d.id).map((e) => e.fact);
  const s = scoreExtraction(d, blocksBy[d.id]!, facts) as unknown as Record<string, unknown>;
  (out.extraction as Record<string, unknown>)[d.id] = { labels: s.labels ?? s.expected, counts: s.counts ?? s.outcomes ?? s };
}
console.log(JSON.stringify(out, null, 1));
