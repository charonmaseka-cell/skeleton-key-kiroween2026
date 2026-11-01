import { toRequestBlock } from '@skeleton-key/engine';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SqliteAdmission } from '../src/admission';
import { oracleAi, type Ai } from '../src/ai';
import { Batch, batchAi } from '../src/batch';
import { NeuronBudget, budgetedAi, requestClaim } from '../src/budget';
import { BASELINE_MODEL } from '../src/candidates';
import { DEFAULT_MAX_VALUES, frozenChunker, outputChunker, type FrozenPlan } from '../src/chunking';
import { recordingAi } from '../src/recording';
import { recoverFromRaw } from '../src/recover';
import { runBenchmark } from '../src/run';
import { loadBlocks, loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';
import { buildMessages, getProfile, responseFormat } from '../../../services/extraction-api/src/profiles';

// A process can die between a model call and the writing of the result file (it did, once: the run was started from a tool call that
// ended). The raw log is what survives. These tests rebuild the successful chunks from it, never resend them, keep the unsettled
// call's reservation in the batch, and never lower a charge. Offline; no live call.

const dir = mkdtempSync(join(tmpdir(), 'sk-recover-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const REPO = join(__dirname, '../../..');
const SAMPLE = 'scopecheck-fresh';
const M = BASELINE_MODEL;
const plan = JSON.parse(readFileSync(join(REPO, 'samples/scopecheck-fresh/chunk-plan.json'), 'utf8')) as FrozenPlan;
const params = { maxChars: 24_000, maxBlocks: 400, maxValues: DEFAULT_MAX_VALUES, overlap: 0, headingContext: true };

/** the exact request the Worker sends for chunk `i` (1-based) of a document */
async function requestFor(docId: string, i: number) {
  const doc = loadSample(SAMPLE).docs.find((d) => d.id === docId)!;
  const blocks = await loadBlocks(SAMPLE, doc);
  const chunk = frozenChunker(plan)(docId, blocks, doc.schemaId).chunks[i - 1]!;
  const p = getProfile(doc.schemaId)!;
  return { messages: buildMessages(p, chunk.map(toRequestBlock), false), response_format: responseFormat(p), max_tokens: p.maxOutputTokens };
}

/** a raw log of an interrupted run: call 1 (RFQ chunk 1) answered, call 2 (RFQ chunk 2) started and never returned */
async function interruptedLog(name: string) {
  const f = join(dir, name);
  const oracle = oracleAi([loadSample(SAMPLE)]);
  let n = 0;
  const rec = recordingAi({ run: (m, i) => (++n === 1 ? oracle.run(m, i) : new Promise(() => undefined)) }, f); // the second call never settles
  await rec.run(M, await requestFor('rfq', 1));
  void rec.run(M, await requestFor('rfq', 2));
  await new Promise((r) => setTimeout(r, 20));
  return f;
}

describe('recovering the successful chunks from a raw log', () => {
  it('rebuilds the answered chunk, verified by the SHA-256 of the exact request; the call with no end line recovers nothing', async () => {
    const f = await interruptedLog('r1.jsonl');
    const r = await recoverFromRaw({ rawFile: f, sampleId: SAMPLE, plan, repo: REPO });
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0]).toMatchObject({ docId: 'rfq', chunk: 1, ok: true, recoveredFromRawLog: true, rawCall: 1 });
    expect(r.callsWithoutResponse).toEqual([2]);
    expect(r.successfulCallsNotMatchedToAChunk).toEqual([]);
    // the claims are exactly what the Worker returns for that chunk
    const counter = new SqliteAdmission(':memory:');
    const transport = new LocalTransport({ ai: oracleAi([loadSample(SAMPLE)]), counter, env: { DAILY_ADMISSION_CEILING: '100', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '5000' } });
    const live = await runBenchmark({ mode: 'mock', model: 'm', label: 't', transport, sampleIds: [SAMPLE], docFilter: ['rfq'], limits: params, chunker: outputChunker(params), attemptBudget: 99 });
    counter.close();
    const own = new Set(plan.docs[0]!.chunks[0]!.blockIds);
    const expected = (live.samples[0]!.docs[0]!.claimsReturned as { blockId: string }[]).filter((c) => own.has(c.blockId));
    expect(r.samples[0]!.docs[0]!.claimsReturned).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it('does not accept a response whose request hash does not match any chunk of the plan', async () => {
    const f = await interruptedLog('r2.jsonl');
    const tampered = readFileSync(f, 'utf8').replace(/"promptSha256":"[0-9a-f]{64}"/, `"promptSha256":"${'0'.repeat(64)}"`);
    writeFileSync(f, tampered);
    const r = await recoverFromRaw({ rawFile: f, sampleId: SAMPLE, plan, repo: REPO });
    expect(r.requests).toHaveLength(0);
    expect(r.successfulCallsNotMatchedToAChunk).toEqual([1]);
    expect(r.callsWithoutResponse).toEqual([2]);
  });

  it('does not recover an invalid answer (it was not a successful chunk)', async () => {
    const f = join(dir, 'r3.jsonl');
    const rec = recordingAi({ run: async () => ({ response: 'not json', usage: { prompt_tokens: 1, completion_tokens: 1 } }) }, f);
    await rec.run(M, await requestFor('quote-a', 1));
    expect((await recoverFromRaw({ rawFile: f, sampleId: SAMPLE, plan, repo: REPO })).requests).toHaveLength(0);
  });
});

describe('pairing is by order, not by call number alone', () => {
  it('two recorders writing to one file (both numbering from 1) cannot lend one call\'s response to another', async () => {
    const f = join(dir, 'r5.jsonl');
    await recordingAi(oracleAi([loadSample(SAMPLE)]), f).run(M, await requestFor('rfq', 1));
    void recordingAi({ run: () => new Promise(() => undefined) }, f).run(M, await requestFor('rfq', 2)); // also n = 1, never settles
    await new Promise((r) => setTimeout(r, 20));
    const r = await recoverFromRaw({ rawFile: f, sampleId: SAMPLE, plan, repo: REPO });
    expect(r.requests.map((q) => (q as { chunk: number }).chunk)).toEqual([1]);
  });
});

describe('the batch after an interrupted run', () => {
  it('counts an attempt AND its reservation at dispatch, so a call that never returns is already in the batch', async () => {
    const batch = Batch.open(join(dir, 'b1.json'), 'b1', { attempts: 16, neurons: 3000 });
    batch.begin('x');
    const budget = new NeuronBudget({ model: M, runCap: 3000, dailyCap: 8000, dailyBaseline: 0, day: '2026-11-02' });
    const never: Ai = { run: () => new Promise(() => undefined) };
    const ai = batchAi(never, batch, (inner) => budgetedAi(inner, budget), () => budget);
    void ai.run(M, await requestFor('rfq', 1));
    await new Promise((r) => setTimeout(r, 20));
    const onDisk = JSON.parse(readFileSync(join(dir, 'b1.json'), 'utf8'));
    expect(onDisk.attemptsUsed).toBe(1);
    expect(onDisk.neuronsCharged).toBeGreaterThan(300); // the reservation stands
    expect(onDisk.neuronsCharged).toBeGreaterThanOrEqual(budget.runTotal);
  });

  it('marks the interrupted invocation on the next begin, and keeps what it had used', () => {
    const batch = Batch.open(join(dir, 'b2.json'), 'b2', { attempts: 16, neurons: 3000 });
    batch.begin('first');
    batch.attemptStarted();
    batch.begin('second'); // the first never recorded an end
    expect(batch.state.invocations[0]!.interrupted).toBe(true);
    expect(batch.state.invocations[1]!.interrupted).toBeUndefined();
    expect(batch.state.attemptsUsed).toBe(1);
  });

  it('reconciliation raises the neuron charge, never lowers it, and records why', () => {
    const batch = Batch.open(join(dir, 'b3.json'), 'b3', { attempts: 16, neurons: 3000 });
    batch.begin('x');
    batch.syncNeurons(100.74);
    batch.reconcileNeurons(464.297, 'reservation of a call that never returned');
    expect(batch.state.neuronsCharged).toBeCloseTo(464.297, 3);
    batch.reconcileNeurons(200, 'a lower figure');
    expect(batch.state.neuronsCharged).toBeCloseTo(464.297, 3); // not lowered
    expect(batch.state.reconciliations).toHaveLength(1);
    expect(batch.state.reconciliations![0]).toMatchObject({ before: 100.74 });
    expect(batch.remainingNeurons).toBeCloseTo(3000 - 464.297, 3);
  });

  it('end to end: the recovered chunk is reused and NOT resent; the unanswered chunk is sent again; the allowance carries over', async () => {
    const f = await interruptedLog('r4.jsonl');
    const recovered = await recoverFromRaw({ rawFile: f, sampleId: SAMPLE, plan, repo: REPO });
    const recFile = join(dir, 'recovered.json');
    writeFileSync(recFile, JSON.stringify(recovered));
    const batch = Batch.open(join(dir, 'b4.json'), 'b4', { attempts: 16, neurons: 3000 });
    batch.begin('crashed');
    batch.attemptStarted(); batch.attemptStarted(); // two calls were dispatched by the crashed run
    batch.syncNeurons(464.297);
    batch.addResultFile(recFile);
    batch.begin('resume');
    const prior = JSON.parse(readFileSync(batch.state.resultFiles[0]!, 'utf8')) as { requests: { docId: string; chunk: number; ok: boolean }[]; samples: { docs: { docId: string; claimsReturned: unknown[] }[] }[] };
    const resume = Object.fromEntries(prior.samples[0]!.docs.map((d) => [d.docId, { okChunks: prior.requests.filter((r) => r.docId === d.docId && r.ok).map((r) => r.chunk), claims: d.claimsReturned }]));
    expect(resume.rfq!.okChunks).toEqual([1]);
    const budget = new NeuronBudget({ model: M, runCap: batch.remainingNeurons, dailyCap: 8000, dailyBaseline: 0, day: '2026-11-02' });
    const raw = recordingAi(oracleAi([loadSample(SAMPLE)]), join(dir, 'r4b.jsonl'));
    const counter = new SqliteAdmission(':memory:');
    const transport = new LocalTransport({ ai: batchAi(raw, batch, (i) => budgetedAi(i, budget), () => budget), counter, env: { DAILY_ADMISSION_CEILING: '100', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '5000' } });
    const r = await runBenchmark({ mode: 'mock', model: 'm', label: 't', transport, sampleIds: [SAMPLE], docFilter: ['rfq'], limits: params, chunker: outputChunker(params), attemptBudget: batch.remainingAttempts, claim: requestClaim(budget, M), resume, stopOnSchemaError: true });
    counter.close();
    expect(raw.calls).toBe(3); // rfq chunks 2, 3 and 4 only. Chunk 1 was not resent.
    expect(r.requests.filter((q) => q.reused).map((q) => q.chunk)).toEqual([1]);
    expect(r.requests.every((q) => q.ok)).toBe(true);
    expect(batch.state.attemptsUsed).toBe(2 + 3); // carried over, not reset
    expect(batch.state.neuronsCharged).toBeGreaterThan(464.297);
    expect(batch.state.neuronsCharged).toBeLessThanOrEqual(3000);
  });
});
