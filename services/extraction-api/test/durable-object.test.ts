import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Runs the real handler and the real SQLite-backed Durable Object in the local Workers
// runtime (workerd) with a mocked model. "Restart" = dispose the runtime and start a new
// one over the same persisted storage.

const ORIGIN = 'http://localhost:5173';
const root = mkdtempSync(join(tmpdir(), 'sk-do-'));
const script = join(root, 'worker.mjs');

beforeAll(async () => {
  await build({
    entryPoints: [new URL('../test-worker/entry.ts', import.meta.url).pathname],
    outfile: script,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    external: ['cloudflare:*'],
    logLevel: 'silent',
  });
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

const vars = (ceiling: number, extra: Record<string, string> = {}) => ({
  ALLOWED_ORIGINS: ORIGIN,
  ACCESS_GATE: 'public',
  DAILY_ADMISSION_CEILING: String(ceiling),
  DAILY_NEURON_BUDGET: '10000',
  INFERENCE_TIMEOUT_MS: '100',
  ...extra,
});

function start(persist: string, ceiling: number, extra: Record<string, string> = {}) {
  return new Miniflare({
    modules: true,
    scriptPath: script,
    modulesRoot: root,
    compatibilityDate: '2026-07-01',
    durableObjects: { ADMISSION: { className: 'AdmissionCounter', useSQLite: true } },
    durableObjectsPersist: persist,
    bindings: vars(ceiling, extra),
  });
}

let seq = 0;
const freshPersist = () => {
  const p = join(root, `state-${seq++}`);
  mkdirSync(p, { recursive: true });
  return p;
};

type Mf = ReturnType<typeof start>;
const body = (text = 'Organisation: Acme Trust') =>
  JSON.stringify({ schemaId: 'packcheck.grant.v1', blocks: [{ id: 'b1', text }] });

async function call(mf: Mf, headers: Record<string, string> = {}, text?: string) {
  const res = await mf.dispatchFetch('http://worker.test/extract', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: body(text),
  });
  const json = (await res.json()) as { error?: { code: string } };
  return { status: res.status, code: json.error?.code ?? 'ok' };
}
const modelCalls = async (mf: Mf) => Number(await (await mf.dispatchFetch('http://worker.test/__calls')).text());

const DAY1 = Date.UTC(2026, 10, 1, 12, 0, 0);

describe('Durable Object admission counter (real SQLite DO, mocked model)', () => {
  it('concurrent requests cannot exceed the admission ceiling', async () => {
    const mf = start(freshPersist(), 10);
    try {
      const results = await Promise.all(Array.from({ length: 60 }, () => call(mf, { 'x-test-now': String(DAY1) })));
      const ok = results.filter((r) => r.code === 'ok').length;
      const limited = results.filter((r) => r.code === 'daily_limit').length;
      expect(ok).toBe(10);
      expect(limited).toBe(50);
      expect(await modelCalls(mf)).toBe(10); // the model ran exactly as many times as were admitted
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it('counters survive a restart', async () => {
    const persist = freshPersist();
    const h = { 'x-test-now': String(DAY1) };
    let mf = start(persist, 5);
    for (let i = 0; i < 3; i++) expect((await call(mf, h)).code).toBe('ok');
    await mf.dispose();

    mf = start(persist, 5);
    try {
      expect((await call(mf, h)).code).toBe('ok');
      expect((await call(mf, h)).code).toBe('ok');
      expect((await call(mf, h)).code).toBe('daily_limit'); // 3 before + 2 after = 5
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it('resets at 00:00 UTC and not before', async () => {
    const mf = start(freshPersist(), 2);
    const lastMsOfDay = Date.UTC(2026, 10, 1, 23, 59, 59, 999);
    const midnight = Date.UTC(2026, 10, 2, 0, 0, 0, 0);
    try {
      expect((await call(mf, { 'x-test-now': String(DAY1) })).code).toBe('ok');
      expect((await call(mf, { 'x-test-now': String(lastMsOfDay) })).code).toBe('ok');
      expect((await call(mf, { 'x-test-now': String(lastMsOfDay) })).code).toBe('daily_limit');
      expect((await call(mf, { 'x-test-now': String(midnight) })).code).toBe('ok'); // new UTC day
      expect((await call(mf, { 'x-test-now': String(midnight) })).code).toBe('ok');
      expect((await call(mf, { 'x-test-now': String(midnight) })).code).toBe('daily_limit');
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it('inference errors, timeouts and bad output leave the limiter intact and are not refunded', async () => {
    const mf = start(freshPersist(), 5);
    const t = { 'x-test-now': String(DAY1) };
    try {
      expect(await call(mf, { ...t, 'x-mock': 'quota' })).toEqual({ status: 503, code: 'quota_exhausted' }); // 1
      expect(await call(mf, { ...t, 'x-mock': 'down' })).toEqual({ status: 503, code: 'model_unavailable' }); // 2
      expect(await call(mf, { ...t, 'x-mock': 'slow' })).toEqual({ status: 504, code: 'timeout' }); // 3
      expect((await call(mf, { ...t, 'x-mock': 'ok' })).code).toBe('ok'); // 4: limiter still works
      expect((await call(mf, { ...t, 'x-mock': 'bad_json' })).code).toBe('daily_limit'); // 5th admitted, repair (6th) refused
      expect((await call(mf, { ...t, 'x-mock': 'ok' })).code).toBe('daily_limit');
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it('rejected requests never reach the model or consume allowance', async () => {
    const mf = start(freshPersist(), 1);
    const t = { 'x-test-now': String(DAY1) };
    try {
      expect((await call(mf, { ...t, origin: 'https://evil.example' })).code).toBe('origin_denied');
      const bad = await mf.dispatchFetch('http://worker.test/extract', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...t }, body: '{"schemaId":"nope","blocks":[]}' });
      expect(bad.status).toBe(400);
      const pre = await mf.dispatchFetch('http://worker.test/extract', { method: 'OPTIONS', headers: { origin: ORIGIN } });
      expect(pre.status).toBe(204);
      expect(await modelCalls(mf)).toBe(0);
      expect((await call(mf, t)).code).toBe('ok'); // the single allowance was still available
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it('stores no document text or filenames on disk', async () => {
    const persist = freshPersist();
    const mf = start(persist, 5);
    try {
      await call(mf, { 'x-test-now': String(DAY1) }, 'Organisation: UNIQUE-MARKER-TEXT-98765');
    } finally {
      await mf.dispose();
    }
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : files.push(join(d, n))));
    walk(persist);
    expect(files.length).toBeGreaterThan(0); // something was persisted
    for (const f of files) expect(readFileSync(f).includes('UNIQUE-MARKER-TEXT-98765')).toBe(false);
  }, 60_000);
});

describe('GET /health: deployment check with the real Durable Object, no inference', () => {
  const get = async (mf: Mf, headers: Record<string, string> = {}) => {
    const res = await mf.dispatchFetch('http://worker.test/health', { headers });
    return { status: res.status, body: (await res.json()) as { ok: boolean; checks: { configuration: string; workersAiBinding: string; durableObject: { reachable: boolean; usedToday: number; zeroCeilingRefused: boolean; unchangedAfterCheck: boolean }; admission: { dailyCeiling: number; open: boolean } }; inference: string } };
  };

  it('closed deployment (ceiling 0): all checks pass, admission reported closed, the model is never called, and nothing is admitted', async () => {
    const mf = start(freshPersist(), 0);
    try {
      const h = { 'x-test-now': String(DAY1) };
      const r = await get(mf, h);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, inference: 'not called by this check', checks: { configuration: 'valid', workersAiBinding: 'present (not called)', durableObject: { reachable: true, usedToday: 0, zeroCeilingRefused: true, unchangedAfterCheck: true }, admission: { dailyCeiling: 0, open: false } } });
      for (let i = 0; i < 5; i++) await get(mf, h); // repeated checks consume nothing
      expect((await get(mf, h)).body.checks.durableObject.usedToday).toBe(0);
      expect(await modelCalls(mf)).toBe(0);
      expect((await call(mf, h)).code).toBe('daily_limit'); // and /extract stays closed
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it('reads the real count after real admissions, and still admits nothing itself', async () => {
    const mf = start(freshPersist(), 3);
    try {
      const h = { 'x-test-now': String(DAY1) };
      expect((await call(mf, h)).code).toBe('ok');
      expect((await call(mf, h)).code).toBe('ok');
      const r = await get(mf, h);
      expect(r.body.checks.durableObject).toMatchObject({ usedToday: 2, unchangedAfterCheck: true });
      expect(r.body.checks.admission).toEqual({ dailyCeiling: 3, dailyNeuronBudget: 10000, open: true });
      expect((await call(mf, h)).code).toBe('ok'); // the third admission is still available: the check used none
      expect((await call(mf, h)).code).toBe('daily_limit');
      expect(await modelCalls(mf)).toBe(3); // the model ran for the 3 extractions only
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it('a missing Workers AI binding fails the check (503)', async () => {
    const mf = start(freshPersist(), 0);
    try {
      const r = await get(mf, { 'x-no-ai': '1' });
      expect(r.status).toBe(503);
      expect(r.body).toMatchObject({ ok: false, checks: { workersAiBinding: 'missing' } });
    } finally {
      await mf.dispose();
    }
  }, 60_000);
});

describe('gated staging configuration in the Workers runtime (ACCESS_GATE=token)', () => {
  const TOKEN = 'g'.repeat(43);
  const t = { 'x-test-now': String(DAY1) };
  const health = async (mf: Mf) => (await mf.dispatchFetch('http://worker.test/health', { headers: t })).json() as Promise<{ ok: boolean; checks: { accessGate: { mode: string; valid: boolean; credentialBound: boolean } } }>;

  it('without the secret bound: closed (not_configured), health fails, nothing admitted, model not called', async () => {
    const mf = start(freshPersist(), 4, { ACCESS_GATE: 'token' });
    try {
      expect(await call(mf, t)).toEqual({ status: 503, code: 'not_configured' });
      expect(await call(mf, { ...t, authorization: `Bearer ${TOKEN}` })).toEqual({ status: 503, code: 'not_configured' });
      const h = await health(mf);
      expect(h.ok).toBe(false);
      expect(h.checks.accessGate).toMatchObject({ mode: 'token', valid: false, credentialBound: false });
      expect(await modelCalls(mf)).toBe(0);
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it('with the secret: only the right bearer token is admitted, and the ceiling still holds', async () => {
    const mf = start(freshPersist(), 2, { ACCESS_GATE: 'token', TEST_GATE_TOKEN: TOKEN });
    const auth = { ...t, authorization: `Bearer ${TOKEN}` };
    try {
      expect(await call(mf, t)).toEqual({ status: 401, code: 'unauthorized' });
      expect(await call(mf, { ...t, authorization: `Bearer ${'h'.repeat(43)}` })).toEqual({ status: 401, code: 'unauthorized' });
      expect(await call(mf, { ...auth, origin: 'https://elsewhere.example' })).toEqual({ status: 403, code: 'origin_denied' });
      expect(await modelCalls(mf)).toBe(0);
      expect((await call(mf, auth)).code).toBe('ok');
      expect((await call(mf, auth)).code).toBe('ok');
      expect(await call(mf, auth)).toEqual({ status: 429, code: 'daily_limit' });
      expect(await modelCalls(mf)).toBe(2);
      expect((await health(mf)).checks.accessGate).toMatchObject({ mode: 'token', valid: true, credentialBound: true });
    } finally {
      await mf.dispose();
    }
  }, 60_000);
});

describe('neuron budget in the real Durable Object', () => {
  it('concurrent requests whose usage is unknown cannot pass the neuron budget', async () => {
    const mf = start(freshPersist(), 1000, { DAILY_NEURON_BUDGET: '1000' });
    const t = { 'x-test-now': String(DAY1), 'x-mock': 'down' }; // every call fails: each reservation (~300) stands
    try {
      const results = await Promise.all(Array.from({ length: 20 }, () => call(mf, t)));
      const calls = await modelCalls(mf);
      expect(results.filter((r) => r.code === 'model_unavailable').length).toBe(calls);
      expect(results.filter((r) => r.code === 'daily_limit').length).toBe(20 - calls);
      expect(calls).toBe(3);
      const h = (await (await mf.dispatchFetch('http://worker.test/health', { headers: { 'x-test-now': String(DAY1) } })).json()) as { checks: { durableObject: { budgetToday: { charged: number; attempts: number; unsettled: number } } } };
      expect(h.checks.durableObject.budgetToday.attempts).toBe(3);
      expect(h.checks.durableObject.budgetToday.charged).toBeLessThanOrEqual(1000);
      expect(h.checks.durableObject.budgetToday.unsettled).toBe(0);
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it('a recorded overrun locks the day in the real Durable Object: its repair and every later request are refused, budget left', async () => {
    const mf = start(freshPersist(), 1000, { DAILY_NEURON_BUDGET: '10000' });
    const t = { 'x-test-now': String(DAY1) };
    try {
      expect((await call(mf, { ...t, 'x-mock': 'overrun_bad' })).code).toBe('daily_limit'); // first attempt overruns: its repair is refused
      expect(await modelCalls(mf)).toBe(1);
      for (let i = 0; i < 3; i++) expect((await call(mf, t)).code).toBe('daily_limit');
      expect(await modelCalls(mf)).toBe(1);
      const h = (await (await mf.dispatchFetch('http://worker.test/health', { headers: t })).json()) as { checks: { durableObject: { budgetToday: { charged: number; attempts: number; overruns: number } } } };
      expect(h.checks.durableObject.budgetToday).toMatchObject({ attempts: 1, overruns: 1 });
      expect(h.checks.durableObject.budgetToday.charged).toBeLessThan(10_000); // nominal headroom remains; the lock is what refuses
      expect((await call(mf, { 'x-test-now': String(DAY1 + 86_400_000) })).code).toBe('ok'); // next UTC day: open again
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it('measured settlements free headroom: many small successful calls fit where reservations alone would not', async () => {
    const mf = start(freshPersist(), 1000, { DAILY_NEURON_BUDGET: '1000' });
    const t = { 'x-test-now': String(DAY1) }; // mock reports 10 / 5 tokens
    try {
      for (let i = 0; i < 10; i++) expect((await call(mf, t)).code).toBe('ok'); // sequential: each settles before the next
      expect(await modelCalls(mf)).toBe(10);
    } finally {
      await mf.dispose();
    }
  }, 60_000);
});
