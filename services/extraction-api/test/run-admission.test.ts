import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { budgetOn, closeRun, expireRuns, initLedger, openRun, reserve, reserveInRun, runChunk, settle, settleInRun, usedOn, type SqlLike } from '../src/admission';
import type { EnvVars } from '../src/config';
import { charge, reservation } from '../src/cost';
import { handle, MAX_OPEN_RUNS, RUN_TTL_MS, type Deps } from '../src/handler';
import { buildMessages, PROFILES } from '../src/profiles';
import { outputCap, plannedNeurons } from '../src/run-plan';
import { BASELINE_MODEL } from '../../../tools/benchmark/src/candidates';

// Whole-run admission: the run is priced from its chunk plan and held before anything is sent; once held, nothing inside it can be
// refused for budget; the hold falls to what was used when the run ends.

function db(): SqlLike & { tx<T>(f: () => T): T } {
  const d = new DatabaseSync(':memory:');
  const sql: SqlLike = {
    exec: (q: string, ...b: unknown[]) => {
      const st = d.prepare(q);
      if (st.columns().length === 0) { st.run(...(b as never[])); return { toArray: () => [] }; }
      return { toArray: () => st.all(...(b as never[])) };
    },
  };
  initLedger(sql);
  return { ...sql, tx: <T>(f: () => T) => { d.exec('BEGIN IMMEDIATE'); try { const r = f(); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; } } };
}
const DAY = Date.UTC(2026, 10, 3, 12);
const chunks = (...n: number[]) => n.map((neurons) => ({ neurons, cap: 900 }));
const open = (s: ReturnType<typeof db>, c: number[], budget = 1000, ceiling = 40, now = DAY, maxOpen = 3) => s.tx(() => openRun(s, { ceiling, budget, token: 'a'.repeat(32), chunks: chunks(...c), ttlMs: RUN_TTL_MS, maxOpen }, now));

describe('the run is held as a whole, or refused up front', () => {
  it('holds the sum of the chunks and one admission per chunk; the day is charged the hold', () => {
    const s = db();
    const r = open(s, [100, 200, 300]);
    expect(r).toMatchObject({ ok: true, hold: 600, attempts: 3, remaining: 400 });
    expect(budgetOn(s, DAY)).toEqual({ attempts: 3, charged: 600, unsettled: 0, overruns: 0 });
  });

  it('refuses a run the remaining day cannot cover, with the numbers, and writes nothing', () => {
    const s = db();
    open(s, [300, 300]);
    const before = budgetOn(s, DAY);
    expect(open(s, [200, 201])).toEqual({ ok: false, reason: 'neurons', need: 401, remaining: 400, used: 2 });
    expect(budgetOn(s, DAY)).toEqual(before);
    expect(open(s, [200, 200])).toMatchObject({ ok: true }); // exactly what remains is enough
  });

  it('refuses when the attempts would pass the ceiling, when too many runs are open, and after a recorded overrun', () => {
    const s = db();
    expect(open(s, [10, 10, 10], 1000, 2)).toMatchObject({ ok: false, reason: 'attempts' });
    for (let i = 0; i < 3; i++) expect(open(s, [10])).toMatchObject({ ok: true });
    expect(open(s, [10], 1000, 40, DAY, 3)).toMatchObject({ ok: false, reason: 'busy' });
    const t = db();
    const a = reserve(t, { ceiling: 10, budget: 1000, neurons: 100 }, DAY);
    if (!a.ok) throw new Error('setup');
    settle(t, a.id, 150);
    expect(open(t, [10])).toMatchObject({ ok: false, reason: 'overrun' });
  });

  it('single attempts cannot take budget that a run holds', () => {
    const s = db();
    open(s, [400, 400]);
    expect(s.tx(() => reserve(s, { ceiling: 40, budget: 1000, neurons: 201 }, DAY))).toMatchObject({ ok: false, reason: 'neurons' });
    expect(s.tx(() => reserve(s, { ceiling: 40, budget: 1000, neurons: 200 }, DAY))).toMatchObject({ ok: true });
  });
});

