// Compares two models on the eight fictional documents from SAVED responses. No model is called.
// Both models go through the same replay path (same chunks, profiles, validators, identity
// resolver, strict scoring), so the only difference is the model that produced the responses.
//
//   npx tsx tools/benchmark/src/compare-models.ts
//
// Criteria are in docs/model-comparison.md (written before the second model was run).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBenchmark, type BenchmarkResult, type DocResult } from './run';
import { loadSample, SAMPLES_DIR } from './samples';
import { ReplayTransport } from './transport';
import { BASELINE_MODEL, SECOND_CANDIDATE } from './candidates';

const DIR = join(SAMPLES_DIR, 'benchmark-results');

type DocSpec = { doc: string; sample: string; base: string; cand: string };
const DOCS: DocSpec[] = [
  { doc: 'rfq', sample: 'scopecheck', base: 'live-repeat-rfq-2026', cand: 'live-m8b-rfq-2026' },
  { doc: 'quote-a', sample: 'scopecheck', base: 'live-repeat-quote-a-2026', cand: 'live-m8b-quote-a-2026' },
  { doc: 'quote-b', sample: 'scopecheck', base: 'live-quote-b-2026', cand: 'live-m8b-quote-b-2026' },
  { doc: 'quote-c', sample: 'scopecheck-layout', base: 'live-layout-quote-c-2026', cand: 'live-m8b-quote-c-2026' },
  { doc: 'requirements', sample: 'packcheck', base: 'live-packcheck-requirements-2026', cand: 'live-m8b-packcheck-requirements-2026' },
  { doc: 'application-form', sample: 'packcheck', base: 'live-packcheck-application-form-v2-2026', cand: 'live-m8b-packcheck-application-form-2026' },
  { doc: 'budget', sample: 'packcheck', base: 'live-packcheck-budget-2026', cand: 'live-m8b-packcheck-budget-2026' },
  { doc: 'registration', sample: 'packcheck', base: 'live-packcheck-registration-2026', cand: 'live-m8b-packcheck-registration-2026' },
];

