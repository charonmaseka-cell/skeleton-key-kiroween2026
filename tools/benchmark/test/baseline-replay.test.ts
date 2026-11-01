import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { frozenChunker, type FrozenPlan } from '../src/chunking';
import { runBenchmark, type BenchmarkResult } from '../src/run';
import { ReplayTransport } from '../src/transport';

// The saved live responses of the 2026-11-01 ScopeCheck baseline, re-validated and re-scored OFFLINE with the current
// parser version, rules and audit. No model is called. The original result file is read here, never rewritten.

const REPO = join(__dirname, '../../..');
const RESULTS = join(REPO, 'samples/benchmark-results');
const BASELINE = join(RESULTS, readdirSync(RESULTS).find((f) => f.startsWith('live-sc-t4-quote-b-'))!);
const PLAN = JSON.parse(readFileSync(join(REPO, 'samples/scopecheck-realistic/chunk-plan.json'), 'utf8')) as FrozenPlan;
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as BenchmarkResult;

type Claim = { blockId?: string; field?: string; excerpt?: string };

async function replay(drop: (c: Claim, docId: string) => boolean = () => false) {
  const saved: unknown[][] = [];
  for (const d of baseline.samples[0]!.docs) {
    const claims = (d.claimsReturned as Claim[]).filter((c) => !drop(c, d.docId));
    for (const c of PLAN.docs.find((x) => x.docId === d.docId)!.chunks) saved.push(claims.filter((cl) => c.blockIds.includes(cl.blockId ?? '')));
  }
  return runBenchmark({
    mode: 'replay', model: 'replay', label: 't', transport: new ReplayTransport(saved), sampleIds: ['scopecheck-realistic'], docFilter: ['rfq', 'quote-a', 'quote-b'],
    limits: { maxChars: 24_000, maxBlocks: 400 }, chunker: frozenChunker(PLAN), attemptBudget: 1000,
  });
}

describe('the original baseline is retained unchanged', () => {
  it('still shows the numbers reported on 2026-11-01 (16 of 18 exact, 2 missed, 4 false critical, 80 comparisons)', () => {
    const f = baseline.samples[0]!.findings;
    expect(f.score).toMatchObject({ expected: 18, produced: 24, matchedExactState: 16 });
    expect(f.score.missed).toEqual(['quantity.differs|PN-130:quantity|quote-a', 'item.absent|TK-120|quote-b']);
    expect(f.score.falseCritical).toHaveLength(4);
    expect(baseline.samples[0]!.comparisons).toHaveLength(80);
    expect((baseline as unknown as { replay?: unknown }).replay).toBeUndefined(); // it is a live result, not a replay
  });
});

