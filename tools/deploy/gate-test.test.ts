import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReserveRequest, ReserveResult, SettleResult } from '../../services/extraction-api/src/admission';
import { handle } from '../../services/extraction-api/src/handler';
import { health } from '../../services/extraction-api/src/health';
import { SECRET_FILE, createSecret, destroySecret, readSecret } from './gate-secret';
import { buildPayloads, dailyBaseline, runGateTest, DAILY_NEURON_CAP, RUN_NEURON_CAP, TEST_ORIGIN, type GateTestResult, type Http, type Payload, type StepId } from './gate-test';

// The gate test runner, offline: driven against the REAL handler and health check with the staging configuration and a mocked
// model, so the sequence, the stop conditions and the attempt budget are exercised exactly as they will run.

const TOKEN = 't'.repeat(43);
const STAGING = {
  ACCESS_GATE: 'token', TEST_GATE_TOKEN: TOKEN, ALLOWED_ORIGINS: TEST_ORIGIN, DAILY_ADMISSION_CEILING: '4', DAILY_NEURON_BUDGET: '2000',
  MAX_BODY_BYTES: '8192', MAX_CHARS: '6000', MAX_BLOCKS: '80', MAX_BLOCK_CHARS: '1000', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '25000',
};
const DAY = Date.UTC(2026, 10, 3, 12, 0, 0);