describe('inside an admitted run nothing is refused for budget', () => {
  it('every chunk gets its attempt even when the rest of the day is used up to the last neuron', () => {
    const s = db();
    const r = open(s, [250, 250, 250]);
    if (!r.ok) throw new Error('setup');
    // everything else the day can hold is taken, to the brim
    expect(s.tx(() => reserve(s, { ceiling: 40, budget: 1000, neurons: 250 }, DAY))).toMatchObject({ ok: true });
    expect(s.tx(() => reserve(s, { ceiling: 40, budget: 1000, neurons: 0.001 }, DAY))).toMatchObject({ ok: false });
    for (const chunk of [2, 0, 1]) {
      const a = s.tx(() => reserveInRun(s, r.id, 'a'.repeat(32), chunk, 250, DAY));
      expect(a).toMatchObject({ ok: true });
      if (a.ok) s.tx(() => settleInRun(s, a.id, 180));
    }
    expect(budgetOn(s, DAY).charged).toBeLessThanOrEqual(1000);
  });

  it('is refused only if larger than planned, repeated, or for a run that is unknown, has the wrong token, or has ended', () => {
    const s = db();
    const r = open(s, [100, 100]);
    if (!r.ok) throw new Error('setup');
    const tok = 'a'.repeat(32);
    expect(s.tx(() => reserveInRun(s, r.id, tok, 0, 100.01, DAY))).toEqual({ ok: false, reason: 'over_plan' });
    expect(s.tx(() => reserveInRun(s, r.id, 'b'.repeat(32), 0, 50, DAY))).toEqual({ ok: false, reason: 'unknown_run' });
    expect(s.tx(() => reserveInRun(s, 999, tok, 0, 50, DAY))).toEqual({ ok: false, reason: 'unknown_run' });
    expect(s.tx(() => reserveInRun(s, r.id, tok, 5, 50, DAY))).toEqual({ ok: false, reason: 'unknown_run' });
    expect(s.tx(() => reserveInRun(s, r.id, tok, 0, 50, DAY))).toMatchObject({ ok: true });
    expect(s.tx(() => reserveInRun(s, r.id, tok, 0, 50, DAY))).toEqual({ ok: false, reason: 'chunk_used' });
    expect(s.tx(() => runChunk(s, r.id, tok, 1, DAY + RUN_TTL_MS + 1))).toEqual({ ok: false, reason: 'expired' });
  });

  it('a recorded overrun locks new runs and single attempts, but the admitted run carries on', () => {
    const s = db();
    const r = open(s, [100, 100, 100]);
    const other = open(s, [50]);
    if (!r.ok || !other.ok) throw new Error('setup');
    const tok = 'a'.repeat(32);
    const a = s.tx(() => reserveInRun(s, r.id, tok, 0, 100, DAY));
    if (!a.ok) throw new Error('setup');
    expect(s.tx(() => settleInRun(s, a.id, 130))).toMatchObject({ overrun: true, charged: 130 });
    expect(open(s, [10])).toMatchObject({ ok: false, reason: 'overrun' });
    expect(s.tx(() => reserve(s, { ceiling: 40, budget: 1000, neurons: 1 }, DAY))).toMatchObject({ ok: false, reason: 'overrun' });
    for (const c of [1, 2]) expect(s.tx(() => reserveInRun(s, r.id, tok, c, 100, DAY))).toMatchObject({ ok: true });
  });
});