const find = (prefix: string): string => {
  const hits = readdirSync(DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  if (hits.length !== 1) throw new Error(`expected exactly one result file for "${prefix}", found ${hits.length}`);
  return join(DIR, hits[0]!);
};
const load = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as BenchmarkResult;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const total = (o: Record<string, number>) => sum(Object.values(o));

type Row = {
  doc: string;
  file: string;
  model: string;
  profile: string;
  attempts: number;
  repaired: boolean;
  latencyMs: number;
  tokens: { prompt: number | null; completion: number | null; source: string };
  neuronsEstimated: number | null;
  claims: number;
  serverDropped: number;
  serverDroppedByReason: Record<string, number>;
  outcomes: DocResult['extraction']['outcomes'];
  missed: number;
  rejectedUnsupported: number;
  rejectedByReason: Record<string, number>;
  safeHolds: number;
  validatedDifferingFromLabel: number;
  auditSuspect: number;
  unlabelled: { field: string; status: string; value: unknown; evidence: string[] }[];
  missedFacts: { field: string; line: number }[];
};

function row(spec: DocSpec, which: 'base' | 'cand'): Row {
  const file = find(which === 'base' ? spec.base : spec.cand);
  const r = load(file);
  const d = r.samples.flatMap((s) => s.docs).find((x) => x.docId === spec.doc)!;
  const dropped: Record<string, number> = {};
  for (const i of d.issues) if (i.kind === 'server_dropped') dropped[i.reason ?? 'unknown'] = (dropped[i.reason ?? 'unknown'] ?? 0) + (i.count ?? 1);
  return {
    doc: spec.doc,
    file: file.replace(SAMPLES_DIR, 'samples/'),
    model: r.model,
    profile: d.profile ? d.profile.id : `${loadSample(spec.sample).docs.find((x) => x.id === spec.doc)!.schemaId} (inferred from manifest)`,
    attempts: r.attemptsCharged,
    repaired: r.requests.some((q) => q.repaired),
    latencyMs: sum(r.requests.map((q) => q.ms)),
    tokens: { prompt: r.usage.promptTokens, completion: r.usage.completionTokens, source: r.usage.tokenSource },
    neuronsEstimated: r.usage.neurons.value,
    claims: d.claimsReturned.length,
    serverDropped: sum(Object.values(dropped)),
    serverDroppedByReason: dropped,
    outcomes: d.extraction.outcomes,
    missed: d.extraction.outcomes.missed,
    rejectedUnsupported: total(d.extraction.rejectedByReason),
    rejectedByReason: d.extraction.rejectedByReason,
    safeHolds: d.facts.filter((f) => f.status === 'needs_review').length, // facts held for review, counted once
    validatedDifferingFromLabel: d.extraction.outcomes.wrong_value,
    auditSuspect: d.facts.filter((f) => f.audit === 'suspect').length + d.extraction.outcomes.wrongly_validated,
    unlabelled: d.facts.filter((f) => f.label === 'unlabelled').map((f) => ({ field: f.field, status: f.status, value: f.value, evidence: f.evidence.map((e) => e.text) })),
    missedFacts: d.extraction.details.filter((x) => x.outcome === 'missed').map((x) => ({ field: x.field, line: x.line })),
  };
}

/** Strict findings for one sample, from saved responses of one model (same replay path for both). */
async function findings(which: 'base' | 'cand', sample: string, docs: string[]) {
  const specs = DOCS.filter((s) => docs.includes(s.doc));
  const saved: unknown[][] = [];
  const recordedProfiles: Record<string, string> = {};
  for (const s of specs) {
    const r = load(find(which === 'base' ? s.base : s.cand));
    const d = r.samples.flatMap((x) => x.docs).find((x) => x.docId === s.doc)!;
    saved.push(d.claimsReturned);
    if (d.profile) recordedProfiles[s.doc] = d.profile.id;
  }
  const res = await runBenchmark({ mode: 'replay', model: 'replay', label: `${which}-${sample}`, transport: new ReplayTransport(saved), sampleIds: [sample], docFilter: docs, limits: { maxChars: 24_000, maxBlocks: 400 }, attemptBudget: 1000, recordedProfiles });
  if (res.requests.some((q) => !q.ok)) throw new Error(`replay failed for ${which}/${sample}`);
  const s = res.samples[0]!;
  const sc = s.findings.score;
  return {
    sample,
    expected: sc.expected,
    exact: sc.matchedExactState,
    missed: sc.missed,
    falseCritical: sc.falseCritical,
    overConfident: sc.overConfident,
    mustNotFlagViolations: sc.mustNotFlagViolations,
    unexpectedOther: sc.unexpectedOther,
    produced: s.findings.produced.map((p) => `${p.code} ${p.subject} ${p.response ?? ''} ${p.state}`),
    comparisons: s.comparisons ? { planned: s.comparisons.length, agree: s.comparisons.filter((c) => c.status === 'agree').length, flagged: s.comparisons.filter((c) => c.status === 'flagged').length, notEvaluated: s.comparisons.filter((c) => c.status === 'not_evaluated').map((c) => `${c.id}: ${c.reason}`) } : undefined,
    identity: s.identity ? { ...s.identity.counts, uncertain: s.identity.uncertain.map((u) => `${u.docId}:${u.reason}`), recovered: s.identity.recovered.map((x) => `${x.docId}:${x.code}`) } : undefined,
    coverage: [...new Set(s.docs.map((d) => d.coverage.state))],
    rawExtraction: { recall: res.summary.recall, validatedPrecision: res.summary.validatedPrecision, missedFacts: res.summary.missedFacts },
  };
}

const GROUPS: { sample: string; docs: string[] }[] = [
  { sample: 'scopecheck', docs: ['rfq', 'quote-a', 'quote-b'] },
  { sample: 'packcheck', docs: ['requirements', 'application-form', 'budget', 'registration'] },
  { sample: 'scopecheck-layout', docs: ['rfq', 'quote-c'] },
];

const models = { base: BASELINE_MODEL, cand: SECOND_CANDIDATE } as const;
const out: Record<string, unknown> = { baseline: BASELINE_MODEL, candidate: SECOND_CANDIDATE, rows: {} as Record<string, Row[]>, totals: {}, findings: {} };

for (const which of ['base', 'cand'] as const) {
  const rows = DOCS.map((s) => row(s, which));
  (out.rows as Record<string, Row[]>)[which] = rows;
  const t = {
    documents: rows.length,
    attempts: sum(rows.map((r) => r.attempts)),
    repairs: rows.filter((r) => r.repaired).length,
    latencyMsTotal: sum(rows.map((r) => r.latencyMs)),
    tokensPrompt: sum(rows.map((r) => r.tokens.prompt ?? 0)),
    tokensCompletion: sum(rows.map((r) => r.tokens.completion ?? 0)),
    neuronsEstimated: Math.round(sum(rows.map((r) => r.neuronsEstimated ?? 0)) * 10) / 10,
    claims: sum(rows.map((r) => r.claims)),
    serverDropped: sum(rows.map((r) => r.serverDropped)),
    missedFacts: sum(rows.map((r) => r.missed)),
    rejectedUnsupported: sum(rows.map((r) => r.rejectedUnsupported)),
    safeHolds: sum(rows.map((r) => r.safeHolds)),
    validatedDifferingFromLabel: sum(rows.map((r) => r.validatedDifferingFromLabel)),
    auditSuspect: sum(rows.map((r) => r.auditSuspect)),
    unlabelledClaims: sum(rows.map((r) => r.unlabelled.length)),
    correct: sum(rows.map((r) => r.outcomes.correct)),
  };
  (out.totals as Record<string, unknown>)[which] = t;
  (out.findings as Record<string, unknown>)[which] = await Promise.all(GROUPS.map((g) => findings(which, g.sample, g.docs)));
}
writeFileSync(join(DIR, 'model-comparison.json'), JSON.stringify(out, null, 2) + '\n');

// ---- console report ----
const rows = out.rows as Record<string, Row[]>;
const f = (n: number | null) => (n === null ? 'n/a' : String(n));
console.log(`baseline ${models.base} vs candidate ${models.cand}\n`);
console.log('doc | model | profile | attempts | repair | ms | claims | dropped | correct | missed | rejected | holds | differs-from-label | unlabelled | tokens in/out | est.neurons');
for (const spec of DOCS) for (const w of ['base', 'cand'] as const) {
  const r = rows[w]!.find((x) => x.doc === spec.doc)!;
  console.log(`${r.doc} | ${w === 'base' ? '70B' : '8B'} | ${r.profile} | ${r.attempts} | ${r.repaired} | ${r.latencyMs} | ${r.claims} | ${r.serverDropped} ${JSON.stringify(r.serverDroppedByReason)} | ${r.outcomes.correct} | ${r.missed} | ${r.rejectedUnsupported} | ${r.safeHolds} | ${r.validatedDifferingFromLabel} | ${r.unlabelled.length} | ${f(r.tokens.prompt)}/${f(r.tokens.completion)} | ${f(r.neuronsEstimated)}`);
}
console.log('\nTOTALS', JSON.stringify(out.totals, null, 1));
for (const w of ['base', 'cand'] as const) {
  console.log(`\nFINDINGS ${w}`);
  for (const x of (out.findings as Record<string, Awaited<ReturnType<typeof findings>>[]>)[w]!) console.log(JSON.stringify({ sample: x.sample, exact: `${x.exact}/${x.expected}`, missed: x.missed, falseCritical: x.falseCritical, overConfident: x.overConfident, mustNotFlag: x.mustNotFlagViolations, other: x.unexpectedOther, notEvaluated: x.comparisons?.notEvaluated, identity: x.identity, coverage: x.coverage, raw: x.rawExtraction }));
}
for (const w of ['base', 'cand'] as const) for (const r of rows[w]!) if (r.unlabelled.length) console.log(`\nUNLABELLED ${w} ${r.doc}:`, JSON.stringify(r.unlabelled));
