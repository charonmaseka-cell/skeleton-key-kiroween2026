import { toRequestBlock } from '@skeleton-key/engine';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASELINE_MODEL } from '../src/candidates';
import { oracleAi, type Ai } from '../src/ai';
import { SqliteAdmission } from '../src/admission';
import { BudgetExceeded, NeuronBudget, SAFETY_MARGIN, budgetedAi, charge, loadDailyBaseline, worstCaseNeurons } from '../src/budget';
import { PROFILES, buildMessages } from '../../../services/extraction-api/src/profiles';
import { planRun } from '../src/preflight';
import { runBenchmark } from '../src/run';
import { loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';
import { DEFAULT_MAX_VALUES, outputChunker } from '../src/chunking';

// Conservative per-attempt budget reservations, and the preflight. No model is called anywhere here.

const M = BASELINE_MODEL;
const input = (chars = 3000, max = 1500) => ({ messages: [{ role: 'system', content: 'x'.repeat(chars) }], max_tokens: max });
const mkBudget = (o: Partial<{ runCap: number; dailyCap: number; dailyBaseline: number; statePath: string }> = {}) =>
  new NeuronBudget({ model: M, runCap: 6000, dailyCap: 8000, dailyBaseline: 0, day: '2026-11-01', ...o });
const spyAi = (reply: unknown | (() => never)): Ai & { calls: number } => {
  const a = { calls: 0, async run() { a.calls++; if (typeof reply === 'function') return (reply as () => never)(); return reply; } };
  return a;
};

describe('worst-case reservation', () => {
  it('assumes the whole output allowance and a calibrated 2 bytes per prompt token plus template overhead, with the one margin', () => {
    const w = worstCaseNeurons(input(3000, 1500), M);
    expect(w.promptTokens).toBe(1500 + 64);
    expect(w.completionTokens).toBe(1500);
    expect(w.neurons).toBeCloseTo(((1564 * 26_636 + 1500 * 204_818) / 1e6) * SAFETY_MARGIN, 5);
    expect(w.neurons).toBeCloseTo(charge(1564, 1500, M), 5);
  });
  it('counts UTF-8 bytes, not characters', () => {
    const multi = { messages: [{ content: '€'.repeat(100) }], max_tokens: 10 }; // 300 bytes
    expect(worstCaseNeurons(multi, M).promptTokens).toBe(150 + 64);
  });
  it('an input without an output allowance is reserved as if it were large', () => {
    expect(worstCaseNeurons({ messages: [{ content: 'x' }] }, M).completionTokens).toBeGreaterThanOrEqual(4096);
  });
});

describe('settlement records the FULL estimate (regression: the old Math.min discarded consumption above the reservation)', () => {
  const over = { response: {}, usage: { prompt_tokens: 9000, completion_tokens: 1500 } }; // far more prompt than reserved for a 3,000-char input
  it('reported usage above the reservation is charged in full, flagged as an overrun, and persisted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-over-'));
    try {
      const statePath = join(dir, 'usage.json');
      const b = mkBudget({ statePath });
      await budgetedAi(spyAi(over), b).run(M, input());
      const a = b.attempts[0]!;
      expect(a.charged).toBeGreaterThan(a.reserved);
      expect(a.charged).toBeCloseTo(charge(9000, 1500, M), 5);
      expect(a.overrun).toBe(true);
      expect(b.runTotal).toBeCloseTo(a.charged, 5);
      expect(b.summary.overruns).toBe(1);
      expect(JSON.parse(readFileSync(statePath, 'utf8')).neuronsEstimated).toBeCloseTo(a.charged, 5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an overrun that reaches a cap stops further calls', async () => {
    const inner = spyAi(over);
    const b2 = mkBudget({ runCap: 400 }); // one reservation (~384) fits under it
    expect(b2.capReached).toBe(false);
    const ai = budgetedAi(inner, b2);
    await ai.run(M, input()); // reserved ~384 < 400; charged ~ 1.1*(9000*26636+1500*204818)/1e6 = ~600
    expect(b2.capReached).toBe(true);
    await expect(ai.run(M, input())).rejects.toBeInstanceOf(BudgetExceeded);
    expect(inner.calls).toBe(1);
  });

  it('usage that is missing or partial leaves the reservation standing', async () => {
    for (const reply of [{ response: {} }, { response: {}, usage: {} }, { response: {}, usage: { prompt_tokens: 100 } }, { response: {}, usage: { prompt_tokens: 'x', completion_tokens: 5 } }]) {
      const b = mkBudget();
      await budgetedAi(spyAi(reply), b).run(M, input());
      expect(b.attempts[0]).toMatchObject({ basis: 'reserved_only', charged: b.attempts[0]!.reserved, overrun: false });
    }
  });

  it('a daily cap passed by an overrun is reported as reached', () => {
    const b = mkBudget({ dailyBaseline: 7_990 });
    expect(b.capReached).toBe(false);
    expect(mkBudget({ dailyBaseline: 8_000 }).capReached).toBe(true);
    expect(mkBudget({ dailyBaseline: 8_100 }).refusal(1)).toMatch(/already reached/);
  });
});