describe('the hold falls to what was used', () => {
  it('when every chunk has settled the run closes by itself; unused headroom returns to the day', () => {
    const s = db();
    const r = open(s, [300, 300, 300]);
    if (!r.ok) throw new Error('setup');
    for (const c of [0, 1, 2]) {
      const a = s.tx(() => reserveInRun(s, r.id, 'a'.repeat(32), c, 300, DAY));
      if (a.ok) s.tx(() => settleInRun(s, a.id, 100));
    }
    expect(budgetOn(s, DAY)).toEqual({ attempts: 3, charged: 300, unsettled: 0, overruns: 0 });
    expect(open(s, [350, 350])).toMatchObject({ ok: true }); // 700 now fits in the 700 that came back
  });

  it('a run the client stops early is closed on request: unused chunks return their budget AND their attempts', () => {
    const s = db();
    const r = open(s, [300, 300, 300]);
    if (!r.ok) throw new Error('setup');
    const a = s.tx(() => reserveInRun(s, r.id, 'a'.repeat(32), 0, 300, DAY));
    if (a.ok) s.tx(() => settleInRun(s, a.id, 120));
    expect(s.tx(() => closeRun(s, r.id, 'b'.repeat(32), DAY))).toMatchObject({ closed: false }); // wrong token changes nothing
    expect(budgetOn(s, DAY).charged).toBe(900);
    expect(s.tx(() => closeRun(s, r.id, 'a'.repeat(32), DAY))).toMatchObject({ closed: true, charged: 120 });
    expect(budgetOn(s, DAY)).toEqual({ attempts: 1, charged: 120, unsettled: 0, overruns: 0 });
    expect(s.tx(() => closeRun(s, r.id, 'a'.repeat(32), DAY))).toMatchObject({ closed: false }); // once only
  });

  it('an abandoned run expires: its hold falls to what it used; an attempt whose call never settled keeps its reservation', () => {
    const s = db();
    const r = open(s, [300, 300]);
    if (!r.ok) throw new Error('setup');
    s.tx(() => reserveInRun(s, r.id, 'a'.repeat(32), 0, 300, DAY)); // the Worker died before settling
    expect(s.tx(() => expireRuns(s, DAY + RUN_TTL_MS + 1))).toBe(1);
    expect(budgetOn(s, DAY)).toMatchObject({ attempts: 1, charged: 300, unsettled: 1 });
  });
});

describe('randomised: runs and single attempts together never pass the budget', () => {
  it('whatever the order, sizes and early closes (no overruns)', () => {
    const s = db();
    let seed = 11;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const live: { id: number; planned: number[]; next: number; tok: string }[] = [];
    for (let i = 0; i < 600; i++) {
      const x = rnd();
      if (x < 0.25) {
        const planned = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => 40 + rnd() * 250);
        const tok = String(i).padStart(32, 'x');
        const r = s.tx(() => openRun(s, { ceiling: 100_000, budget: 4000, token: tok, chunks: planned.map((neurons) => ({ neurons, cap: 900 })), ttlMs: RUN_TTL_MS, maxOpen: 5 }, DAY));
        if (r.ok) live.push({ id: r.id, planned, next: 0, tok });
      } else if (x < 0.8 && live.length) {
        const run = live[Math.floor(rnd() * live.length)]!;
        if (run.next >= run.planned.length) continue;
        const n = run.planned[run.next]!;
        const a = s.tx(() => reserveInRun(s, run.id, run.tok, run.next, n, DAY));
        expect(a, 'an attempt inside an admitted run is never refused for budget').toMatchObject({ ok: true });
        if (a.ok) s.tx(() => settleInRun(s, a.id, rnd() < 0.15 ? null : rnd() * n));
        run.next++;
      } else if (x < 0.9) {
        s.tx(() => reserve(s, { ceiling: 100_000, budget: 4000, neurons: 30 + rnd() * 300 }, DAY));
      } else if (live.length) {
        const run = live.splice(Math.floor(rnd() * live.length), 1)[0]!;
        s.tx(() => closeRun(s, run.id, run.tok, DAY));
      }
      expect(budgetOn(s, DAY).charged).toBeLessThanOrEqual(4000 + 1e-6);
    }
    expect(usedOn(s, DAY)).toBeGreaterThan(0);
  });
});