type Reply = 'ok' | 'bad' | 'no_usage' | 'throw' | 'huge_usage' | 'unlocatable';
function fakeWorker(replies: Reply[], opts: { startUsed?: number; ms?: number } = {}) {
  const state = { used: 0 + (opts.startUsed ?? 0), modelCalls: 0, extractRequests: 0 };
  const counter = {
    reserve: async (req: ReserveRequest): Promise<ReserveResult> => (state.used >= req.ceiling ? { ok: false, reason: 'attempts', used: state.used, charged: 0 } : { ok: true, id: ++state.used, used: state.used, charged: 0 }),
    settle: async (): Promise<SettleResult> => ({ settled: true, charged: 0, reserved: 0, overrun: false }),
    usedToday: async () => state.used,
    budgetToday: async () => ({ attempts: state.used, charged: 0, unsettled: 0, overruns: 0 }),
  };
  const ai = {
    run: async (_m: string, input: unknown) => {
      const kind = replies[state.modelCalls++] ?? 'ok';
      if (kind === 'throw') throw new Error('capacity temporarily exceeded');
      if (kind === 'bad') return { response: 'not json' };
      const msgs = (input as { messages: { content: string }[] }).messages;
      const field = /- (\w+) \(/.exec(msgs[0]!.content)![1]!; // the profile's first field
      const b = (JSON.parse(msgs[1]!.content.split('\n').slice(1).join('\n')) as { blocks: { id: string; text: string }[] }).blocks[0]!;
      const excerpt = kind === 'unlocatable' ? `${b.text.slice(0, 5)} not in the block` : b.text.slice(0, 5);
      const claims = [{ field, blockId: b.id, excerpt, value: excerpt }];
      if (kind === 'no_usage') return { response: { claims } };
      return { response: { claims }, usage: kind === 'huge_usage' ? { prompt_tokens: 3000, completion_tokens: 2500 } : { prompt_tokens: 600, completion_tokens: 400 } };
    },
  };
  const http: Http = async (path, init) => {
    const req = new Request(`https://gate.test${path}`, { method: init.method, headers: init.headers, body: init.body });
    if (path === '/health') { const r = await health(STAGING, { now: () => DAY, ai, counter }); return { status: r.status, json: await r.json(), ms: 1 }; }
    state.extractRequests++;
    const r = await handle(req, STAGING, { now: () => DAY, counter, ai, log: () => undefined });
    return { status: r.status, json: await r.json(), ms: opts.ms ?? 1200 };
  };
  return { http, state };
}

let payloads: Record<StepId, Payload>;
beforeAll(async () => { payloads = await buildPayloads(); }, 60_000);

describe('exact test payloads (built offline from the sample PDFs and frozen plans)', () => {
  it('match the measured sizes in docs/results/task-5-5-reservations.json and fit the staging limits', () => {
    const size = (s: StepId) => Buffer.byteLength(payloads[s].body);
    expect(payloads.T2.id).toBe('scopecheck-realistic/rfq#6');
    expect(size('T1')).toBe(375);
    expect(size('T2')).toBe(4753);
    expect(size('T3')).toBe(3495);
    expect(size('T4')).toBe(185);
    expect(JSON.parse(payloads.T2.body).blocks).toHaveLength(48);
    for (const s of ['T1', 'T2', 'T3', 'T4'] as StepId[]) expect(size(s)).toBeLessThanOrEqual(8192);
  });
});

describe('runGateTest sequence', () => {
  const run = (w: ReturnType<typeof fakeWorker>, now = () => DAY, extra: Partial<Parameters<typeof runGateTest>[0]> = {}) => runGateTest({ http: w.http, token: TOKEN, payloads, now, ...extra });

  it('no repair: T1..T4 use the 4 attempts, then R is refused with daily_limit; 4 model calls in total', async () => {
    const w = fakeWorker([]);
    const r = await run(w);
    expect(r.verdict).toBe('pass');
    expect(r.prechecks.every((p) => p.ok)).toBe(true);
    expect(r.steps.map((s) => s.step)).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect(r.refusal).toMatchObject({ status: 429, code: 'daily_limit', counterBefore: 4, counterAfter: 4 });
    expect(w.state.modelCalls).toBe(4);
    expect(r.counterEnd).toBe(4);
  });

  it('a repair in T2 uses the 4th slot: T4 is skipped, R is still refused, still 4 model calls', async () => {
    const w = fakeWorker(['ok', 'bad', 'ok', 'ok']);
    const r = await run(w);
    expect(r.verdict).toBe('pass');
    expect(r.steps.map((s) => [s.step, s.attempts])).toEqual([['T1', 1], ['T2', 2], ['T3', 1]]);
    expect(r.skipped.map((s) => s.step)).toEqual(['T4']);
    expect(w.state.modelCalls).toBe(4);
  });

  it('T3 needing a repair when only one slot is left: the repair is refused, the run stops, no refusal request is sent', async () => {
    const w = fakeWorker(['bad', 'ok', 'ok', 'bad']);
    const r = await run(w);
    expect(r.verdict).toBe('fail');
    expect(r.stop).toMatchObject({ at: 'T3' });
    expect(r.refusal).toBeNull();
    expect(w.state.modelCalls).toBe(4);
    expect(r.counterEnd).toBe(4);
  });

  it.each<[string, Reply[], string]>([
    ['model error in T1', ['throw'], 'T1'],
    ['missing usage in T2', ['ok', 'no_usage'], 'T2'],
  ])('%s: stops at once and sends nothing more', async (_n, replies, at) => {
    const w = fakeWorker(replies);
    const r = await run(w);
    expect(r.stop?.at).toBe(at);
    expect(r.refusal).toBeNull();
    expect(r.inferenceRequestsSent).toBe(r.steps.length);
    expect(w.state.extractRequests).toBe(3 + r.steps.length); // the 3 zero-cost refusal prechecks + the steps run
  });

  it('latency at the timeout stops the run', async () => {
    const r = await run(fakeWorker([], { ms: 25_000 }));
    expect(r.stop?.at).toBe('T1');
  });

  it('a non-zero counter at the start fails P1: no inference', async () => {
    const w = fakeWorker([], { startUsed: 1 });
    const r = await run(w);
    expect(r.stop?.at).toBe('P1 health');
    expect(w.state.modelCalls).toBe(0);
    expect(w.state.extractRequests).toBe(0);
  });

  it('less than an hour before 00:00 UTC: nothing is sent', async () => {
    const w = fakeWorker([]);
    const r = await run(w, () => Date.UTC(2026, 10, 3, 23, 30));
    expect(r.stop?.at).toBe('P0 time before 00:00 UTC');
    expect(w.state.extractRequests + w.state.modelCalls).toBe(0);
  });

  it('if the UTC day changes before R, R is not sent (the counter would have reset)', async () => {
    let t = Date.UTC(2026, 10, 3, 19, 50);
    const w = fakeWorker([]);
    const r = await run(w, () => (t += 130 * 60_000)); // start reads 22:00 (P0 passes); the next read, before R, is 00:10 the next day
    expect(r.refusal).toBeNull();
    expect(r.verdict).toBe('fail');
    expect(r.stop?.at).toBe('R');
  });

  it('the token never appears in the result', async () => {
    const r = await run(fakeWorker([]));
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe('runner gap 1: claims are validated and audited before the next step', () => {
  const run = (w: ReturnType<typeof fakeWorker>, extra: Partial<Parameters<typeof runGateTest>[0]> = {}) => runGateTest({ http: w.http, token: TOKEN, payloads, now: () => DAY, ...extra });

  it('a value accepted as validated that its evidence does not support stops the run at once; nothing more is sent', async () => {
    const w = fakeWorker([]);
    const r = await run(w, { audit: (f) => (f.status === 'validated' ? 'suspect' : null) });
    expect(r.verdict).toBe('fail');
    expect(r.stop?.at).toBe('T1');
    expect(r.stop?.reason).toMatch(/^unsupported_value_validated/);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]!.observations!.suspect.length).toBeGreaterThan(0);
    expect(w.state.modelCalls).toBe(1);
    expect(w.state.extractRequests).toBe(3 + 1);
    expect(r.refusal).toBeNull();
  });

  it('values held for review are observations, not stops: the run continues and passes', async () => {
    const w = fakeWorker(['unlocatable', 'unlocatable', 'ok', 'ok']);
    const r = await run(w);
    expect(r.verdict).toBe('pass');
    // an excerpt that is not in its block is held for review by the client's validation: recorded, not a stop
    for (const s of r.steps.slice(0, 2)) {
      const o = s.observations!;
      expect(o.validated).toBe(0);
      expect(Object.values(o.heldForReview).reduce((n, x) => n + x, 0)).toBe(1);
      expect(o.suspect).toEqual([]);
    }
    expect(r.steps).toHaveLength(4);
  });

  it('a step with no claims at all (an extraction miss) is an observation, not a stop', async () => {
    const w = fakeWorker([]);
    const r = await run(w, { audit: () => null });
    expect(r.verdict).toBe('pass');
    expect(r.steps.every((s) => s.observations && s.observations.suspect.length === 0)).toBe(true);
  });

  it('the real audit passes the well-formed claims of every frozen payload', async () => {
    const r = await run(fakeWorker([]));
    expect(r.verdict).toBe('pass');
    expect(r.steps.map((s) => s.observations!.validated)).toEqual([1, 1, 1, 1]);
  });
});

describe('runner gap 2: neuron reservations against the run cap (2,000) and the daily cap (8,000)', () => {
  const run = (w: ReturnType<typeof fakeWorker>, extra: Partial<Parameters<typeof runGateTest>[0]> = {}) => runGateTest({ http: w.http, token: TOKEN, payloads, now: () => DAY, ...extra });

  it('caps are the authorised ones', () => {
    expect(RUN_NEURON_CAP).toBe(2000);
    expect(DAILY_NEURON_CAP).toBe(8000);
  });

  it('reservations are the guaranteed (1 byte per token) worst case of the exact payloads, and the worst 4-attempt path fits 2,000', () => {
    // Published neuron rates (26,668 / 204,805 per million). The run of 2 Nov 2026 used the earlier rates (384.6, 387.8, 512.9,
    // 516.0 here); its record keeps those figures.
    expect(Math.round(payloads.T1.reserve.first * 10) / 10).toBe(384.7);
    expect(Math.round(payloads.T1.reserve.repair * 10) / 10).toBe(387.8);
    expect(Math.round(payloads.T2.reserve.first * 10) / 10).toBe(513.1);
    expect(Math.round(payloads.T2.reserve.repair * 10) / 10).toBe(516.2);
    const worst = payloads.T1.reserve.first + payloads.T2.reserve.first + payloads.T2.reserve.repair + payloads.T3.reserve.first;
    expect(worst).toBeLessThan(2000);
    expect(worst).toBeGreaterThan(1893);
  });

  it('measured attempts are charged from reported tokens; unused repair reservations are released', async () => {
    const r = await run(fakeWorker([]));
    expect(r.budget.attempts.map((a) => [a.step, a.basis])).toEqual([['T1', 'measured'], ['T2', 'measured'], ['T3', 'measured'], ['T4', 'measured']]);
    const one = Math.ceil(((600 * 26_668 + 400 * 204_805) / 1e6) * 1.1 * 1000) / 1000;
    expect(r.budget.runCharged).toBeCloseTo(4 * one, 2);
  });

  it('a repaired request: the first attempt (usage unknown) keeps its reservation, the second is measured', async () => {
    const r = await run(fakeWorker(['ok', 'bad', 'ok', 'ok']));
    const t2 = r.budget.attempts.filter((a) => a.step === 'T2');
    expect(t2.map((a) => a.basis)).toEqual(['kept_unknown', 'measured']);
    expect(t2[0]!.charged).toBe(t2[0]!.reserved);
  });

  it('an overrun is charged in full, recorded, and not clipped to the reservation', async () => {
    const r = await run(fakeWorker(['huge_usage']));
    const a = r.budget.attempts[0]!;
    expect(a.overrun).toBe(true);
    expect(a.charged).toBeGreaterThan(a.reserved);
    expect(a.charged).toBeCloseTo(((3000 * 26_668 + 2500 * 204_805) / 1e6) * 1.1, 1);
    expect(r.budget.overruns).toBeGreaterThanOrEqual(1);
  });

  it('a failed request keeps every attempt it used at its reservation', async () => {
    const r = await run(fakeWorker(['throw']));
    expect(r.stop?.at).toBe('T1');
    expect(r.budget.attempts).toHaveLength(1);
    expect(r.budget.attempts[0]).toMatchObject({ basis: 'kept_unknown' });
    expect(r.budget.runCharged).toBeCloseTo(payloads.T1.reserve.first, 2);
  });

  it('missing usage keeps the reservation and stops', async () => {
    const r = await run(fakeWorker(['no_usage']));
    expect(r.stop?.reason).toBe('token usage not reported');
    expect(r.budget.attempts[0]).toMatchObject({ basis: 'kept_unknown' });
  });

  it('daily cap: a step whose reservation would pass 8,000 is not sent', async () => {
    const w = fakeWorker([]);
    const r = await run(w, { dailyBaseline: { neurons: 7_500, sources: ['test'] } });
    expect(r.stop?.at).toBe('T1');
    expect(r.stop?.reason).toMatch(/^daily cap 8000/);
    expect(w.state.modelCalls).toBe(0);
    expect(r.budget.attempts).toEqual([]);
  });

  it('daily cap already reached: nothing is sent, not even the prechecks', async () => {
    const w = fakeWorker([]);
    const r = await run(w, { dailyBaseline: { neurons: 8_000, sources: ['test'] } });
    expect(r.stop?.at).toBe('P0 daily budget headroom');
    expect(w.state.extractRequests).toBe(0);
  });

  it('run cap: with unknown usage piling up, a step that could pass 2,000 is not sent', async () => {
    // every reply is a repair-then-success, so each first attempt stays at its reservation
    const w = fakeWorker(['bad', 'huge_usage', 'bad', 'huge_usage']);
    const r = await run(w);
    expect(r.stop?.reason).toMatch(/run cap 2000|neuron cap reached/);
    expect(r.budget.runCharged).toBeLessThanOrEqual(2000 + 700); // at most one measured overrun beyond a reservation
    expect(w.state.modelCalls).toBeLessThanOrEqual(4);
  });
});

describe('partial results survive a failure', () => {
  it('persist is called after every step, and the last write holds everything up to the stop', async () => {
    const writes: GateTestResult[] = [];
    const w = fakeWorker(['ok', 'throw']);
    const r = await runGateTest({ http: w.http, token: TOKEN, payloads, now: () => DAY, persist: (x) => writes.push(JSON.parse(JSON.stringify(x))) });
    expect(writes.length).toBeGreaterThan(5);
    const last = writes[writes.length - 1]!;
    expect(last.complete).toBe(true);
    expect(last.steps.map((s) => s.step)).toEqual(['T1', 'T2']);
    expect(last.stop?.at).toBe('T2');
    expect(last.budget.runCharged).toBe(r.budget.runCharged);
    // a write made while T2 was in flight already records its reservation
    expect(writes.some((x) => !x.complete && x.budget.attempts.some((a) => a.step === 'T2' && a.basis === 'reserved'))).toBe(true);
    expect(JSON.stringify(writes)).not.toContain(TOKEN);
  });
});

describe('daily baseline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-baseline-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it('is the larger of the local ledger and the committed records for the UTC day', () => {
    const results = join(dir, 'results');
    mkdirSync(results);
    writeFileSync(join(results, 'batch-a.json'), JSON.stringify({ neuronsCharged: 746.897, invocations: [{ startedAt: '2026-11-02T00:00:16Z' }] }));
    writeFileSync(join(results, 'batch-b.json'), JSON.stringify({ neuronsCharged: 2000, invocations: [{ startedAt: '2026-11-01T10:00:00Z' }] }));
    const ledger = join(dir, 'ledger.json');
    const gate = join(dir, 'gate.json');
    expect(dailyBaseline('2026-11-02', { ledgerFile: ledger, resultsDir: results, gateFile: gate }).neurons).toBe(746.897);
    writeFileSync(ledger, JSON.stringify({ day: '2026-11-02', neuronsEstimated: 900 }));
    expect(dailyBaseline('2026-11-02', { ledgerFile: ledger, resultsDir: results, gateFile: gate }).neurons).toBe(900);
    writeFileSync(gate, JSON.stringify({ startedAt: '2026-11-02T08:00:00Z', budget: { runCharged: 500 } }));
    expect(dailyBaseline('2026-11-02', { ledgerFile: ledger, resultsDir: results, gateFile: gate }).neurons).toBeCloseTo(1246.897, 3);
    expect(dailyBaseline('2026-11-03', { ledgerFile: ledger, resultsDir: results, gateFile: gate }).neurons).toBe(0);
  });
  it('the committed records for 2026-11-02 already hold the second-model batch', () => {
    expect(dailyBaseline('2026-11-02', { ledgerFile: join(dir, 'none.json'), gateFile: join(dir, 'none2.json') }).neurons).toBeCloseTo(746.897, 3);
  });
});

describe('gate secret file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-secret-'));
  const file = join(dir, 'gate', 'secret');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('is generated with mode 600, 43 base64url characters, never overwritten, and only metadata is returned', () => {
    const r = createSecret(file);
    expect(r).toEqual({ created: true, length: 43 });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const v = readSecret(file);
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createSecret(file)).toEqual({ created: false, length: 43 });
    expect(readSecret(file)).toBe(v);
    expect(JSON.stringify(r)).not.toContain(v);
  });

  it('refuses a file readable by others', () => {
    const f = join(dir, 'loose');
    writeFileSync(f, 'a'.repeat(43), { mode: 0o644 });
    expect(() => readSecret(f)).toThrow(/permissions/);
  });

  it('is destroyed on request', () => {
    expect(destroySecret(file)).toBe(true);
    expect(destroySecret(file)).toBe(false);
  });

  it('the real secret path is git-ignored', () => {
    const repo = new URL('../../', import.meta.url).pathname;
    expect(execFileSync('git', ['check-ignore', SECRET_FILE], { cwd: repo, encoding: 'utf8' }).trim()).toBe(SECRET_FILE);
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toMatch(/^\.benchmark-state\/$/m);
  });
});
