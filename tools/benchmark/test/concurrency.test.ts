import { describe, expect, it } from 'vitest';
import { SqliteAdmission } from '../src/admission';
import { oracleAi, type Ai, type MockDefects } from '../src/ai';
import { NeuronBudget, budgetedAi, requestClaim, worstCaseNeurons } from '../src/budget';
import { BASELINE_MODEL } from '../src/candidates';
import { DEFAULT_MAX_VALUES, outputChunker } from '../src/chunking';
import { runBenchmark } from '../src/run';
import { loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';
import { PROFILES, buildMessages } from '../../../services/extraction-api/src/profiles';

// Bounded concurrency: offline only (a mock model with injected delays). No live call is made anywhere in this file.
// The properties that matter are safety properties: the in-flight bound, atomic budget claims, bounded attempts and
// repairs, deterministic output, and what happens to requests already in flight when a run must stop.

const SAMPLE = 'scopecheck-realistic';
const M = BASELINE_MODEL;
const params = { maxChars: 24_000, maxBlocks: 400, maxValues: DEFAULT_MAX_VALUES, overlap: 0, headingContext: true };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** wraps a model: delay per call, tracks how many calls overlap, optional usage removal */
function probe(inner: Ai, delayMs: number, opts: { dropUsage?: boolean; delayFor?: (n: number) => number } = {}) {
  const state = { active: 0, peak: 0, calls: 0 };
  const ai: Ai & typeof state = Object.assign(state, {
    async run(model: string, input: unknown) {
      const n = ++state.calls;
      state.active++;
      state.peak = Math.max(state.peak, state.active);
      try {
        await sleep(opts.delayFor?.(n) ?? delayMs);
        const out = (await inner.run(model, input)) as { usage?: unknown };
        if (opts.dropUsage) delete out.usage;
        return out;
      } finally {
        state.active--;
      }
    },
  });
  return ai;
}

type Setup = { concurrency?: number; attemptBudget?: number; ceiling?: number; maxRepairs?: number; timeoutMs?: number; defects?: MockDefects; delayMs?: number; runCap?: number; dropUsage?: boolean; docs?: string[]; delayFor?: (n: number) => number; statePath?: string };
async function run(o: Setup = {}) {
  const budget = new NeuronBudget({ model: M, runCap: o.runCap ?? 6000, dailyCap: 8000, dailyBaseline: 0, day: '2026-11-02', statePath: o.statePath });
  const model = probe(oracleAi([loadSample(SAMPLE)], o.defects), o.delayMs ?? 20, { dropUsage: o.dropUsage, delayFor: o.delayFor });
  const counter = new SqliteAdmission(':memory:');
  const transport = new LocalTransport({ ai: budgetedAi(model, budget), counter, env: { DAILY_ADMISSION_CEILING: String(o.ceiling ?? 1000), MAX_REPAIR_ATTEMPTS: String(o.maxRepairs ?? 1), INFERENCE_TIMEOUT_MS: String(o.timeoutMs ?? 5000) } });
  const result = await runBenchmark({
    mode: 'mock', model: 'mock', label: 't', transport, sampleIds: [SAMPLE], docFilter: o.docs ?? ['rfq'], limits: params, chunker: outputChunker(params),
    attemptBudget: o.attemptBudget ?? 1000, concurrency: o.concurrency, maxRepairAttempts: o.maxRepairs ?? 1, stopOnServiceErrors: true,
    claim: requestClaim(budget, M),
  });
  await budget.whenIdle(2000);
  counter.close();
  return { result, budget, model };
}

describe('the in-flight bound and deterministic output', () => {
  it('never has more than the requested number of requests in flight, and a sequential run stays sequential', async () => {
    for (const c of [1, 2, 3]) {
      const { result, model } = await run({ concurrency: c });
      expect(model.peak).toBeLessThanOrEqual(c);
      expect(result.summary.concurrency).toMatchObject({ requested: c, peakInFlight: c });
      expect(model.peak).toBe(c); // 6 chunks, so the bound is actually reached
    }
  });

  it('the requested number is capped at 3', async () => {
    const { result, model } = await run({ concurrency: 9 });
    expect(model.peak).toBe(3);
    expect(result.summary.concurrency.requested).toBe(3);
  });

  it('the result is identical to the sequential run whatever order the requests finish in', async () => {
    const seq = await run({ concurrency: 1 });
    // later chunks finish first
    const par = await run({ concurrency: 3, delayFor: (n) => 60 - n * 8 });
    const strip = (r: typeof seq.result) => ({
      requests: r.requests.map((q) => ({ chunk: q.chunk, ok: q.ok, claims: q.claims, attemptsCharged: q.attemptsCharged })),
      claims: r.samples[0]!.docs[0]!.claimsReturned,
      complete: r.samples[0]!.docs[0]!.processingComplete,
    });
    expect(strip(par.result)).toEqual(strip(seq.result));
    expect(par.result.requests.map((q) => q.chunk)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('records when each request started and ended, so overlap can be measured', async () => {
    const { result } = await run({ concurrency: 3, delayMs: 40 });
    const sent = result.requests.filter((q) => q.t0 !== undefined);
    expect(sent).toHaveLength(6);
    expect(sent.every((q) => q.t1! >= q.t0!)).toBe(true);
    const overlap = sent.some((a) => sent.some((b) => a !== b && a.t0! < b.t1! && b.t0! < a.t1!));
    expect(overlap).toBe(true);
    expect(result.summary.elapsedMs).toBeLessThan(sent.reduce((n, q) => n + (q.t1! - q.t0!), 0));
  });
});

describe('atomic budget claims', () => {
  it('three requests dispatched together cannot all be admitted on headroom for two: exactly two calls are made and the cap is never passed', async () => {
    const one = worstCaseNeurons({ messages: buildMessages(PROFILES['scopecheck.rfq.v1']!, [{ id: 'x', text: 'x'.repeat(300) } as never], false), max_tokens: 1500 }, M).neurons;
    const cap = Math.ceil(one * 2.4); // room for two reservations, not three
    const { result, budget, model } = await run({ concurrency: 3, runCap: cap, dropUsage: true }); // no usage: every reservation stands
    expect(model.calls).toBeLessThanOrEqual(2);
    expect(model.calls).toBeGreaterThanOrEqual(1);
    expect(budget.runTotal).toBeLessThanOrEqual(cap);
    expect(budget.claimed).toBe(0); // every claim was consumed or released
    expect(result.requests.filter((q) => q.code === 'neuron_budget_exhausted').length).toBe(6 - model.calls);
    expect(result.samples[0]!.docs[0]!.processingComplete).toBe(false);
  });

  it('a request waits for an in-flight request to settle: measured charges are far below reservations, so the waiting request is then sent', async () => {
    // the smallest cap a SEQUENTIAL run needs: the peak of (actual charge so far + the next reservation)
    const seq = await run({ concurrency: 1 });
    let actual = 0;
    let peak = 0;
    for (const a of seq.budget.attempts) { peak = Math.max(peak, actual + a.reserved); actual += a.charged; }
    const cap = Math.ceil(peak) + 1;
    const reservations = seq.budget.attempts.map((a) => a.reserved);
    expect(reservations[0]! + reservations[1]! + reservations[2]!).toBeGreaterThan(cap); // three cannot be held at once
    const { result, model, budget } = await run({ concurrency: 3, runCap: cap });
    expect(result.requests.every((q) => q.ok)).toBe(true); // all six were sent, after waiting
    expect(model.calls).toBe(6);
    expect(model.peak).toBeLessThan(3); // the budget, not the pool, limited the overlap
    expect(budget.runTotal).toBeLessThanOrEqual(cap);
  });

  it('claims alone are exact: a claim holds headroom until released or exchanged for the request\'s own reservation', () => {
    const b = new NeuronBudget({ model: M, runCap: 1000, dailyCap: 8000, dailyBaseline: 0, day: '2026-11-02' });
    const a = b.claim(600);
    expect(a.refusal).toBeNull();
    expect(b.claim(600).refusal).toMatch(/claimed/); // 600 + 600 would pass 1000
    expect(b.claimed).toBe(600);
    a.release();
    expect(b.claimed).toBe(0);
    a.release(); // releasing twice is harmless
    expect(b.claimed).toBe(0);
    expect(b.claim(600).refusal).toBeNull();
  });
});

describe('bounded attempts and repairs', () => {
  it('with every request needing a repair, in-flight requests are budgeted for it: total attempts never pass the allowance', async () => {
    // the first response of every call is invalid, so each request uses 2 attempts
    const { result, model } = await run({ concurrency: 3, attemptBudget: 4, maxRepairs: 1, defects: { badJsonFirst: true }, ceiling: 1000 });
    const used = result.requests.reduce((n, q) => n + q.attemptsCharged, 0);
    expect(used).toBeLessThanOrEqual(4);
    expect(model.calls).toBeLessThanOrEqual(4);
    expect(result.requests.filter((q) => q.code === 'attempt_budget_exhausted').length).toBeGreaterThan(0);
  });

  it('with repairs disabled, every request is one attempt and the allowance bounds the requests', async () => {
    const { result } = await run({ concurrency: 3, attemptBudget: 3, maxRepairs: 0 });
    expect(result.requests.filter((q) => q.attemptsCharged > 0)).toHaveLength(3);
    expect(result.requests.filter((q) => q.code === 'attempt_budget_exhausted')).toHaveLength(3);
  });

  it('each request is charged only for its own admissions, even when requests overlap', async () => {
    const { result } = await run({ concurrency: 3, defects: { badJsonFirst: true } });
    // exactly one call (the very first) gets an invalid answer, whichever request it belongs to
    expect(result.requests.map((q) => q.attemptsCharged).sort()).toEqual([1, 1, 1, 1, 1, 2]);
    expect(result.requests.filter((q) => q.repaired)).toHaveLength(1);
  });
});

describe('stopping with requests in flight', () => {
  it('after the daily allowance is refused nothing new is dispatched; requests already in flight finish and are recorded and charged', async () => {
    const { result, model, budget } = await run({ concurrency: 3, ceiling: 2, delayMs: 30 });
    const ok = result.requests.filter((q) => q.ok);
    expect(ok).toHaveLength(2); // the two admitted before the ceiling
    expect(result.requests.some((q) => q.code === 'daily_limit')).toBe(true);
    expect(result.summary.concurrency.stoppedAfter).toBe('daily_limit');
    expect(result.requests.filter((q) => q.code?.startsWith('stopped_after_')).length).toBeGreaterThan(0);
    expect(model.calls).toBe(2);
    expect(budget.attempts).toHaveLength(2);
    expect(budget.attempts.every((a) => a.basis === 'measured')).toBe(true); // in-flight requests were charged from their usage
    expect(result.samples[0]!.docs[0]!.processingComplete).toBe(false);
  });

  it('a call that outlives the timeout keeps its reservation until it settles, then is charged from its reported usage', async () => {
    const { budget, result } = await run({ concurrency: 2, timeoutMs: 30, delayFor: (n) => (n === 1 ? 200 : 5), docs: ['rfq'] });
    const timedOut = result.requests.find((q) => q.code === 'timeout');
    expect(timedOut).toBeDefined();
    await budget.whenIdle(2000);
    expect(budget.outstanding.size).toBe(0);
    expect(budget.attempts.every((a) => a.basis === 'measured')).toBe(true); // settled late, from the usage it reported
    expect(budget.attempts).toHaveLength(6); // the timed-out request is in the ledger exactly once
  });

  it('whenIdle reports calls still outstanding instead of waiting for ever', async () => {
    const b = new NeuronBudget({ model: M, runCap: 6000, dailyCap: 8000, dailyBaseline: 0, day: '2026-11-02' });
    const never = new Promise<unknown>(() => undefined);
    b.outstanding.add(never);
    expect(await b.whenIdle(60)).toBe(false);
    expect(b.attempts).toHaveLength(0);
  });
});