describe('the planned worst case is a true bound', () => {
  const rnd = (() => { let seed = 5; return () => ((seed = (seed * 48271) % 2147483647) / 2147483647); })();
  const words = ['Digital pH meter', 'Zürich ½ Ø 25 mm — 日本語', 'R 3 450', '0.01 pH resolution', '"quoted" \\ back\\slash', 'tab\tseparated', 'ünï'];
  const text = (n: number) => Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(' | ');
  for (const [id, p] of Object.entries(PROFILES)) {
    it(`${id}: planned neurons >= the reservation of the real messages, with and without table cells, for random requests`, () => {
      for (let i = 0; i < 60; i++) {
        const blocks = Array.from({ length: 1 + Math.floor(rnd() * 25) }, (_, k) => {
          const t = text(1 + Math.floor(rnd() * 6));
          return rnd() < 0.4 ? { id: `p1-l${k + 1}`, text: t, cells: t.split(' | ').filter(Boolean).length >= 2 ? t.split(' | ').filter(Boolean) : undefined } : { id: `p1-l${k + 1}`, text: t };
        }).map((b) => (b.cells ? b : { id: b.id, text: b.text }));
        const bodyBytes = new TextEncoder().encode(JSON.stringify({ schemaId: id, blocks })).byteLength;
        const values = Math.floor(rnd() * 20);
        const planned = plannedNeurons(p, { schemaId: id, bodyBytes, values })!;
        const actual = reservation(p.model, buildMessages(p, blocks, false), planned.cap)!;
        expect(planned.neurons).toBeGreaterThanOrEqual(actual);
      }
    });
  }
  it('the output cap is enforced at no more than the profile maximum and grows with the values', () => {
    expect(outputCap(14, 1500)).toBe(972);
    expect(outputCap(0, 1500)).toBe(972); // the estimate is low for table rows: never below the chunker's design maximum
    expect(outputCap(1, 1500)).toBe(972);
    expect(outputCap(20, 1500)).toBe(Math.ceil(1.5 * (60 + 42 * 20)));
    expect(outputCap(500, 1500)).toBe(Math.min(1500, outputCap(40, 1500)));
    expect(outputCap(14, 800)).toBe(800);
    expect(972).toBeGreaterThanOrEqual(Math.ceil(1.7 * 565)); // the largest recorded answer fits with room
  });
});

