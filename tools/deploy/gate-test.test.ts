import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdmitResult } from '../../services/extraction-api/src/admission';
import { handle } from '../../services/extraction-api/src/handler';
import { health } from '../../services/extraction-api/src/health';
import { SECRET_FILE, createSecret, destroySecret, readSecret } from './gate-secret';
import { buildPayloads, runGateTest, TEST_ORIGIN, type Http, type Payload, type StepId } from './gate-test';

// The gate test runner, offline: driven against the REAL handler and health check with the staging configuration and a mocked
// model, so the sequence, the stop conditions and the attempt budget are exercised exactly as they will run.

const TOKEN = 't'.repeat(43);
const STAGING = {
  ACCESS_GATE: 'token', TEST_GATE_TOKEN: TOKEN, ALLOWED_ORIGINS: TEST_ORIGIN, DAILY_ADMISSION_CEILING: '4',
  MAX_BODY_BYTES: '8192', MAX_CHARS: '6000', MAX_BLOCKS: '80', MAX_BLOCK_CHARS: '1000', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '25000',
};
const DAY = Date.UTC(2026, 10, 3, 12, 0, 0);

type Reply = 'ok' | 'bad' | 'no_usage' | 'throw';
function fakeWorker(replies: Reply[], opts: { startUsed?: number; ms?: number } = {}) {
  const state = { used: opts.startUsed ?? 0, modelCalls: 0, extractRequests: 0 };
  const counter = {
    admit: async (c: number): Promise<AdmitResult> => (state.used >= c ? { ok: false, used: state.used, ceiling: c } : { ok: true, used: ++state.used, ceiling: c }),
    usedToday: async () => state.used,
  };
  const ai = {
    run: async (_m: string, input: unknown) => {
      const kind = replies[state.modelCalls++] ?? 'ok';
      if (kind === 'throw') throw new Error('capacity temporarily exceeded');
      if (kind === 'bad') return { response: 'not json' };
      const blockId = (JSON.parse(((input as { messages: { content: string }[] }).messages[1]!.content).split('\n').slice(1).join('\n')) as { blocks: { id: string; text: string }[] }).blocks[0]!;
      const claims = [{ field: 'item', blockId: blockId.id, excerpt: blockId.text.slice(0, 5), value: blockId.text.slice(0, 5) }];
      return kind === 'no_usage' ? { response: { claims } } : { response: { claims }, usage: { prompt_tokens: 600, completion_tokens: 400 } };
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
  const run = (w: ReturnType<typeof fakeWorker>, now = () => DAY) => runGateTest({ http: w.http, token: TOKEN, payloads, now });

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