describe('reservations happen BEFORE the call', () => {
  it('a refused attempt makes no call', async () => {
    const inner = spyAi({ response: {}, usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const ai = budgetedAi(inner, mkBudget({ runCap: 100 })); // one attempt reserves ~330
    await expect(ai.run(M, input())).rejects.toBeInstanceOf(BudgetExceeded);
    expect(inner.calls).toBe(0);
  });

  it('the run cap stops the run: reservations accumulate, and the next attempt that would pass the cap is refused with no call', async () => {
    const inner = spyAi({ response: {} }); // usage NOT reported: every reservation stands
    const b = mkBudget({ runCap: 1000 });
    const ai = budgetedAi(inner, b);
    const each = worstCaseNeurons(input(), M).neurons; // about 333
    let done = 0;
    for (let i = 0; i < 5; i++) {
      try { await ai.run(M, input()); done++; } catch (e) { expect(e).toBeInstanceOf(BudgetExceeded); expect((e as BudgetExceeded).cap).toBe('run'); break; }
    }
    expect(done).toBe(Math.floor(1000 / each));
    expect(inner.calls).toBe(done);
    expect(b.runTotal).toBeLessThanOrEqual(1000);
  });

  it('the daily cap counts the baseline and stops first when it is lower than the run cap', async () => {
    const inner = spyAi({ response: {} });
    const ai = budgetedAi(inner, mkBudget({ runCap: 6000, dailyCap: 8000, dailyBaseline: 7900 }));
    await expect(ai.run(M, input())).rejects.toMatchObject({ cap: 'daily' });
    expect(inner.calls).toBe(0);
  });

  it('whichever cap is reached first is the one reported', async () => {
    const b = mkBudget({ runCap: 6000, dailyCap: 8000, dailyBaseline: 3000 });
    expect(b.refusal(4000)).toBeNull();
    expect(b.refusal(5500)).toMatch(/daily cap/); // 3000 + 5500 > 8000 even though 5500 < 6000
    expect(mkBudget({ runCap: 100 }).refusal(200)).toMatch(/run cap/);
  });
});

describe('what stays charged afterwards', () => {
  it('measured usage replaces the reservation (with a 10% margin), never exceeding it', async () => {
    const b = mkBudget();
    const ai = budgetedAi(spyAi({ response: {}, usage: { prompt_tokens: 500, completion_tokens: 400 } }), b);
    await ai.run(M, input());
    const a = b.attempts[0]!;
    expect(a.basis).toBe('measured');
    expect(a.charged).toBeCloseTo(((500 * 26_636 + 400 * 204_818) / 1e6) * 1.1, 5);
    expect(a.charged).toBeLessThan(a.reserved);
  });

  it('when usage is NOT reported the conservative reservation stands', async () => {
    const b = mkBudget();
    await budgetedAi(spyAi({ response: {} }), b).run(M, input());
    expect(b.attempts[0]).toMatchObject({ basis: 'reserved_only', charged: b.attempts[0]!.reserved });
  });

  it('when the call fails (timeout, network, quota) the reservation stands: consumption is unknown', async () => {
    const b = mkBudget();
    const ai = budgetedAi(spyAi(() => { throw new Error('timeout'); }), b);
    await expect(ai.run(M, input())).rejects.toThrow('timeout');
    expect(b.attempts[0]).toMatchObject({ basis: 'kept_after_error', charged: b.attempts[0]!.reserved });
  });

  it('a repair is a second attempt with its own reservation', async () => {
    const b = mkBudget();
    const ai = budgetedAi(spyAi({ response: {} }), b);
    await ai.run(M, input());
    await ai.run(M, input()); // the repair
    expect(b.attempts).toHaveLength(2);
    expect(b.runTotal).toBeCloseTo(b.attempts[0]!.charged + b.attempts[1]!.charged, 5);
  });
});

describe('the ledger is durable', () => {
  it('is written after every reservation and settlement, and read back as the next run\'s baseline for the same day only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-budget-'));
    try {
      const statePath = join(dir, 'usage.json');
      const b = mkBudget({ statePath, dailyBaseline: 1000 });
      const inner: Ai = { run: async () => { expect(JSON.parse(readFileSync(statePath, 'utf8')).neuronsEstimated).toBeGreaterThan(1000); return { response: {} }; } };
      await budgetedAi(inner, b).run(M, input()); // the reservation was on disk before the call returned
      const saved = JSON.parse(readFileSync(statePath, 'utf8')) as { day: string; neuronsEstimated: number };
      expect(saved).toMatchObject({ day: '2026-11-01' });
      expect(saved.neuronsEstimated).toBeCloseTo(1000 + b.runTotal, 5);
      expect(loadDailyBaseline(statePath, '2026-11-01')).toBeCloseTo(saved.neuronsEstimated, 5);
      expect(loadDailyBaseline(statePath, '2026-11-02')).toBe(0);
      expect(loadDailyBaseline(join(dir, 'missing.json'), '2026-11-01')).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a multi-chunk run stops cleanly when the budget cannot cover another attempt', () => {
  const SAMPLE = 'scopecheck-realistic';
  async function run(runCap: number, simulate = false) {
    const budget = mkBudget({ runCap });
    const counter = new SqliteAdmission(':memory:');
    const oracle = oracleAi([loadSample(SAMPLE)]);
    // The model does not report usage here, so every reservation stands (the conservative case).
    const silent: Ai = { run: async (m, i) => { const o = (await oracle.run(m, i)) as { usage?: unknown }; delete o.usage; return o; } };
    const ai = budgetedAi(silent, budget);
    const transport = new LocalTransport({ ai, counter, env: { DAILY_ADMISSION_CEILING: '1000', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '5000' } });
    const r = await runBenchmark({
      mode: 'mock', model: 'mock-oracle', label: 't', transport, sampleIds: [SAMPLE], limits: { maxChars: 1800, maxBlocks: 400 }, attemptBudget: 1000, simulateCoverageConfirmation: simulate,
      // the same gate the CLI uses: the exact messages the Worker would send for this chunk
      gate: (schemaId, chunk) => {
        const profile = PROFILES[schemaId]!;
        return budget.refusal(worstCaseNeurons({ messages: buildMessages(profile, chunk.map(toRequestBlock), false), max_tokens: profile.maxOutputTokens }, M).neurons);
      },
    });
    counter.close();
    return { r, budget };
  }

  it('chunks the budget cannot cover are recorded as not sent, the document is incomplete, and no absence is confirmed even with coverage asserted', async () => {
    const { r, budget } = await run(1000, true);
    const sent = r.requests.filter((q) => q.code !== 'neuron_budget_exhausted');
    const refused = r.requests.filter((q) => q.code === 'neuron_budget_exhausted');
    expect(sent.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
    expect(budget.runTotal).toBeLessThanOrEqual(1000);
    const doc = r.samples[0]!.docs.find((d) => d.docId === 'quote-b')!;
    expect(doc.processingComplete).toBe(false);
    const absent = r.samples[0]!.findings.produced.filter((f) => f.code === 'item.absent' && f.response === 'quote-b');
    expect(absent.length).toBeGreaterThan(0);
    expect(absent.every((f) => f.state === 'needs_review' && f.reason === 'processing_incomplete')).toBe(true);
    expect(r.summary.requests).toBe(sent.length); // refused chunks are not counted as requests
  });

  it('with a sufficient cap every chunk is sent', async () => {
    const { r } = await run(60_000);
    expect(r.requests.every((q) => q.ok)).toBe(true);
    expect(r.samples[0]!.docs.every((d) => d.processingComplete)).toBe(true);
  });
});

describe('preflight: the plan is checked before any inference', () => {
  const base = { limits: { maxChars: 24_000, maxBlocks: 400 }, timeoutMs: 25_000, model: M };

  it('the default 24,000-character limit leaves the realistic documents single-chunk, and a multi-chunk requirement refuses it', async () => {
    const p = await planRun({ ...base, samples: ['scopecheck-realistic'], minChunks: 2 });
    expect(p.docs.map((d) => d.chunks.length)).toEqual([1, 1, 1]);
    expect(p.problems.filter((x) => /at least 2 are required/.test(x))).toHaveLength(3);
  });

  it('a smaller limit makes every document multi-chunk', async () => {
    const p = await planRun({ ...base, samples: ['scopecheck-realistic'], limits: { maxChars: 2600, maxBlocks: 400 }, minChunks: 2 });
    expect(p.docs.every((d) => d.chunks.length > 1)).toBe(true);
    expect(p.problems.some((x) => /at least 2 are required/.test(x))).toBe(false);
  });

  it('refuses a plan whose chunks would exceed the output cap or the timeout (a truncated or timed-out chunk is a failed chunk that still costs an attempt)', async () => {
    const p = await planRun({ ...base, samples: ['scopecheck-realistic'], limits: { maxChars: 2600, maxBlocks: 400 }, attemptBudget: 16 });
    expect(p.problems.some((x) => /output cap/.test(x))).toBe(true);
    expect(p.problems.some((x) => /timeout/.test(x))).toBe(true);
  });

  it('refuses a plan with more requests than attempts, and one that leaves no attempt for a repair', async () => {
    const many = await planRun({ ...base, samples: ['scopecheck-realistic'], limits: { maxChars: 700, maxBlocks: 400 }, attemptBudget: 16 });
    expect(many.requests).toBeGreaterThan(16);
    expect(many.problems.some((x) => /only 16 attempts/.test(x))).toBe(true);
    const tight = await planRun({ ...base, samples: ['scopecheck'], attemptBudget: 3 });
    expect(tight.problems).toContain('no attempts are left for a repair');
  });

  it('accepts a plan that fits: small documents, one chunk each, with headroom', async () => {
    const p = await planRun({ ...base, samples: ['scopecheck'], attemptBudget: 8, runNeuronCap: 6000, dailyHeadroom: 6000 });
    expect(p.problems).toEqual([]);
    expect(p.requests).toBe(3);
  });

  it('refuses a plan whose worst-case reservations pass the run cap or the daily headroom', async () => {
    const p = await planRun({ ...base, samples: ['scopecheck'], attemptBudget: 8, runNeuronCap: 500, dailyHeadroom: 400 });
    expect(p.problems.some((x) => /run cap/.test(x))).toBe(true);
    expect(p.problems.some((x) => /headroom/.test(x))).toBe(true);
  });

  it('the CLI prints the plan and exits 2 for a refused plan, without a model, credentials or any charge', () => {
    const cli = ['tsx', 'tools/benchmark/src/cli.ts', '--mode', 'mock', '--sample', 'scopecheck-realistic', '--preflight-only', '--max-chars', '2600', '--min-chunks', '2', '--max-attempts', '16'];
    const r = spawnSync('npx', cli, { cwd: join(__dirname, '../../..'), encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/chunk limits: maxChars=2600/);
    expect(r.stdout).toMatch(/PREFLIGHT FAILED/);
    expect(r.stderr).toMatch(/No inference was attempted. Nothing was charged./);
  });

  it('the CLI exits 0 for a plan that fits', () => {
    const out = execFileSync('npx', ['tsx', 'tools/benchmark/src/cli.ts', '--mode', 'mock', '--sample', 'scopecheck', '--preflight-only', '--max-attempts', '8'], { cwd: join(__dirname, '../../..'), encoding: 'utf8' });
    expect(out).toMatch(/preflight passed/);
  });
});

describe('preflight with the output-aware chunker', () => {
  const params = { maxChars: 24_000, maxBlocks: 400, maxValues: DEFAULT_MAX_VALUES, overlap: 0, headingContext: true };
  const base = { limits: { maxChars: 24_000, maxBlocks: 400 }, chunker: outputChunker(params), model: M, samples: ['scopecheck-realistic'] };

  it('plans the full-length RFQ within the budget, and every request within the output cap and the timeout by estimate', async () => {
    const p = await planRun({ ...base, docFilter: ['rfq'], timeoutMs: 25_000, attemptBudget: 16, runNeuronCap: 6000, dailyHeadroom: 6000 });
    expect(p.problems).toEqual([]);
    expect(p.requests).toBe(6);
    expect(p.expectedNeurons).toBeLessThan(p.worstCaseNeurons); // the sum of worst cases is not the spend
    expect(p.peakReservation).toBeLessThan(p.worstCaseNeurons);
  });

  it('the complete comparison does not fit the 16 attempts, and the plan says so', async () => {
    const p = await planRun({ ...base, timeoutMs: 25_000, attemptBudget: 16, runNeuronCap: 6000, dailyHeadroom: 6000 });
    expect(p.requests).toBeGreaterThan(16);
    expect(p.problems.some((x) => /only 16 attempts/.test(x))).toBe(true);
    expect(p.problems.some((x) => /neurons/.test(x))).toBe(false); // neurons are not the binding limit
  });

  it('a forecast that passes 90% of the timeout only at the slowest measured rate is a warning, not a refusal', async () => {
    const p = await planRun({ ...base, docFilter: ['rfq'], timeoutMs: 22_000, attemptBudget: 16 });
    expect(p.problems.filter((x) => /timeout/.test(x))).toEqual([]);
    expect(p.warnings.some((x) => /slowest measured rate/.test(x))).toBe(true);
  });

  it('a forecast over the whole timeout at the typical rate is refused', async () => {
    const p = await planRun({ ...base, docFilter: ['rfq'], timeoutMs: 15_000, attemptBudget: 16 });
    expect(p.problems.some((x) => /typical rate/.test(x))).toBe(true);
  });

  it('the label counts are a diagnostic: refusals do not change when they are absent', async () => {
    const a = await planRun({ ...base, docFilter: ['rfq'], timeoutMs: 25_000, attemptBudget: 16 });
    expect(a.docs[0]!.chunks.every((c) => typeof c.labelledValues === 'number')).toBe(true);
    expect(a.docs[0]!.chunks.map((c) => c.estimatedValues)).toEqual([14, 12, 12, 12, 12, 12]);
  });

  it('an end-to-end offline run with the output-aware chunker sends every chunk and completes every document', async () => {
    const counter = new SqliteAdmission(':memory:');
    const transport = new LocalTransport({ ai: oracleAi([loadSample('scopecheck-realistic')]), counter, env: { DAILY_ADMISSION_CEILING: '1000', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '5000' } });
    const r = await runBenchmark({ mode: 'mock', model: 'mock-oracle', label: 't', transport, sampleIds: ['scopecheck-realistic'], limits: params, chunker: outputChunker(params), attemptBudget: 1000 });
    counter.close();
    expect(r.requests.map((q) => q.docId + ':' + q.ok).filter((x) => x.endsWith('false'))).toEqual([]);
    expect(r.requests.filter((q) => q.docId === 'rfq')).toHaveLength(6);
    expect(r.samples[0]!.docs.every((d) => d.processingComplete)).toBe(true);
  });
});

describe('an overrun in a multi-chunk run stops the remaining chunks', () => {
  it('reported usage far above the reservation passes the cap; every later chunk is recorded as not sent', async () => {
    const SAMPLE = 'scopecheck-realistic';
    const params = { maxChars: 24_000, maxBlocks: 400, maxValues: DEFAULT_MAX_VALUES, overlap: 0, headingContext: true };
    const budget = mkBudget({ runCap: 1000 });
    const oracle = oracleAi([loadSample(SAMPLE)]);
    const heavy: Ai = { run: async (m, i) => { const o = (await oracle.run(m, i)) as { usage?: unknown }; o.usage = { prompt_tokens: 40_000, completion_tokens: 1500 }; return o; } };
    const counter = new SqliteAdmission(':memory:');
    const transport = new LocalTransport({ ai: budgetedAi(heavy, budget), counter, env: { DAILY_ADMISSION_CEILING: '1000', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '5000' } });
    const r = await runBenchmark({
      mode: 'mock', model: 'mock-oracle', label: 't', transport, sampleIds: [SAMPLE], docFilter: ['rfq'], limits: params, chunker: outputChunker(params), attemptBudget: 1000,
      gate: (schemaId, chunk) => { const p = PROFILES[schemaId]!; return budget.refusal(worstCaseNeurons({ messages: buildMessages(p, chunk.map(toRequestBlock), false), max_tokens: p.maxOutputTokens }, M).neurons); },
    });
    counter.close();
    expect(budget.attempts).toHaveLength(1); // exactly one call was made
    expect(budget.attempts[0]!.overrun).toBe(true);
    expect(budget.capReached).toBe(true);
    expect(budget.runTotal).toBeGreaterThan(1000); // the overrun was recorded in full, not capped at the reservation
    expect(r.requests.filter((q) => q.code === 'neuron_budget_exhausted')).toHaveLength(5);
    expect(r.samples[0]!.docs[0]!.processingComplete).toBe(false);
  });
});

describe('resuming a document after a failed chunk', () => {
  it('reuses the chunks that succeeded, sends only the failed one, and the document becomes complete', async () => {
    const SAMPLE = 'scopecheck-realistic';
    const params = { maxChars: 24_000, maxBlocks: 400, maxValues: DEFAULT_MAX_VALUES, overlap: 0, headingContext: true };
    const go = async (defects: Parameters<typeof oracleAi>[1], resume?: Parameters<typeof runBenchmark>[0]['resume']) => {
      const counter = new SqliteAdmission(':memory:');
      const transport = new LocalTransport({ ai: oracleAi([loadSample(SAMPLE)], defects), counter, env: { DAILY_ADMISSION_CEILING: '1000', MAX_REPAIR_ATTEMPTS: '0', INFERENCE_TIMEOUT_MS: '5000' } });
      const r = await runBenchmark({ mode: 'mock', model: 'mock-oracle', label: 't', transport, sampleIds: [SAMPLE], docFilter: ['rfq'], limits: params, chunker: outputChunker(params), attemptBudget: 1000, resume });
      counter.close();
      return r;
    };
    const first = await go({ failChunkWhen: (b) => b.some((x) => x.id === 'rfq-p1-l30' || x.id.endsWith('p2-l3')) });
    const failed = first.requests.filter((q) => !q.ok).map((q) => q.chunk);
    expect(failed.length).toBe(1);
    expect(first.samples[0]!.docs[0]!.processingComplete).toBe(false);
    const okChunks = first.requests.filter((q) => q.ok).map((q) => q.chunk);
    const second = await go(undefined, { rfq: { okChunks, claims: first.samples[0]!.docs[0]!.claimsReturned } });
    expect(second.requests.filter((q) => !q.reused)).toHaveLength(1); // only the failed chunk was sent
    expect(second.requests.filter((q) => q.reused)).toHaveLength(5);
    expect(second.samples[0]!.docs[0]!.processingComplete).toBe(true);
    const whole = await go(undefined);
    expect(second.samples[0]!.docs[0]!.claimsReturned).toHaveLength(whole.samples[0]!.docs[0]!.claimsReturned.length);
  });
});
