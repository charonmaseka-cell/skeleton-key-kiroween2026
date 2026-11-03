import { describe, expect, it } from 'vitest';
import { oracleAi, type MockDefects } from '../src/ai';
import { SqliteAdmission } from '../src/admission';
import { runBenchmark, type BenchmarkResult } from '../src/run';
import { loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';
import { summarizeUsage } from '../src/usage';

// All tests here use the MOCK model (an oracle built from the labels, with injectable defects).
// They test the harness and the pipeline; they say nothing about real model quality.

const SAMPLES = ['scopecheck', 'packcheck'];

async function run(opts: { defects?: MockDefects; budget?: number; simulate?: boolean; docs?: string[]; ceiling?: number; samples?: string[]; identityRecovery?: boolean; oracle?: string[] } = {}): Promise<BenchmarkResult> {
  const ai = oracleAi((opts.oracle ?? SAMPLES).map(loadSample), opts.defects);
  const counter = new SqliteAdmission(':memory:');
  const transport = new LocalTransport({ ai, counter, env: { DAILY_ADMISSION_CEILING: String(opts.ceiling ?? 1000), MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '2000' } });
  const result = await runBenchmark({
    mode: 'mock',
    model: 'mock-oracle',
    label: 't',
    transport,
    sampleIds: opts.samples ?? SAMPLES,
    docFilter: opts.docs,
    limits: { maxChars: 24_000, maxBlocks: 400 },
    attemptBudget: opts.budget ?? 1000,
    simulateCoverageConfirmation: opts.simulate,
    identityRecovery: opts.identityRecovery,
  });
  counter.close();
  return result;
}

const findings = (r: BenchmarkResult, sample: string) => r.samples.find((s) => s.sampleId === sample)!.findings.produced;
const docOf = (r: BenchmarkResult, id: string) => r.samples.flatMap((s) => s.docs).find((d) => d.docId === id)!;

describe('clean mock run', () => {
  it('matches the labels with zero false critical findings', async () => {
    const r = await run();
    expect(r.mode).toBe('mock');
    expect(r.summary).toMatchObject({ recall: 1, validatedPrecision: 1, missedFacts: 0, unsupportedFacts: 0, falseCriticalFindings: 0, overConfidentFindings: 0, missedFindings: 0, mustNotFlagViolations: 0 });
    expect(r.usage.tokenSource).toBe('mock');
    expect(r.usage.neurons.basis).toBe('mock_estimate');
  });

  it('a successful request never establishes coverage: absences stay Needs review', async () => {
    const r = await run();
    for (const d of r.samples.flatMap((s) => s.docs)) {
      expect(d.processingComplete).toBe(true);
      expect(d.coverage.state).toBe('unverified');
    }
    const absent = findings(r, 'scopecheck').find((f) => f.code === 'item.absent' && f.response === 'quote-b')!;
    expect(absent).toMatchObject({ state: 'needs_review', reason: 'coverage_unverified' });
    const missing = findings(r, 'packcheck').find((f) => f.code === 'attachment.missing')!;
    expect(missing.state).toBe('needs_review');
  });

  it('the funding (R1.6m) vs budget (R2m) pair is not flagged, and the name difference is', async () => {
    const f = findings(await run(), 'packcheck');
    expect(f.some((x) => x.code.startsWith('funding.'))).toBe(false);
    expect(f.find((x) => x.code === 'org.name_differs')).toMatchObject({ state: 'confirmed', response: 'budget' });
    expect(f.find((x) => x.code === 'value.needs_review')).toMatchObject({ subject: 'budget:project_start_date', reason: 'date_format_ambiguous' });
  });

  it('confirmed coverage (simulated, labelled) is the only way absences become confirmed', async () => {
    const r = await run({ simulate: true });
    expect(r.simulatedCoverageConfirmation).toBe(true);
    expect(findings(r, 'scopecheck').find((f) => f.code === 'item.absent')!.state).toBe('confirmed');
    expect(findings(r, 'packcheck').find((f) => f.code === 'attachment.missing')!.state).toBe('confirmed');
    expect(r.summary.falseCriticalFindings).toBe(0);
    expect(docOf(r, 'quote-b').coverage.note).toMatch(/SIMULATED/);
  });
});

describe('extraction succeeds but misses facts', () => {
  it('a missed line still yields only Needs review, never a false confirmed omission', async () => {
    // quote-a's PG-6 line is dropped by the "model" although every request succeeds.
    const r = await run({ defects: { omit: (doc, f) => doc === 'quote-a' && f.line === 3 } });
    expect(docOf(r, 'quote-a').processingComplete).toBe(true);
    expect(docOf(r, 'quote-a').coverage.state).toBe('unverified');
    expect(r.summary.missedFacts).toBeGreaterThan(0);
    const absent = findings(r, 'scopecheck').find((f) => f.code === 'item.absent' && f.response === 'quote-a')!;
    expect(absent).toMatchObject({ subject: 'PG-6', state: 'needs_review', reason: 'coverage_unverified' });
    expect(r.summary.falseCriticalFindings).toBe(0);
    expect(r.summary.overConfidentFindings).toBe(0);
  });

  it('a missed fact that hides a real difference is reported as a missed finding', async () => {
    const r = await run({ defects: { omit: (doc, f) => doc === 'quote-a' && f.line === 1 && f.field === 'quantity' } });
    expect(r.summary.missedFindings).toBeGreaterThan(0);
    expect(r.summary.falseCriticalFindings).toBe(0);
  });
});

describe('rejected claims and unknown blocks surface as extraction issues', () => {
  it('an unsupported claim is rejected, counted, and listed as an issue', async () => {
    const r = await run({ defects: { hallucinate: true }, docs: ['quote-a'], samples: ['scopecheck'] });
    const d = docOf(r, 'quote-a');
    expect(r.summary.unsupportedFacts).toBeGreaterThan(0);
    expect(d.issues.some((i) => i.kind === 'claim_rejected')).toBe(true);
    expect(d.extraction.outcomes.wrong_value).toBe(0); // the invented value was not validated
  });

  it('claims citing unknown block IDs or fields outside the profile are reported, not silent', async () => {
    const r = await run({ defects: { unknownBlock: true, outOfProfile: true }, docs: ['quote-a'], samples: ['scopecheck'] });
    const issues = docOf(r, 'quote-a').issues.filter((i) => i.kind === 'server_dropped');
    expect(issues.find((i) => i.reason === 'unknown_block')?.count).toBe(1);
    expect(issues.find((i) => i.reason === 'unknown_field')?.count).toBe(1);
    expect(r.summary.serverDropped).toBe(2);
  });
});

describe('attempts, repairs and failures', () => {
  it('records a repair attempt and charges both attempts', async () => {
    const r = await run({ defects: { badJsonFirst: true }, docs: ['rfq'], samples: ['scopecheck'] });
    expect(r.summary.repairedRequests).toBe(1);
    expect(r.attemptsCharged).toBe(2);
    expect(r.requests[0]).toMatchObject({ ok: true, repaired: true, attemptsCharged: 2 });
  });

  it('the attempt budget is a hard stop: unsent chunks are not processed and coverage cannot be confirmed', async () => {
    const r = await run({ budget: 1, simulate: true, docs: ['quote-a', 'quote-b'], samples: ['scopecheck'] });
    expect(r.attemptsCharged).toBe(1);
    expect(r.requests.filter((x) => x.code === 'attempt_budget_exhausted')).toHaveLength(1);
    const unsent = docOf(r, 'quote-b');
    expect(unsent.processingComplete).toBe(false);
    expect(unsent.coverage.state).toBe('unverified'); // simulation cannot confirm an unprocessed document
    expect(unsent.issues.some((i) => i.kind === 'chunk_failed')).toBe(true);
  });

  it('the admission ceiling is enforced below the harness: a daily_limit response is recorded', async () => {
    const r = await run({ ceiling: 1, docs: ['quote-a', 'quote-b'], samples: ['scopecheck'] });
    expect(r.requests.map((x) => x.code ?? 'ok')).toEqual(['ok', 'daily_limit']);
    expect(r.attemptsCharged).toBe(1);
    expect(docOf(r, 'quote-b').processingComplete).toBe(false);
  });

  it('a quota error from the model is distinguishable and produces no facts or confirmed findings', async () => {
    const r = await run({ defects: { fail: 'you have used up your daily free allocation of 10,000 neurons' }, docs: ['quote-a'], samples: ['scopecheck'] });
    expect(r.requests[0]).toMatchObject({ ok: false, code: 'quota_exhausted' });
    expect(r.summary.schemaValidRate).toBe(0);
    expect(docOf(r, 'quote-a').processingComplete).toBe(false);
    expect(r.attemptsCharged).toBe(1); // not refunded
  });
});

describe('repair behaviour, offline with controlled responses and counted attempts', () => {
  it('invalid JSON then valid JSON: exactly one repair, two attempts charged, claims accepted', async () => {
    const r = await run({ defects: { badJsonFirst: true }, docs: ['quote-a'], samples: ['scopecheck'] });
    expect(r.requests[0]).toMatchObject({ ok: true, repaired: true, attemptsCharged: 2 });
    expect(r.summary.requests).toBe(1);
    expect(r.attemptsCharged).toBe(2);
    expect(docOf(r, 'quote-a').rates.claims).toBeGreaterThan(0);
  });

  it('invalid JSON twice: the single repair is spent, both attempts are charged, nothing is accepted', async () => {
    const ai = oracleAi(SAMPLES.map(loadSample), { badJsonAlways: true });
    const counter = new SqliteAdmission(':memory:');
    const transport = new LocalTransport({ ai, counter, env: { DAILY_ADMISSION_CEILING: '1000', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '2000' } });
    const r = await runBenchmark({ mode: 'mock', model: 'm', label: 't', transport, sampleIds: ['scopecheck'], docFilter: ['quote-a'], limits: { maxChars: 24_000, maxBlocks: 400 }, attemptBudget: 2 });
    counter.close();
    expect(ai.calls).toBe(2); // one attempt plus exactly one repair, never a third
    expect(r.attemptsCharged).toBe(2);
    expect(r.requests[0]).toMatchObject({ ok: false, attemptsCharged: 2 });
    expect(docOf(r, 'quote-a').rates.claims).toBe(0);
    expect(docOf(r, 'quote-a').processingComplete).toBe(false);
  });

  it('a one-attempt allowance blocks the repair: one attempt charged, the model is called once', async () => {
    const ai = oracleAi(SAMPLES.map(loadSample), { badJsonFirst: true });
    const counter = new SqliteAdmission(':memory:');
    const transport = new LocalTransport({ ai, counter, env: { DAILY_ADMISSION_CEILING: '1', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '2000' } });
    const r = await runBenchmark({ mode: 'mock', model: 'm', label: 't', transport, sampleIds: ['scopecheck'], docFilter: ['quote-a'], limits: { maxChars: 24_000, maxBlocks: 400 }, attemptBudget: 1 });
    counter.close();
    expect(ai.calls).toBe(1);
    expect(r.attemptsCharged).toBe(1);
    expect(r.requests[0]!.ok).toBe(false);
  });
});

describe('ScopeCheck item identity in the harness', () => {
  const dropped = { dropItemCodes: true } as const;

  it('a model that drops item codes breaks matching; the identity step restores the strict findings', async () => {
    const r = await run({ defects: dropped, samples: ['scopecheck'] });
    const sc = r.samples[0]!;
    // before: the original matching misses expected findings (and may emit false critical ones)
    expect(sc.findingsBefore!.score.missed.length + sc.findingsBefore!.score.falseCritical.length).toBeGreaterThan(0);
    // after: strict identities match exactly, nothing confirmed beyond the labels
    expect(sc.findings.score).toMatchObject({ expected: 4, matchedExactState: 4, missed: [], falseCritical: [], overConfident: [] });
    expect(sc.findings.score.unexpectedOther).toEqual([]);
    expect(sc.identity!.counts.recovered).toBeGreaterThan(0);
    expect(sc.identity!.uncertain).toEqual([]);
  });

  it('extraction scores and raw claims are identical with and without the identity step', async () => {
    const on = await run({ defects: dropped, samples: ['scopecheck'], identityRecovery: true });
    const off = await run({ defects: dropped, samples: ['scopecheck'], identityRecovery: false });
    expect(on.samples[0]!.docs.map((d) => d.extraction)).toEqual(off.samples[0]!.docs.map((d) => d.extraction));
    expect(on.samples[0]!.docs.map((d) => d.claimsReturned)).toEqual(off.samples[0]!.docs.map((d) => d.claimsReturned));
    expect(on.samples[0]!.docs.flatMap((d) => d.facts.map((f) => f.value))).toEqual(off.samples[0]!.docs.flatMap((d) => d.facts.map((f) => f.value)));
    expect(on.summary.recall).toBe(off.summary.recall);
    expect(off.samples[0]!.findingsBefore).toBeUndefined();
    expect(off.samples[0]!.identity).toBeUndefined();
    expect(on.samples[0]!.docs.some((d) => d.extraction.outcomes.wrong_value > 0)).toBe(true); // the dropped codes are still scored as differing from the labels
  });

  it('coverage stays unverified and the omission stays Needs review after recovery', async () => {
    const r = await run({ defects: dropped, samples: ['scopecheck'] });
    for (const d of r.samples[0]!.docs) expect(d.coverage.state).toBe('unverified');
    const absent = r.samples[0]!.findings.produced.find((f) => f.code === 'item.absent')!;
    expect(absent).toMatchObject({ subject: 'PG-6', response: 'quote-b', state: 'needs_review', reason: 'coverage_unverified' });
  });

  it('recovered identifiers are recorded separately, each with its own validated span', async () => {
    const r = await run({ defects: dropped, samples: ['scopecheck'] });
    for (const rec of r.samples[0]!.identity!.recovered) {
      expect(rec.codeSpan.text).toBe(rec.code);
      expect(rec.codeSpan.end - rec.codeSpan.start).toBe(rec.code.length);
      expect(rec.codeSpan.blockId).toBe(rec.itemEvidence.blockId);
    }
  });
});

describe('PackCheck comparisons: the checks actually run, or are marked Not evaluated', () => {
  const pack = (r: BenchmarkResult) => r.samples.find((x) => x.sampleId === 'packcheck')!;
  const cmp = (r: BenchmarkResult, id: string) => pack(r).comparisons!.find((c) => c.id === id)!;

  it('clean run: funding fields agree across documents and funding vs budget is evaluated, not skipped', async () => {
    const r = await run({ samples: ['packcheck'] });
    expect(cmp(r, 'funding_requested:application-form~budget')).toMatchObject({ status: 'agree' });
    expect(cmp(r, 'funding_within_budget:application-form~budget')).toMatchObject({ status: 'agree' });
    expect(cmp(r, 'organisation_name:application-form~budget')).toMatchObject({ status: 'flagged' });
    // the only comparison that cannot run is the one that depends on the ambiguous (01/03/2026) start date
    // The reason is written for a person; the code is kept in blocked.reason.
    const ne = pack(r).comparisons!.filter((c) => c.status === 'not_evaluated');
    expect(ne.map((c) => [c.id, c.blocked?.reason])).toEqual([['project_start_date:application-form~budget', 'date_format_ambiguous']]);
    expect(ne[0]!.reason).toMatch(/^Project start date in .+ was not validated\.$/);
    expect(findings(r, 'packcheck').some((f) => f.code.startsWith('funding.'))).toBe(false);
  });

  it('a rejected critical field enters the Needs-review queue and dependent comparisons are Not evaluated (never "fine")', async () => {
    const r = await run({ samples: ['packcheck'], defects: { dropMagnitude: true } });
    const form = docOf(r, 'application-form');
    expect(form.facts.find((f) => f.field === 'funding_requested')).toMatchObject({ status: 'needs_review', reason: 'value_not_in_excerpt' });
    expect(findings(r, 'packcheck').find((f) => f.code === 'value.needs_review' && f.subject === 'application-form:funding_requested')).toMatchObject({ state: 'needs_review', reason: 'value_not_in_excerpt' });
    expect(cmp(r, 'funding_requested:application-form~budget')).toMatchObject({ status: 'not_evaluated' });
    expect(cmp(r, 'funding_within_budget:application-form~budget')).toMatchObject({ status: 'not_evaluated' });
    expect(cmp(r, 'funding_within_budget:application-form~budget').reason).toMatch(/^Funding requested in .+ was not validated\.$/);
    expect(findings(r, 'packcheck').some((f) => f.code.startsWith('funding.'))).toBe(false);
    expect(r.summary.falseCriticalFindings).toBe(0);
  });
});

describe('ScopeCheck layout variant: a free-text quotation without pipe delimiters (pre-registered)', () => {
  const layout = (o: Parameters<typeof run>[0] = {}) => run({ samples: ['scopecheck-layout'], oracle: ['scopecheck-layout'], ...o });

  it('the pre-registered expectations hold: two confirmed differences, the exclusion, and the uncertain PG-6 line in Needs review', async () => {
    const r = await layout();
    const sc = r.samples[0]!;
    expect(sc.findings.score).toMatchObject({ expected: 5, matchedExactState: 5, missed: [], falseCritical: [], overConfident: [] });
    expect(sc.findings.score.unexpectedOther).toEqual([]);
    expect(sc.identity!.uncertain.map((u) => [u.docId, u.reason, u.candidates])).toEqual([['quote-c', 'multiple_codes', ['PG-6', 'SANS-1200']]]);
    for (const d of sc.docs) expect(d.coverage.state).toBe('unverified');
  });

  it('the same outcome when the model drops the item codes: codes are recovered from the source, the PG-6 line stays uncertain', async () => {
    const r = await layout({ defects: { dropItemCodes: true } });
    const sc = r.samples[0]!;
    expect(sc.findings.score).toMatchObject({ matchedExactState: 5, missed: [], falseCritical: [], overConfident: [] });
    expect(sc.identity!.recovered.filter((x) => x.docId === 'quote-c').map((x) => x.code).sort()).toEqual(['CP-100', 'MS-20']);
    expect(sc.identity!.uncertain.map((u) => u.reason)).toEqual(['multiple_codes']);
    expect(sc.findingsBefore!.score.missed.length).toBeGreaterThan(0); // the original matching cannot do this
  });

  it('even with (simulated) confirmed coverage the uncertain line is never turned into a confirmed omission', async () => {
    const r = await layout({ simulate: true });
    const f = r.samples[0]!.findings.produced;
    expect(f.find((x) => x.code === 'item.absent' && x.response === 'quote-c')).toMatchObject({ subject: 'PG-6', state: 'needs_review', reason: 'match_unresolved' });
    expect(f.find((x) => x.code === 'item.identity_uncertain')).toMatchObject({ state: 'needs_review', reason: 'multiple_codes' });
    expect(r.summary.falseCriticalFindings).toBe(0);
    expect(r.summary.overConfidentFindings).toBe(0);
  });
});

describe('ScopeCheck comparisons: an aspect that could not be compared is Not evaluated, not silently skipped', () => {
  it('a specification the model never extracted: the finding is missed (strictly scored) and the comparison is recorded Not evaluated', async () => {
    const r = await run({ samples: ['scopecheck-layout'], oracle: ['scopecheck-layout'], defects: { omit: (doc, f) => doc === 'quote-c' && f.line === 1 && f.field === 'specification' } });
    const sc = r.samples[0]!;
    expect(sc.findings.score.missed).toEqual(['spec.differs|CP-100:specification|quote-c']);
    expect(sc.findings.score.falseCritical).toEqual([]);
    expect(sc.comparisons!.find((c) => c.id === 'specification:CP-100~quote-c')).toMatchObject({ status: 'not_evaluated', reason: expect.stringMatching(/^No specification was extracted from .+\.$/), blocked: { field: 'specification', reason: 'no_fact' } });
    expect(sc.comparisons!.find((c) => c.id === 'quantity:CP-100~quote-c')).toMatchObject({ status: 'agree' });
    expect(sc.comparisons!.find((c) => c.id === 'quantity:MS-20~quote-c')).toMatchObject({ status: 'flagged' });
  });

  it('an uncertain item is Not evaluated for every aspect, so nothing about it is presented as agreeing', async () => {
    const r = await run({ samples: ['scopecheck-layout'], oracle: ['scopecheck-layout'] });
    const c = r.samples[0]!.comparisons!.filter((x) => x.id.endsWith('PG-6~quote-c'));
    expect(c.map((x) => x.status)).toEqual(['not_evaluated', 'not_evaluated']);
    expect(c[0]!.reason).toMatch(/^The item was not matched in .+\.$/);
    expect(c[0]!.blocked?.reason).toBe('match_unresolved');
  });
});

describe('usage labelling', () => {
  const rep = (p: number | null, c: number | null) => ({ promptTokens: p, completionTokens: c });
  it('measured tokens give an ESTIMATED neuron figure, labelled as such', () => {
    const u = summarizeUsage([rep(1000, 200)], { mock: false });
    expect(u.tokenSource).toBe('measured');
    expect(u.neurons.basis).toBe('estimated_from_tokens');
    expect(u.neurons.note).toMatch(/ESTIMATE/);
  });
  it('a dashboard figure is labelled as user-measured; missing tokens are unavailable, not zero', () => {
    expect(summarizeUsage([rep(1, 1)], { mock: false, measuredNeurons: 123 }).neurons).toMatchObject({ value: 123, basis: 'measured_by_user_from_dashboard' });
    const none = summarizeUsage([rep(null, null)], { mock: false });
    expect(none).toMatchObject({ tokenSource: 'unavailable', promptTokens: null });
    expect(none.neurons).toMatchObject({ value: null, basis: 'unavailable' });
    expect(summarizeUsage([rep(10, 10), null], { mock: false }).tokenSource).toBe('partial');
  });
});
