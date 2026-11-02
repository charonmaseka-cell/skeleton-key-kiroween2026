import { describe, expect, it } from 'vitest';
import { oracleAi, type MockDefects } from '../src/ai';
import { SqliteAdmission } from '../src/admission';
import { buildRealisticScopeCheck, blockId, LINES_PER_PAGE } from '../src/realistic-scopecheck';
import { runBenchmark, type BenchmarkResult } from '../src/run';
import { loadBlocks, loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';

// Realistic multi-page ScopeCheck documents (spec SC-4, tasks SC-T1 and SC-T2). No model is called:
// the mock model answers from the labels. These tests prove the pipeline and the safety rules for
// multi-chunk documents; they say nothing about real model quality (that needs live attempts).

const SAMPLE = 'scopecheck-realistic';
const CHUNK = { maxChars: 1800, maxBlocks: 400 }; // small budget forces several chunks (the live budget comes from task 5.5)

async function run(opts: { defects?: MockDefects; simulate?: boolean } = {}): Promise<BenchmarkResult> {
  const counter = new SqliteAdmission(':memory:');
  const transport = new LocalTransport({ ai: oracleAi([loadSample(SAMPLE)], opts.defects), counter, env: { DAILY_ADMISSION_CEILING: '1000', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '5000' } });
  const r = await runBenchmark({ mode: 'mock', model: 'mock-oracle', label: 't', transport, sampleIds: [SAMPLE], limits: CHUNK, attemptBudget: 1000, simulateCoverageConfirmation: opts.simulate });
  counter.close();
  return r;
}
const doc = (r: BenchmarkResult, id: string) => r.samples[0]!.docs.find((d) => d.docId === id)!;
const produced = (r: BenchmarkResult) => r.samples[0]!.findings.produced;
const absences = (r: BenchmarkResult, quote: string) => produced(r).filter((f) => f.code === 'item.absent' && f.response === quote);

describe('pre-registration and realism', () => {
  it('the committed sample.json is exactly what the generator produces (labels cannot drift after the fact)', () => {
    expect(JSON.parse(JSON.stringify(loadSample(SAMPLE)))).toEqual(JSON.parse(JSON.stringify(buildRealisticScopeCheck())));
  });

  it('every document is at least three pages and several thousand characters, with items spanning page breaks', async () => {
    const sample = loadSample(SAMPLE);
    for (const d of sample.docs) {
      const blocks = await loadBlocks(SAMPLE, d);
      expect(Math.max(...blocks.map((b) => b.page ?? 1)), d.id).toBeGreaterThanOrEqual(3);
      expect(blocks.reduce((n, b) => n + b.text.length, 0), d.id).toBeGreaterThan(5000);
      const itemPages = new Set(blocks.filter((b) => /(^Item |We offer )/.test(b.text)).map((b) => b.page));
      expect(itemPages.size, `${d.id} items on more than one page`).toBeGreaterThan(1);
    }
  });

  it('the block named by the uncertain-identity expectation is the intended line', async () => {
    const sample = loadSample(SAMPLE);
    const expected = sample.expectedFindings.find((f) => f.code === 'item.identity_uncertain')!;
    const blocks = await loadBlocks(SAMPLE, sample.docs.find((d) => d.id === 'quote-a')!);
    expect(blocks.find((b) => b.id === expected.subject.split(':')[1])!.text).toMatch(/SN-403.*SANS-1200/);
    expect(blockId(LINES_PER_PAGE)).toBe('p2-l1');
  });
});

describe('multi-chunk run with a faithful model', () => {
  it('every document is sent in several chunks, all succeed, and all 18 pre-registered findings match exactly', async () => {
    const r = await run();
    for (const id of ['rfq', 'quote-a', 'quote-b']) {
      expect(r.requests.filter((q) => q.docId === id).length, id).toBeGreaterThan(1);
      expect(doc(r, id).processingComplete).toBe(true);
      expect(doc(r, id).coverage.state).toBe('unverified'); // a successful run never establishes coverage
    }
    expect(r.samples[0]!.findings.score).toMatchObject({ expected: 18, matchedExactState: 18, missed: [], falseCritical: [], overConfident: [], unexpectedOther: [] });
    expect(r.summary).toMatchObject({ recall: 1, validatedPrecision: 1, missedFacts: 0, falseCriticalFindings: 0 });
  });

  it('extraction, matching and findings are reported separately', async () => {
    const r = await run();
    const s = r.samples[0]!;
    expect(s.docs.every((d) => d.extraction.recall === 1)).toBe(true); // extraction
    expect(s.identity!.counts).toMatchObject({ uncertain: 1 }); // identity / matching
    expect(s.comparisons!.some((c) => c.status === 'not_evaluated')).toBe(true); // ledger
    expect(s.findings.score.matchedExactState).toBe(18); // findings
  });

  it('the omissions are Needs review until coverage is confirmed; the quote-a omissions stay so even then (an uncertain line could be the item)', async () => {
    const plain = await run();
    expect(absences(plain, 'quote-b').map((f) => f.state)).toEqual(['needs_review', 'needs_review', 'needs_review']);
    const confirmed = await run({ simulate: true });
    expect(absences(confirmed, 'quote-b').every((f) => f.state === 'confirmed')).toBe(true);
    expect(absences(confirmed, 'quote-a').every((f) => f.state === 'needs_review')).toBe(true);
    expect(confirmed.summary.falseCriticalFindings).toBe(0);
  });
});

describe('a chunk that fails can never produce a confirmed absence', () => {
  const failTK = { failChunkWhen: (blocks: { text: string }[]) => blocks.some((b) => /We offer .*TK-110/.test(b.text)) };

  it('the document is reported as incompletely processed and the failed request is recorded', async () => {
    const r = await run({ defects: failTK });
    expect(doc(r, 'quote-b').processingComplete).toBe(false);
    expect(r.requests.filter((q) => q.docId === 'quote-b' && !q.ok)).toHaveLength(1);
    expect(doc(r, 'quote-b').issues.some((i) => i.kind === 'chunk_failed')).toBe(true);
  });

  it('even with the reviewer asserting coverage, no absence against that document is confirmed, and the reason is the processing failure', async () => {
    const r = await run({ defects: failTK, simulate: true });
    const a = absences(r, 'quote-b');
    expect(a.length).toBeGreaterThan(3); // the seeded absences plus the items stranded in the failed chunk
    expect(a.every((f) => f.state === 'needs_review' && f.reason === 'processing_incomplete')).toBe(true);
    expect(doc(r, 'quote-b').coverage.state).toBe('unverified');
    expect(r.summary.falseCriticalFindings).toBe(0);
  });

  it('documents whose chunks all succeeded are unaffected, and differences found in healthy chunks are still reported', async () => {
    const r = await run({ defects: failTK, simulate: true });
    expect(doc(r, 'quote-a').processingComplete).toBe(true);
    expect(produced(r).filter((f) => f.code === 'quantity.differs' && f.response === 'quote-a')).toHaveLength(3);
  });
});

describe('a chunk the model returns nothing for (a missed chunk) is not coverage either', () => {
  const missTK = { emptyChunkWhen: (blocks: { text: string }[]) => blocks.some((b) => /We offer .*TK-110/.test(b.text)) };

  it('processing looks complete, coverage stays unverified, and the items that were missed show as Needs review, never confirmed', async () => {
    const r = await run({ defects: missTK });
    expect(doc(r, 'quote-b').processingComplete).toBe(true);
    expect(doc(r, 'quote-b').coverage.state).toBe('unverified');
    const a = absences(r, 'quote-b');
    expect(a.length).toBeGreaterThan(3);
    expect(a.every((f) => f.state === 'needs_review' && f.reason === 'coverage_unverified')).toBe(true);
    expect(r.summary.missedFacts).toBeGreaterThan(0); // the miss is counted in the raw extraction score
    expect(r.summary.falseCriticalFindings).toBe(0);
  });

  it('control: the same chunk missed AND coverage asserted by a person does confirm the omissions; that is the person\'s assertion, and the export says so', async () => {
    const r = await run({ defects: missTK, simulate: true });
    expect(absences(r, 'quote-b').some((f) => f.state === 'confirmed')).toBe(true);
    expect(doc(r, 'quote-b').coverage.note).toMatch(/SIMULATED/);
  });
});