describe('versioned offline replay of the saved responses', () => {
  it('keeps every claim as saved: 239 claims, all located, none dropped, raw claims not edited', async () => {
    const r = await replay();
    expect(r.requests).toHaveLength(21);
    expect(r.requests.every((q) => q.ok)).toBe(true);
    const claims = r.samples[0]!.docs.map((d) => d.claimsReturned.length);
    expect(claims).toEqual(baseline.samples[0]!.docs.map((d) => d.claimsReturned.length));
    expect(JSON.stringify(r.samples[0]!.docs.map((d) => d.claimsReturned))).toBe(JSON.stringify(baseline.samples[0]!.docs.map((d) => d.claimsReturned)));
  });

  it('the three leading-"with" cases are no longer false criticals, and the SN-403 case, a contaminated specification, is Needs review and Not evaluated instead of a confirmed difference', async () => {
    const s = (await replay()).samples[0]!;
    expect(s.findings.score.falseCritical).toEqual([]);
    const specs = s.findings.produced.filter((f) => f.code === 'spec.differs' && f.response === 'quote-b').map((f) => f.subject);
    for (const gone of ['MT-310', 'SN-401', 'SN-402', 'SN-403']) expect(specs).not.toContain(`${gone}:specification`);
    expect(specs.sort()).toEqual(['CB-501:specification', 'MT-301:specification']); // genuine differences kept
    expect(s.findings.produced.filter((f) => f.code === 'spec.differs' && f.response === 'quote-a').map((f) => f.subject).sort()).toEqual(['CP-103:specification', 'SN-401:specification']);
    expect(s.findings.produced).toContainEqual(expect.objectContaining({ code: 'specification.contaminated', subject: 'SN-403:specification', response: 'quote-b', state: 'needs_review', reason: 'item_code_in_specification' }));
    const c = s.comparisons!.find((x) => x.id === 'specification:SN-403~quote-b')!;
    expect(c).toMatchObject({ status: 'not_evaluated', blocked: { docId: 'quote-b', field: 'specification', reason: 'contaminated_value' } });
    expect(s.findings.score.overConfident).toEqual([]);
    expect(s.findings.score.matchedExactState).toBe(18); // no genuine detection was given up
  });

  it('REGRESSION: a genuine difference in a CLEAN specification is still confirmed even when the item code sits elsewhere in the row', async () => {
    // quotation B: MT-301 (IE3 -> IE2) and CB-501 (armoured -> unarmoured) are genuine; neither specification holds its own code
    const s = (await replay()).samples[0]!;
    for (const id of ['MT-301', 'CB-501']) {
      expect(s.comparisons!.find((x) => x.id === `specification:${id}~quote-b`)).toMatchObject({ status: 'flagged' });
    }
  });

  it('the four unresolved RFQ rows are recovered from validated source cells; the ambiguous quotation line stays in review', async () => {
    const id = (await replay()).samples[0]!.identity!;
    const cells = id.recovered.filter((x) => x.method === 'single_code_in_item_cell');
    expect(cells.map((x) => x.code).sort()).toEqual(['PN-130', 'PN-140', 'TK-110', 'TK-120']);
    expect(cells.every((x) => x.docId === 'rfq' && x.parts!.length === 2)).toBe(true);
    expect(id.uncertain.map((u) => `${u.docId}:${u.reason}`)).toEqual(['quote-a:multiple_codes']);
  });

  it('plans all 96 quantity and specification comparisons; every one that did not run says why and what blocked it', async () => {
    const s = (await replay()).samples[0]!;
    expect(s.comparisonCompleteness).toEqual({ labelledRequirementRows: 24, quotations: 2, aspects: 2, expected: 96, planned: 96, complete: true });
    expect(s.comparisons).toHaveLength(96);
    expect(new Set(s.comparisons!.map((c) => c.id)).size).toBe(96);
    const ne = s.comparisons!.filter((c) => c.status === 'not_evaluated');
    expect(ne).toHaveLength(23); // 22 for missing facts or unverified coverage, plus the contaminated SN-403 specification
    expect(ne.every((c) => !!c.reason && !!c.blocked?.docId && !!c.blocked.field && !!c.blocked.reason)).toBe(true);
    // the missed PN-140 specification (quotation A) is now listed, with the missing fact as the blocked input
    const pn140 = ne.find((c) => c.id === 'specification:PN-140~quote-a')!;
    expect(pn140.blocked).toMatchObject({ docId: 'quote-a', field: 'specification', reason: 'no_fact' });
  });

  it('an RFQ row whose item fact is missing is not hidden: Needs review, and its four comparisons are Not evaluated with the missing item as the blocked input', async () => {
    // remove the item claim of one RFQ row from the saved responses; its quantity and specification claims remain
    const r = await replay((c, doc) => doc === 'rfq' && c.field === 'item' && c.blockId === 'p2-l14');
    const s = r.samples[0]!;
    expect(s.findings.produced).toContainEqual(expect.objectContaining({ code: 'item.missing', subject: 'rfq:p2-l14:item', state: 'needs_review' }));
    const rows = s.comparisons!.filter((c) => c.id.includes('rfq:p2-l14:item'));
    expect(rows.map((c) => c.id).sort()).toEqual(['quantity:rfq:p2-l14:item~quote-a', 'quantity:rfq:p2-l14:item~quote-b', 'specification:rfq:p2-l14:item~quote-a', 'specification:rfq:p2-l14:item~quote-b']);
    expect(rows.every((c) => c.status === 'not_evaluated' && c.blocked?.field === 'item' && c.blocked.reason === 'no_fact' && c.blocked.docId === 'rfq')).toBe(true);
    expect(s.comparisonCompleteness).toMatchObject({ expected: 96, planned: 96, complete: true }); // the row is still counted: listed as Not evaluated, not dropped
    expect(s.comparisons!.some((c) => c.id.startsWith('quantity:TK-110~'))).toBe(false);
  });

  it('an RFQ row with NO facts at all cannot be listed by the ledger; the label diagnostic reports the shortfall instead of hiding it', async () => {
    const r = await replay((c, doc) => doc === 'rfq' && c.blockId === 'p2-l14');
    const s = r.samples[0]!;
    expect(s.comparisons).toHaveLength(92);
    expect(s.comparisonCompleteness).toEqual({ labelledRequirementRows: 24, quotations: 2, aspects: 2, expected: 96, planned: 92, complete: false });
  });
});

describe('earlier replays are kept as saved', () => {
  it('the rules-v3 replay file still shows what it showed: 18 of 18 expected, 1 false critical (SN-403), 22 Not evaluated', () => {
    const f = readdirSync(RESULTS).find((x) => x.startsWith('replay-sc-t4-replay-rules3-ingest2-'))!;
    const r = JSON.parse(readFileSync(join(RESULTS, f), 'utf8')) as BenchmarkResult & { replay: { rescoredWith: { scopeRuleVersion: string } } };
    expect(r.replay.rescoredWith.scopeRuleVersion).toBe('3');
    expect(r.samples[0]!.findings.score.falseCritical).toEqual(['spec.differs|SN-403:specification|quote-b']);
    expect(r.samples[0]!.comparisons!.filter((c) => c.status === 'not_evaluated')).toHaveLength(22);
  });
});

describe('exclusions stay distinct (the VAT / freight collision)', () => {
  it('quotation B reports VAT and freight as separate findings, each with its own evidence', async () => {
    const s = (await replay()).samples[0]!.findings.produced.filter((f) => f.code === 'exclusion.stated' && f.response === 'quote-b');
    expect(s.map((f) => f.subject).sort()).toEqual(['quote-b:p1-l2:exclusion', 'quote-b:p2-l10:exclusion']);
  });

  it('the labelled exclusion (freight) is detected by the freight finding; VAT is an unexpected extra, not a detection', async () => {
    const sc = (await replay()).samples[0]!.findings.score;
    expect(sc.missed).toEqual([]);
    expect(sc.unexpectedOther).toContain('exclusion.stated|quote-b:p1-l2:exclusion|quote-b(confirmed)');
    expect(sc.unexpectedOther.some((x) => x.includes('p2-l10'))).toBe(false); // freight was matched to the label
  });

  it('REGRESSION: with the freight claim removed, VAT alone does NOT count as detecting the labelled freight exclusion', async () => {
    const r = await replay((c, doc) => doc === 'quote-b' && c.field === 'exclusion' && c.blockId === 'p2-l10');
    const sc = r.samples[0]!.findings.score;
    expect(sc.missed).toContain('exclusion.stated|quote-b:exclusion|quote-b');
    expect(sc.matchedExactState).toBe(17);
  });
});
