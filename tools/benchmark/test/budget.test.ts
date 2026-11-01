import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASELINE_MODEL } from '../src/candidates';
import { oracleAi, type Ai } from '../src/ai';
import { SqliteAdmission } from '../src/admission';
import { BudgetExceeded, NeuronBudget, budgetedAi, loadDailyBaseline, worstCaseNeurons } from '../src/budget';
import { PROFILES, buildMessages } from '../../../services/extraction-api/src/profiles';
import { planRun } from '../src/preflight';
import { runBenchmark } from '../src/run';
import { loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';

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
  it('assumes the whole output allowance and a prompt of one token per three characters', () => {
    const w = worstCaseNeurons(input(3000, 1500), M);
    expect(w.promptTokens).toBe(1000);
    expect(w.completionTokens).toBe(1500);
    expect(w.neurons).toBeCloseTo((1000 * 26_636 + 1500 * 204_818) / 1e6, 5);
  });
  it('an input without an output allowance is reserved as if it were large', () => {
    expect(worstCaseNeurons({ messages: [{ content: 'x' }] }, M).completionTokens).toBeGreaterThanOrEqual(4096);
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
        return budget.refusal(worstCaseNeurons({ messages: buildMessages(profile, chunk, false), max_tokens: profile.maxOutputTokens }, M).neurons);
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
