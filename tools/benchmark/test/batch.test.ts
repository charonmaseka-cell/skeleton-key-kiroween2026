import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { SqliteAdmission } from '../src/admission';
import { oracleAi, type Ai } from '../src/ai';
import { Batch, BatchExhausted, batchAi } from '../src/batch';
import { NeuronBudget, budgetedAi, requestClaim } from '../src/budget';
import { BASELINE_MODEL } from '../src/candidates';
import { DEFAULT_MAX_VALUES, outputChunker } from '../src/chunking';
import { recordingAi } from '../src/recording';
import { runBenchmark, type BenchmarkResult } from '../src/run';
import { loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';

// A batch has ONE allowance, fixed when it is created and shared by every invocation: resuming cannot reset it, raise it,
// or resend a chunk that already succeeded. Raw model responses are saved as they arrive. Offline; no live call.

const dir = mkdtempSync(join(tmpdir(), 'sk-batch-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const SAMPLE = 'scopecheck-fresh';
const M = BASELINE_MODEL;
const params = { maxChars: 24_000, maxBlocks: 400, maxValues: DEFAULT_MAX_VALUES, overlap: 0, headingContext: true };
const BAD = { response: 'not json', usage: { prompt_tokens: 100, completion_tokens: 3 } };

describe('the batch state', () => {
  it('is created with fixed caps, counts an attempt when it is dispatched, and refuses past the cap', () => {
    const b = Batch.open(join(dir, 'a.json'), 'a', { attempts: 3, neurons: 1000 });
    b.begin('first');
    for (let i = 0; i < 3; i++) b.attemptStarted();
    expect(b.remainingAttempts).toBe(0);
    expect(() => b.attemptStarted()).toThrow(BatchExhausted);
    expect(b.state.attemptsUsed).toBe(3); // the refused one was not counted
  });

  it('is written to disk before the call returns, so a crash cannot forget a dispatched attempt', () => {
    const f = join(dir, 'b.json');
    const b = Batch.open(f, 'b', { attempts: 5, neurons: 1000 });
    b.begin('x');
    b.attemptStarted();
    expect(JSON.parse(readFileSync(f, 'utf8')).attemptsUsed).toBe(1);
  });

  it('CANNOT be reset or raised on resume: reopening keeps what was used, and different caps are refused', () => {
    const f = join(dir, 'c.json');
    const first = Batch.open(f, 'c', { attempts: 16, neurons: 3000 });
    first.begin('one');
    for (let i = 0; i < 7; i++) first.attemptStarted();
    first.syncNeurons(1234.5);
    const again = Batch.open(f, 'c'); // a resume without caps
    expect(again.state).toMatchObject({ attemptCap: 16, neuronCap: 3000, attemptsUsed: 7 });
    expect(again.remainingAttempts).toBe(9);
    expect(again.remainingNeurons).toBeCloseTo(3000 - 1234.5, 3);
    expect(Batch.open(f, 'c', { attempts: 16, neurons: 3000 }).state.attemptsUsed).toBe(7); // same caps: fine, still 7
    expect(() => Batch.open(f, 'c', { attempts: 20, neurons: 3000 })).toThrow(/fixed and cannot be changed or raised/);
    expect(() => Batch.open(f, 'c', { attempts: 16, neurons: 6000 })).toThrow(/fixed/);
    expect(() => Batch.open(f, 'c', { attempts: 5, neurons: 3000 })).toThrow(/fixed/); // not even lowered silently
    expect(() => Batch.open(f, 'other')).toThrow(/belongs to c/);
  });

  it('a batch that does not exist cannot be opened without caps', () => {
    expect(() => Batch.open(join(dir, 'nope.json'), 'nope')).toThrow(/does not exist/);
  });

  it('the CLI refuses a resume with raised caps before it reads credentials or calls anything', () => {
    const id = `test-${process.pid}`;
    const file = join(__dirname, '../../../.benchmark-state/batches', `${id}.json`);
    Batch.open(file, id, { attempts: 16, neurons: 3000 });
    try {
      const r = spawnSync('npx', ['tsx', 'tools/benchmark/src/cli.ts', '--mode', 'live', '--sample', SAMPLE, '--doc', 'rfq', '--frozen-plan', 'samples/scopecheck-fresh/chunk-plan.json', '--batch-id', id, '--batch-attempts', '40', '--batch-neurons', '3000'], { cwd: join(__dirname, '../../..'), encoding: 'utf8', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '' } });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/fixed and cannot be changed or raised/);
      expect(r.stdout).not.toMatch(/LIVE:/);
    } finally {
      rmSync(file, { force: true });
    }
  });
});

describe('across invocations: stop, resume, and the allowance only ever shrinks', () => {
  async function invocation(batch: Batch, o: { script: (n: number) => 'ok' | 'bad'; resumeFrom?: BenchmarkResult; sink?: { calls: number }; flags?: boolean }) {
    batch.begin('inv');
    const budget = new NeuronBudget({ model: M, runCap: batch.remainingNeurons, dailyCap: 8000, dailyBaseline: 0, day: '2026-11-02' });
    const inner = oracleAi([loadSample(SAMPLE)]);
    const counter = { calls: 0 };
    const raw: Ai = { run: async (m, i) => { const n = ++counter.calls; return o.script(n) === 'bad' ? structuredClone(BAD) : inner.run(m, i); } };
    const ai = batchAi(raw, batch, (x) => budgetedAi(x, budget), () => budget);
    const admission = new SqliteAdmission(':memory:');
    const transport = new LocalTransport({ ai, counter: admission, env: { DAILY_ADMISSION_CEILING: '1000', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '5000' } });
    const prior = o.resumeFrom;
    const resume = prior ? Object.fromEntries(prior.samples[0]!.docs.map((d) => [d.docId, { okChunks: prior.requests.filter((r) => r.docId === d.docId && r.ok).map((r) => r.chunk), claims: d.claimsReturned }])) : undefined;
    const result = await runBenchmark({ mode: 'mock', model: 'mock', label: 't', transport, sampleIds: [SAMPLE], docFilter: ['rfq', 'quote-a', 'quote-b'], limits: params, chunker: outputChunker(params), attemptBudget: batch.remainingAttempts, maxRepairAttempts: 1, claim: requestClaim(budget, M), stopOnSchemaError: true, stopOnServiceErrors: true, resume });
    batch.syncNeurons(budget.runTotal);
    batch.end(undefined, result.summary.stop?.reason ?? null);
    admission.close();
    return { result, calls: counter.calls, budget };
  }

  it('a stop uses attempts; the resume sends only the unfinished chunks, never a successful one, and cannot pass the batch cap', async () => {
    const batch = Batch.open(join(dir, 'd.json'), 'd', { attempts: 14, neurons: 3000 });
    // invocation 1: request 1 ok, request 2 and its repair invalid -> unrecovered -> stop. 3 attempts used.
    const one = await invocation(batch, { script: (n) => (n === 2 || n === 3 ? 'bad' : 'ok') });
    expect(one.calls).toBe(3);
    expect(batch.state.attemptsUsed).toBe(3);
    expect(one.result.summary.stop?.reason).toBe('schema_invalid');
    // invocation 2 resumes: chunk 1 of rfq is NOT resent; the other 11 are (11 attempts), within the 11 that remain
    expect(batch.remainingAttempts).toBe(11);
    const two = await invocation(batch, { script: () => 'ok', resumeFrom: one.result });
    expect(two.calls).toBe(11);
    expect(two.result.requests.filter((q) => q.reused)).toHaveLength(1);
    expect(batch.state.attemptsUsed).toBe(14); // 3 + 11: the allowance was carried, not reset
    expect(batch.remainingAttempts).toBe(0);
    expect(two.result.requests.every((q) => q.ok)).toBe(true);
    // invocation 3 has nothing left to spend: the runner is given a budget of 0 and the batch refuses a dispatched attempt
    expect(() => batch.attemptStarted()).toThrow(BatchExhausted);
  });

  it('neurons are carried too: the second invocation\'s cap is what the first left', async () => {
    const batch = Batch.open(join(dir, 'e.json'), 'e', { attempts: 16, neurons: 3000 });
    const one = await invocation(batch, { script: (n) => (n === 2 || n === 3 ? 'bad' : 'ok') });
    const used = batch.state.neuronsCharged;
    expect(used).toBeGreaterThanOrEqual(one.budget.runTotal);
    expect(used - one.budget.runTotal).toBeLessThan(0.001);
    expect(used).toBeGreaterThan(0);
    expect(batch.remainingNeurons).toBeCloseTo(3000 - used, 3);
    const two = await invocation(batch, { script: () => 'ok', resumeFrom: one.result });
    expect(batch.state.neuronsCharged).toBeCloseTo(used + two.budget.runTotal, 2);
    expect(batch.state.neuronsCharged).toBeLessThanOrEqual(3000);
  });

  it('the batch counts every model call, including the one that fails and the repair', async () => {
    const batch = Batch.open(join(dir, 'f.json'), 'f', { attempts: 16, neurons: 3000 });
    const r = await invocation(batch, { script: (n) => (n === 2 || n === 3 ? 'bad' : 'ok') });
    expect(batch.state.attemptsUsed).toBe(r.calls);
    expect(batch.state.invocations).toHaveLength(1);
    expect(batch.state.invocations[0]).toMatchObject({ attemptsAtStart: 0, attemptsEnd: 3, stop: 'schema_invalid' });
  });
});

describe('raw responses are saved as they arrive', () => {
  it('writes a start line before the call and an end line with the exact output and usage; never the prompt or a credential', async () => {
    const f = join(dir, 'raw.jsonl');
    const rec = recordingAi({ run: async () => ({ response: { claims: [{ field: 'item' }] }, usage: { prompt_tokens: 7, completion_tokens: 3 } }) }, f);
    await rec.run('m', { messages: [{ role: 'user', content: 'SECRET PROMPT TEXT' }] });
    const lines = readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.evt)).toEqual(['start', 'end']);
    expect(lines[0]).toMatchObject({ n: 1, model: 'm' });
    expect(lines[0].promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lines[1]).toMatchObject({ n: 1, ok: true, output: { response: { claims: [{ field: 'item' }] }, usage: { prompt_tokens: 7, completion_tokens: 3 } } });
    expect(readFileSync(f, 'utf8')).not.toMatch(/SECRET PROMPT TEXT/);
  });

  it('records a failing call too, and a call that settles after the caller gave up', async () => {
    const f = join(dir, 'raw2.jsonl');
    const rec = recordingAi({ run: async (_m, i) => { if ((i as { fail?: boolean }).fail) throw new Error('upstream down'); await new Promise((r) => setTimeout(r, 30)); return { response: 'late' }; } }, f);
    await expect(rec.run('m', { fail: true })).rejects.toThrow('upstream down');
    void rec.run('m', {}); // not awaited: the caller moves on
    await new Promise((r) => setTimeout(r, 80));
    const lines = readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.filter((l) => l.evt === 'end').map((l) => l.ok)).toEqual([false, true]);
    expect(lines.find((l) => l.error)).toMatchObject({ error: 'upstream down' });
    expect(existsSync(f)).toBe(true);
  });
});

describe('the raw log names the model actually called', () => {
  it('with an override, the recorder sits inside it and logs the overriding model', async () => {
    const { withModel } = await import('../src/candidates');
    const f = join(dir, 'model.jsonl');
    const called: string[] = [];
    const base = { run: async (m: string) => { called.push(m); return { response: { claims: [] } }; } };
    const ai = withModel(recordingAi(base, f), '@cf/meta/llama-3.1-8b-instruct'); // the order the CLI now uses
    await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {});
    const start = JSON.parse(readFileSync(f, 'utf8').split('\n')[0]!);
    expect(start.model).toBe('@cf/meta/llama-3.1-8b-instruct');
    expect(called).toEqual(['@cf/meta/llama-3.1-8b-instruct']);
  });

  it('the CLI composes them in that order', () => {
    const src = readFileSync(join(__dirname, '../src/cli.ts'), 'utf8');
    expect(src).toMatch(/withModel\(recordingAi\(restAi\(/);
    expect(src).not.toMatch(/recordingAi\(model === profileModel \? restAi/);
  });
});
