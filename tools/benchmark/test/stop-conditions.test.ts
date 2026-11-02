import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteAdmission } from '../src/admission';
import { oracleAi, type Ai, type MockDefects } from '../src/ai';
import { NeuronBudget, budgetedAi, requestClaim } from '../src/budget';
import { BASELINE_MODEL } from '../src/candidates';
import { DEFAULT_MAX_VALUES, outputChunker } from '../src/chunking';
import { runBenchmark, type BenchmarkResult } from '../src/run';
import { loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';

// The live runner's stop conditions, offline (a scripted mock model; no live call anywhere in this file).
//   - an unrecovered schema error stops all further requests;
//   - each response is validated and audited BEFORE the next chunk is dispatched, and an unsupported value accepted as
//     validated stops the batch at once;
//   - values that differ from labels, conservative holds and extraction misses are observations and never stop anything.
// In every stop, completed responses and every usage charge are kept.

const SAMPLE = 'scopecheck-fresh';
const M = BASELINE_MODEL;
const DOCS = ['rfq', 'quote-a', 'quote-b']; // 12 chunks in the frozen plan
const params = { maxChars: 24_000, maxBlocks: 400, maxValues: DEFAULT_MAX_VALUES, overlap: 0, headingContext: true };
const BAD = { response: 'not json', usage: { prompt_tokens: 100, completion_tokens: 3 } };

type Script = (call: number) => 'ok' | 'bad';
/** a model that follows a script by call number and counts every call that reaches it */
function scripted(inner: Ai, script: Script, events?: string[]) {
  const s = { calls: 0 };
  const ai: Ai & typeof s = Object.assign(s, {
    async run(model: string, input: unknown) {
      const n = ++s.calls;
      events?.push(`call ${n}`);
      return script(n) === 'bad' ? structuredClone(BAD) : inner.run(model, input);
    },
  });
  return ai;
}

async function run(o: { script?: Script; defects?: MockDefects; flags?: Partial<Parameters<typeof runBenchmark>[0]>; runCap?: number; docs?: string[]; attemptBudget?: number; maxRepairs?: number; events?: string[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sk-stop-'));
  const statePath = join(dir, 'usage.json');
  const budget = new NeuronBudget({ model: M, runCap: o.runCap ?? 3000, dailyCap: 8000, dailyBaseline: 0, day: '2026-11-02', statePath });
  const model = scripted(oracleAi([loadSample(SAMPLE)], o.defects), o.script ?? (() => 'ok'), o.events);
  const counter = new SqliteAdmission(':memory:');
  const repairs = o.maxRepairs ?? 1;
  const transport = new LocalTransport({ ai: budgetedAi(model, budget), counter, env: { DAILY_ADMISSION_CEILING: '1000', MAX_REPAIR_ATTEMPTS: String(repairs), INFERENCE_TIMEOUT_MS: '5000' } });
  const result: BenchmarkResult = await runBenchmark({
    mode: 'mock', model: 'mock', label: 't', transport, sampleIds: [SAMPLE], docFilter: o.docs ?? DOCS, limits: params, chunker: outputChunker(params),
    attemptBudget: o.attemptBudget ?? 16, maxRepairAttempts: repairs, claim: requestClaim(budget, M),
    ...o.flags,
  });
  counter.close();
  const ledger = JSON.parse(readFileSync(statePath, 'utf8')) as { neuronsEstimated: number };
  rmSync(dir, { recursive: true, force: true });
  return { result, budget, model, ledger };
}
const codes = (r: BenchmarkResult) => r.requests.map((q) => (q.ok ? 'ok' : q.code));

describe('an unrecovered schema error stops all further requests', () => {
  // call 1 answers; calls 2 and 3 (the second request and its one repair) are not valid JSON
  const script: Script = (n) => (n === 2 || n === 3 ? 'bad' : 'ok');
  const flags = { stopOnSchemaError: true };

  it('no request is made after it: not in the document, and not in later documents', async () => {
    const { result, model } = await run({ script, flags });
    expect(model.calls).toBe(3); // request 1, request 2, and request 2's single repair. Nothing after.
    expect(codes(result)).toEqual(['ok', 'schema_invalid', ...Array(10).fill('stopped_after_schema_invalid')]);
    expect(result.summary.stop).toMatchObject({ reason: 'schema_invalid', docId: 'rfq', chunk: 2 });
    expect(result.requests.filter((q) => q.code?.startsWith('stopped_after_')).every((q) => q.attemptsCharged === 0 && q.ms === 0)).toBe(true);
  });

  it('control: without the stop condition the same script carries on (the stop is what prevents the later calls)', async () => {
    const { model, result } = await run({ script });
    expect(model.calls).toBeGreaterThan(3);
    expect(result.summary.stop).toBeNull();
  });

  it('the completed response is preserved, the incomplete document is marked so, and nothing is called complete or covered', async () => {
    const { result } = await run({ script, flags });
    const rfq = result.samples[0]!.docs.find((d) => d.docId === 'rfq')!;
    const first = result.requests[0]!;
    expect(first.ok).toBe(true);
    expect(rfq.claimsReturned).toHaveLength(first.claims);
    expect(first.claims).toBeGreaterThan(0);
    for (const d of result.samples[0]!.docs) {
      expect(d.processingComplete).toBe(false);
      expect(d.coverage).not.toBe('confirmed');
    }
  });

  it('every usage charge is kept: three attempts in the budget and the ledger, equal to what was spent', async () => {
    const { budget, ledger, result } = await run({ script, flags });
    expect(budget.attempts).toHaveLength(3);
    expect(budget.attempts.every((a) => a.charged > 0 && a.basis === 'measured')).toBe(true); // the invalid answers reported usage too
    expect(ledger.neuronsEstimated).toBeCloseTo(budget.dailyTotal, 6);
    expect(budget.runTotal).toBeCloseTo(budget.attempts.reduce((n, a) => n + a.charged, 0), 6);
    expect(result.requests.reduce((n, q) => n + q.attemptsCharged, 0)).toBe(3);
  });

  it('a schema error that the repair FIXES does not stop anything', async () => {
    const { result, model } = await run({ script: (n) => (n === 2 ? 'bad' : 'ok'), flags });
    expect(model.calls).toBe(13); // 12 requests, one of them repaired
    expect(result.requests.filter((q) => q.repaired)).toHaveLength(1);
    expect(result.summary.stop).toBeNull();
    expect(result.requests.every((q) => q.ok)).toBe(true);
  });

  it('with repairs disabled the first invalid answer is unrecovered and stops at once', async () => {
    const { model, result } = await run({ script: (n) => (n === 1 ? 'bad' : 'ok'), flags, maxRepairs: 0 });
    expect(model.calls).toBe(1);
    expect(result.summary.stop).toMatchObject({ reason: 'schema_invalid', docId: 'rfq', chunk: 1 });
  });
});

describe('each response is validated and audited before the next chunk is dispatched', () => {
  // an audit that calls one validated value in RFQ chunk 2 (the LB-3115 row, block p1-l21) unsupported by its evidence
  const audit = (f: { docId: string; evidence: { blockId: string }[] }) => (f.docId === 'rfq' && f.evidence.some((e) => e.blockId === 'p1-l21') ? ('suspect' as const) : ('consistent' as const));
  const flags = { stopOnUnsupportedValue: true, audit: audit as never };

  it('an unsupported value accepted as validated stops the batch immediately: the next chunk is never called', async () => {
    const { result, model } = await run({ flags });
    expect(model.calls).toBe(2); // chunk 1, and chunk 2 whose response held the unsupported value
    expect(codes(result)).toEqual(['ok', 'ok', ...Array(10).fill('stopped_after_unsupported_value_validated')]);
    expect(result.summary.stop).toMatchObject({ reason: 'unsupported_value_validated', docId: 'rfq', chunk: 2 });
    expect(result.summary.stop!.detail).toMatch(/not supported by their own evidence/);
  });

  it('control: without the stop the same audit changes nothing and all 12 requests are made', async () => {
    const { result, model } = await run({ flags: { audit: audit as never } });
    expect(model.calls).toBe(12);
    expect(result.summary.stop).toBeNull();
  });

  it('the response that held the value is preserved (nothing is discarded), and its charge counted', async () => {
    const { result, budget, ledger } = await run({ flags });
    const rfq = result.samples[0]!.docs.find((d) => d.docId === 'rfq')!;
    expect(result.requests[1]).toMatchObject({ ok: true, chunk: 2 });
    expect(result.requests[1]!.claims).toBeGreaterThan(0);
    expect(rfq.claimsReturned).toHaveLength(result.requests[0]!.claims + result.requests[1]!.claims);
    expect(budget.attempts).toHaveLength(2);
    expect(budget.attempts.every((a) => a.basis === 'measured' && a.charged > 0)).toBe(true);
    expect(ledger.neuronsEstimated).toBeCloseTo(budget.dailyTotal, 6);
  });

  it('ORDER: the audit of a response happens before the next chunk\'s model call (control run, no stop), so the stop can prevent that call', async () => {
    const events: string[] = [];
    const tracing = (f: { docId: string; evidence: { blockId: string }[] }) => {
      const hit = f.docId === 'rfq' && f.evidence.some((e) => e.blockId === 'p1-l21');
      if (hit && events.at(-1) !== 'audit:rfq#2 sees the value') events.push('audit:rfq#2 sees the value'); // several facts share the row: record once
      return 'consistent' as const; // never suspect here, so nothing stops
    };
    await run({ flags: { stopOnUnsupportedValue: true, audit: tracing as never }, events });
    const i = events.indexOf('audit:rfq#2 sees the value');
    expect(i).toBeGreaterThan(-1);
    expect(events.slice(0, i)).toEqual(['call 1', 'call 2']); // the audit came after call 2 ...
    expect(events[i + 1]).toBe('call 3'); // ... and before call 3 (the next chunk's)
  });

  it('the REAL audit does not stop ideal extraction, including values with decimals, slashes and connectors', async () => {
    const { result, model } = await run({ flags: { stopOnUnsupportedValue: true } });
    expect(model.calls).toBe(12);
    expect(result.summary.stop).toBeNull();
  });

  it('a stop in the middle of a LATER document keeps everything from the earlier documents', async () => {
    const lateAudit = (f: { docId: string }) => (f.docId === 'quote-a' ? ('suspect' as const) : ('consistent' as const));
    const { result, model } = await run({ flags: { stopOnUnsupportedValue: true, audit: lateAudit as never } });
    expect(model.calls).toBe(5); // rfq 4 chunks, then quote-a chunk 1
    expect(result.summary.stop).toMatchObject({ docId: 'quote-a', chunk: 1 });
    expect(result.samples[0]!.docs.find((d) => d.docId === 'rfq')!.processingComplete).toBe(true);
    expect(codes(result).slice(0, 5)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
  });
});

describe('observations never stop a batch', () => {
  const flags = { stopOnServiceErrors: true, stopOnSchemaError: true, stopOnUnsupportedValue: true, stopOnBudget: true };

  it('values that differ from their labels are observations: every code dropped from every item value, all 12 requests are made', async () => {
    const { result, model } = await run({ defects: { dropItemCodes: true }, flags });
    expect(model.calls).toBe(12);
    expect(result.summary.stop).toBeNull();
    expect(result.samples[0]!.docs.reduce((n, d) => n + d.extraction.outcomes.wrong_value, 0)).toBeGreaterThan(20);
  });

  it('extraction misses are observations: a chunk that returns nothing does not stop the next', async () => {
    const { result, model } = await run({ defects: { emptyChunkWhen: (b) => b.some((x) => x.id === 'p1-l21') }, flags });
    expect(model.calls).toBe(12);
    expect(result.summary.stop).toBeNull();
    expect(result.samples[0]!.docs.reduce((n, d) => n + d.extraction.outcomes.missed, 0)).toBeGreaterThan(0);
  });

  it('a value held for review (conservative) is an observation', async () => {
    // an ambiguous reading in a label that the labels want held: not in this set, so use a value the validator holds: remove the unit
    const { result, model } = await run({ defects: { omit: (_d, f) => f.field === 'exclusion' }, flags });
    expect(model.calls).toBe(12);
    expect(result.summary.stop).toBeNull();
  });
});

describe('a budget refusal stops sending for good', () => {
  it('after the first refusal nothing later is sent, even a chunk small enough to fit', async () => {
    const one = 380; // about one reservation
    const { result, model, budget } = await run({ runCap: Math.ceil(one * 1.3), flags: { stopOnBudget: true, stopOnServiceErrors: true } });
    const sent = result.requests.filter((q) => q.attemptsCharged > 0).length;
    expect(model.calls).toBe(sent);
    const firstRefused = result.requests.findIndex((q) => q.code === 'neuron_budget_exhausted');
    expect(firstRefused).toBeGreaterThan(-1);
    expect(result.requests.slice(firstRefused + 1).every((q) => q.code?.startsWith('stopped_after_neuron_budget_exhausted'))).toBe(true);
    expect(result.summary.stop).toMatchObject({ reason: 'neuron_budget_exhausted' });
    expect(budget.runTotal).toBeLessThanOrEqual(Math.ceil(one * 1.3));
  });
});