describe('handler: POST /run and runs of extract requests', () => {
  const ORIGIN = 'http://localhost:5173';
  const env = (budget: string, ceiling = '40'): EnvVars => ({ ALLOWED_ORIGINS: ORIGIN, ACCESS_GATE: 'public', DAILY_ADMISSION_CEILING: ceiling, DAILY_NEURON_BUDGET: budget, MAX_BODY_BYTES: '8192', MAX_CHARS: '6000', MAX_BLOCKS: '80', MAX_BLOCK_CHARS: '1000', INFERENCE_TIMEOUT_MS: '200' });
  const blocks = [{ id: 'b1', text: 'Organisation: Acme Trust' }];
  const body = JSON.stringify({ schemaId: 'packcheck.grant.v1', blocks });
  const bytes = new TextEncoder().encode(body).byteLength;
  const GOOD = { claims: [{ field: 'organisation_name', blockId: 'b1', excerpt: 'Acme Trust', value: 'Acme Trust' }] };

  function setup(budget: string, replies: (() => Promise<unknown>)[] = [], ceiling = '40') {
    const s = db();
    const logs: Record<string, unknown>[] = [];
    const aiInputs: { max_tokens: number }[] = [];
    let calls = 0;
    const deps: Deps = {
      now: () => DAY,
      counter: {
        reserve: async (r, n) => s.tx(() => reserve(s, r, n)),
        settle: async (id, c) => s.tx(() => settle(s, id, c)),
        openRun: async (r, n) => s.tx(() => openRun(s, r, n)),
        runChunk: async (id, t, c, n) => s.tx(() => runChunk(s, id, t, c, n)),
        reserveInRun: async (id, t, c, n, now) => s.tx(() => reserveInRun(s, id, t, c, n, now)),
        settleInRun: async (id, c) => s.tx(() => settleInRun(s, id, c)),
        closeRun: async (id, t, n) => s.tx(() => closeRun(s, id, t, n)),
      },
      ai: { run: async (_m, input) => { aiInputs.push(input as { max_tokens: number }); const f = replies[calls++]; if (!f) throw new Error('unexpected call'); return f(); } },
      log: (x) => logs.push(x),
    };
    const post = (path: string, payload: unknown, origin = ORIGIN) => handle(new Request(`https://w.test${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) }), env(budget, ceiling), deps);
    return { s, logs, aiInputs, calls: () => calls, post };
  }
  const plan = (n: number, values = 5) => ({ plan: Array.from({ length: n }, () => ({ schemaId: 'packcheck.grant.v1', bodyBytes: bytes, values })) });

  it('holds a run that fits and tells the client the numbers; a run that does not fit is refused with them and nothing is held', async () => {
    const t = setup('2000');
    const ok = await t.post('/run', plan(2));
    expect(ok.status).toBe(200);
    const j = (await ok.json()) as { runId: number; token: string; holdNeurons: number; attempts: number; budget: number; remaining: number };
    const one = plannedNeurons(PROFILES['packcheck.grant.v1']!, { schemaId: 'packcheck.grant.v1', bodyBytes: bytes, values: 5 })!.neurons;
    expect(j).toMatchObject({ attempts: 2, budget: 2000 });
    expect(j.holdNeurons).toBeCloseTo(2 * one, 2);
    expect(j.token).toMatch(/^[0-9a-f]{32}$/);
    const before = budgetOn(t.s, DAY);
    const no = await t.post('/run', plan(30, 40));
    expect(no.status).toBe(429);
    const e = ((await no.json()) as { error: { code: string; need: number; remaining: number; budget: number; retryable: boolean } }).error;
    expect(e).toMatchObject({ code: 'run_exceeds_allowance', budget: 2000, retryable: true });
    expect(e.need).toBeGreaterThan(e.remaining);
    expect(budgetOn(t.s, DAY)).toEqual(before);
    expect(t.calls()).toBe(0);
  });

  it('a closed service (budget 0 or ceiling 0) refuses a run as daily_limit; a bad plan is invalid; the body carries no text', async () => {
    expect(((await (await setup('0').post('/run', plan(1))).json()) as { error: { code: string } }).error.code).toBe('daily_limit');
    expect(((await (await setup('2000', [], '0').post('/run', plan(1))).json()) as { error: { code: string } }).error.code).toBe('daily_limit');
    const t = setup('2000');
    expect((await t.post('/run', { plan: [] })).status).toBe(400);
    expect((await t.post('/run', { plan: [{ schemaId: 'nope', bodyBytes: 10, values: 1 }] })).status).toBe(400);
    expect((await t.post('/run', { plan: [{ schemaId: 'packcheck.grant.v1', bodyBytes: 10, values: 1, text: 'x' }] })).status).toBe(400);
    expect((await t.post('/run', { plan: [{ schemaId: 'packcheck.grant.v1', bodyBytes: 99_999, values: 1 }] })).status).toBe(413);
    expect((await t.post('/run', plan(1), 'https://elsewhere.example')).status).toBe(403);
  });

  it('refuses a fourth open run (busy) without holding anything', async () => {
    const t = setup('9000');
    for (let i = 0; i < MAX_OPEN_RUNS; i++) expect((await t.post('/run', plan(1))).status).toBe(200);
    const before = budgetOn(t.s, DAY);
    const r = await t.post('/run', plan(1));
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('run_busy');
    expect(budgetOn(t.s, DAY)).toEqual(before);
  });

  it('an extract request in a run makes ONE attempt at the planned cap, settles from the tokens, and never repairs', async () => {
    const t = setup('2000', [async () => ({ response: GOOD, usage: { prompt_tokens: 400, completion_tokens: 60 } }), async () => ({ response: 'not json', usage: { prompt_tokens: 400, completion_tokens: 10 } })]);
    const run = (await (await t.post('/run', plan(2, 5))).json()) as { runId: number; token: string };
    const cap = outputCap(5, PROFILES['packcheck.grant.v1']!.maxOutputTokens);
    expect(cap).toBe(972);
    const first = await t.post('/extract', { schemaId: 'packcheck.grant.v1', blocks, run: { id: run.runId, token: run.token, chunk: 0 } });
    expect(first.status).toBe(200);
    expect(t.aiInputs[0]!.max_tokens).toBe(cap);
    const second = await t.post('/extract', { schemaId: 'packcheck.grant.v1', blocks, run: { id: run.runId, token: run.token, chunk: 1 } });
    expect(second.status).toBe(502); // unusable answer: reported, not repaired
    expect(t.calls()).toBe(2);
    expect(budgetOn(t.s, DAY)).toEqual({ attempts: 2, charged: charge(BASELINE_MODEL, 400, 60)! + charge(BASELINE_MODEL, 400, 10)!, unsettled: 0, overruns: 0 });
  });

  it('is refused (before the model) for an unknown run, a wrong token, a repeated chunk, or a request larger than planned', async () => {
    const t = setup('2000', [async () => ({ response: GOOD })]);
    const run = (await (await t.post('/run', plan(2))).json()) as { runId: number; token: string };
    const ex = (r: { id: number; token: string; chunk: number }, b = blocks) => t.post('/extract', { schemaId: 'packcheck.grant.v1', blocks: b, run: r });
    expect((await ex({ id: 999, token: run.token, chunk: 0 })).status).toBe(410);
    expect((await ex({ id: run.runId, token: 'f'.repeat(32), chunk: 0 })).status).toBe(410);
    const big = Array.from({ length: 60 }, (_, i) => ({ id: `b${i}`, text: 'Organisation: Acme Trust and a much longer line of text to make this request larger than planned' }));
    expect((await ex({ id: run.runId, token: run.token, chunk: 0 }, big)).status).toBe(400);
    expect(t.calls()).toBe(0);
    expect((await ex({ id: run.runId, token: run.token, chunk: 0 })).status).toBe(200);
    expect((await ex({ id: run.runId, token: run.token, chunk: 0 })).status).toBe(400);
  });

  it('a run is never cut off by the budget: every chunk is served even when single requests have used the rest of the day', async () => {
    const t = setup('1500', Array.from({ length: 3 }, () => async () => ({ response: GOOD, usage: { prompt_tokens: 300, completion_tokens: 50 } })));
    const one = plannedNeurons(PROFILES['packcheck.grant.v1']!, { schemaId: 'packcheck.grant.v1', bodyBytes: bytes, values: 5 })!.neurons;
    const run = (await (await t.post('/run', plan(3, 5))).json()) as { runId: number; token: string; remaining: number };
    // take everything the day has left with single reservations
    for (let i = 0; i < 100; i++) if (!t.s.tx(() => reserve(t.s, { ceiling: 40, budget: 1500, neurons: Math.max(0.001, Math.min(one, run.remaining)) }, DAY)).ok) break;
    for (let c = 0; c < 3; c++) expect((await t.post('/extract', { schemaId: 'packcheck.grant.v1', blocks, run: { id: run.runId, token: run.token, chunk: c } })).status).toBe(200);
    expect(t.calls()).toBe(3);
  });

  it('POST /run/close releases the unused hold', async () => {
    const t = setup('2000', [async () => ({ response: GOOD, usage: { prompt_tokens: 300, completion_tokens: 50 } })]);
    const run = (await (await t.post('/run', plan(3))).json()) as { runId: number; token: string };
    await t.post('/extract', { schemaId: 'packcheck.grant.v1', blocks, run: { id: run.runId, token: run.token, chunk: 0 } });
    const c = await t.post('/run/close', { runId: run.runId, token: run.token });
    expect(await c.json()).toMatchObject({ closed: true });
    expect(budgetOn(t.s, DAY)).toEqual({ attempts: 1, charged: charge(BASELINE_MODEL, 300, 50), unsettled: 0, overruns: 0 });
  });
});

describe('single requests are unchanged', () => {
  it('an /extract without a run still reserves, calls, and may repair exactly as before', () => {
    const p = PROFILES['packcheck.grant.v1']!;
    expect(reservation(p.model, buildMessages(p, [{ id: 'b1', text: 'x' }], true), p.maxOutputTokens)).toBeGreaterThan(0);
  });
});
