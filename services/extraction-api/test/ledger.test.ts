import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { budgetOn, initLedger, reserve, settle, type SqlLike } from '../src/admission';
import type { EnvVars } from '../src/config';
import { charge, NEURONS_PER_MILLION, PROMPT_OVERHEAD_TOKENS, reservation, settlementCharge } from '../src/cost';
import { handle, type Deps } from '../src/handler';
import { buildMessages, PROFILES } from '../src/profiles';
import { MODELS, BASELINE_MODEL } from '../../../tools/benchmark/src/candidates';
import { worstCaseNeurons, BYTES_PER_TOKEN_STRICT } from '../../../tools/benchmark/src/budget';

// Server-side neuron reservations and settlement (task 5.5): the ledger functions over real SQLite, the cost model, and the
// handler's reserve -> call -> settle sequence.

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

describe('ledger', () => {
  it('admits while attempts < ceiling AND charged + reservation <= budget; refusals write nothing', () => {
    const s = db();
    expect(reserve(s, { ceiling: 10, budget: 1000, neurons: 400 }, DAY)).toMatchObject({ ok: true, used: 1, charged: 400 });
    expect(reserve(s, { ceiling: 10, budget: 1000, neurons: 400 }, DAY)).toMatchObject({ ok: true, used: 2, charged: 800 });
    expect(reserve(s, { ceiling: 10, budget: 1000, neurons: 400 }, DAY)).toEqual({ ok: false, reason: 'neurons', used: 2, charged: 800 });
    expect(reserve(s, { ceiling: 10, budget: 1000, neurons: 200 }, DAY)).toMatchObject({ ok: true, used: 3, charged: 1000 }); // exactly at the budget
    expect(budgetOn(s, DAY)).toEqual({ attempts: 3, charged: 1000, unsettled: 3, overruns: 0 });
    const t = db();
    reserve(t, { ceiling: 1, budget: 1000, neurons: 1 }, DAY);
    expect(reserve(t, { ceiling: 1, budget: 1000, neurons: 1 }, DAY)).toMatchObject({ ok: false, reason: 'attempts' });
    expect(budgetOn(t, DAY).attempts).toBe(1);
  });

  it('settlement with measured usage frees headroom; unknown usage keeps the reservation', () => {
    const s = db();
    const a = reserve(s, { ceiling: 10, budget: 1000, neurons: 500 }, DAY);
    const b = reserve(s, { ceiling: 10, budget: 1000, neurons: 500 }, DAY);
    if (!a.ok || !b.ok) throw new Error('setup');
    expect(settle(s, a.id, 120)).toEqual({ settled: true, charged: 120, reserved: 500, overrun: false });
    expect(settle(s, b.id, null)).toEqual({ settled: true, charged: 500, reserved: 500, overrun: false });
    expect(budgetOn(s, DAY)).toEqual({ attempts: 2, charged: 620, unsettled: 0, overruns: 0 });
    expect(reserve(s, { ceiling: 10, budget: 1000, neurons: 380 }, DAY)).toMatchObject({ ok: true, charged: 1000 });
  });

  it('an overrun is recorded in full, not clipped, and refuses later reservations sooner', () => {
    const s = db();
    const a = reserve(s, { ceiling: 10, budget: 1000, neurons: 300 }, DAY);
    if (!a.ok) throw new Error('setup');
    expect(settle(s, a.id, 950)).toEqual({ settled: true, charged: 950, reserved: 300, overrun: true });
    expect(budgetOn(s, DAY)).toMatchObject({ charged: 950, overruns: 1 });
    expect(reserve(s, { ceiling: 10, budget: 1000, neurons: 60 }, DAY)).toMatchObject({ ok: false, reason: 'overrun', charged: 950 });
  });

  it('a recorded overrun locks the UTC day even when nominal budget remains; refusals write nothing; the next day is open', () => {
    const s = db();
    const a = reserve(s, { ceiling: 10, budget: 5000, neurons: 300 }, DAY);
    if (!a.ok) throw new Error('setup');
    expect(settle(s, a.id, 301)).toMatchObject({ overrun: true, charged: 301 }); // just over: 4,699 nominal headroom left
    const before = budgetOn(s, DAY);
    for (const n of [0.001, 1, 300]) expect(reserve(s, { ceiling: 10, budget: 5000, neurons: n }, DAY)).toEqual({ ok: false, reason: 'overrun', used: 1, charged: 301 });
    expect(budgetOn(s, DAY)).toEqual(before);
    expect(before).toEqual({ attempts: 1, charged: 301, unsettled: 0, overruns: 1 });
    // A charge exactly at the reservation is not an overrun and does not lock.
    const t = db();
    const b = reserve(t, { ceiling: 10, budget: 5000, neurons: 300 }, DAY);
    if (!b.ok) throw new Error('setup');
    expect(settle(t, b.id, 300)).toMatchObject({ overrun: false });
    expect(reserve(t, { ceiling: 10, budget: 5000, neurons: 300 }, DAY)).toMatchObject({ ok: true });
    // The lock is per UTC day: the next day starts open.
    expect(reserve(s, { ceiling: 10, budget: 5000, neurons: 300 }, DAY + 86_400_000)).toMatchObject({ ok: true, used: 1, charged: 300 });
  });

  it('a call outstanding when another overruns cannot add a further admission after it settles', () => {
    const s = db();
    const a = reserve(s, { ceiling: 10, budget: 5000, neurons: 300 }, DAY);
    const b = reserve(s, { ceiling: 10, budget: 5000, neurons: 300 }, DAY);
    if (!a.ok || !b.ok) throw new Error('setup');
    settle(s, a.id, 400); // overrun
    expect(settle(s, b.id, 100)).toMatchObject({ settled: true, overrun: false }); // still settled in full, not lost
    expect(reserve(s, { ceiling: 10, budget: 5000, neurons: 1 }, DAY)).toMatchObject({ ok: false, reason: 'overrun' });
    expect(budgetOn(s, DAY)).toEqual({ attempts: 2, charged: 500, unsettled: 0, overruns: 1 });
  });

  it('an overrun can take the day past the budget; it is recorded, and nothing more is admitted', () => {
    const s = db();
    const a = reserve(s, { ceiling: 10, budget: 1000, neurons: 900 }, DAY);
    if (!a.ok) throw new Error('setup');
    settle(s, a.id, 1300);
    expect(budgetOn(s, DAY).charged).toBe(1300);
    expect(reserve(s, { ceiling: 10, budget: 1000, neurons: 0.001 }, DAY)).toMatchObject({ ok: false, reason: 'overrun' });
  });

  it('a reservation never settled (the Worker died mid-call) stands for the day', () => {
    const s = db();
    reserve(s, { ceiling: 10, budget: 1000, neurons: 700 }, DAY);
    expect(budgetOn(s, DAY)).toEqual({ attempts: 1, charged: 700, unsettled: 1, overruns: 0 });
    expect(reserve(s, { ceiling: 10, budget: 1000, neurons: 301 }, DAY)).toMatchObject({ ok: false, reason: 'neurons' });
  });

  it('settle is once only; an unknown id changes nothing', () => {
    const s = db();
    const a = reserve(s, { ceiling: 10, budget: 1000, neurons: 300 }, DAY);
    if (!a.ok) throw new Error('setup');
    settle(s, a.id, 100);
    expect(settle(s, a.id, 5)).toMatchObject({ settled: false, charged: 100 });
    expect(settle(s, a.id, null)).toMatchObject({ settled: false, charged: 100 });
    expect(settle(s, 999, 1)).toEqual({ settled: false, charged: 0, reserved: 0, overrun: false });
    expect(budgetOn(s, DAY).charged).toBe(100);
  });

  it('malformed settlement values keep the reservation', () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const s = db();
      const a = reserve(s, { ceiling: 10, budget: 1000, neurons: 300 }, DAY);
      if (!a.ok) throw new Error('setup');
      expect(settle(s, a.id, bad).charged).toBe(300);
    }
  });

  it('a new UTC day starts empty; rows older than 7 days are deleted', () => {
    const s = db();
    reserve(s, { ceiling: 1, budget: 100, neurons: 100 }, DAY);
    const next = DAY + 86_400_000;
    expect(reserve(s, { ceiling: 1, budget: 100, neurons: 100 }, next)).toMatchObject({ ok: true, used: 1, charged: 100 });
    reserve(s, { ceiling: 1, budget: 100, neurons: 1 }, DAY + 9 * 86_400_000);
    expect(budgetOn(s, DAY).attempts).toBe(0);
  });

  it('rejects invalid arguments', () => {
    const s = db();
    expect(() => reserve(s, { ceiling: 1, budget: 100, neurons: 0 }, DAY)).toThrow();
    expect(() => reserve(s, { ceiling: -1, budget: 100, neurons: 1 }, DAY)).toThrow();
    expect(() => reserve(s, { ceiling: 1, budget: Number.NaN, neurons: 1 }, DAY)).toThrow();
  });

  it('serialised reservations never pass the budget, whatever the order and sizes', () => {
    const s = db();
    let seed = 7;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    // settlements at or below the reservation (no overrun): the day can never pass the budget
    const live: { id: number; n: number }[] = [];
    for (let i = 0; i < 500; i++) {
      const n = 50 + rnd() * 600;
      const r = s.tx(() => reserve(s, { ceiling: 10_000, budget: 5000, neurons: n }, DAY));
      if (r.ok) live.push({ id: r.id, n });
      if (live.length && rnd() < 0.5) { const x = live.shift()!; s.tx(() => settle(s, x.id, rnd() < 0.2 ? null : rnd() * x.n)); }
      const b = budgetOn(s, DAY);
      expect(b.charged).toBeLessThanOrEqual(5000 + 1e-6);
    }
  });
});

describe('cost model', () => {
  it('rates and margin agree with the benchmark configuration', () => {
    expect(NEURONS_PER_MILLION[BASELINE_MODEL]).toEqual(MODELS[BASELINE_MODEL]!.neuronsPerMillion);
    for (const p of Object.values(PROFILES)) expect(NEURONS_PER_MILLION[p.model]).toBeDefined(); // every profile's model has a rate
  });

  it('reservation equals the benchmark guaranteed bound for the same messages (rounded up)', () => {
    const p = PROFILES['scopecheck.rfq.v1']!;
    const m = buildMessages(p, [{ id: 'b1', text: 'Item PN-130 Pipe DN50 PN16 | 120 m' }], true);
    const w = worstCaseNeurons({ messages: m, max_tokens: p.maxOutputTokens }, p.model, BYTES_PER_TOKEN_STRICT).neurons;
    const r = reservation(p.model, m, p.maxOutputTokens)!;
    expect(r).toBeGreaterThanOrEqual(w);
    expect(r - w).toBeLessThan(0.001);
    expect(PROMPT_OVERHEAD_TOKENS).toBe(64);
  });

  it('counts UTF-8 bytes, not characters', () => {
    const p = PROFILES['packcheck.grant.v1']!;
    const a = reservation(p.model, [{ content: 'e'.repeat(1000) }], 1)!;
    const b = reservation(p.model, [{ content: 'é'.repeat(1000) }], 1)!;
    expect(b).toBeGreaterThan(a);
  });

  it('an unknown model has no rate (fail closed)', () => {
    expect(charge('@cf/other/model', 1, 1)).toBeNull();
    expect(charge('constructor', 1, 1)).toBeNull();
  });

  it('settlement needs both token counts', () => {
    const m = BASELINE_MODEL;
    expect(settlementCharge(m, { prompt_tokens: 600, completion_tokens: 400 })).toBe(charge(m, 600, 400));
    expect(settlementCharge(m, { prompt_tokens: 600 })).toBeNull();
    expect(settlementCharge(m, { prompt_tokens: -1, completion_tokens: 2 })).toBeNull();
    expect(settlementCharge(m, null)).toBeNull();
  });
});

describe('handler: reserve before every attempt, settle after', () => {
  const ORIGIN = 'http://localhost:5173';
  const env: EnvVars = { ALLOWED_ORIGINS: ORIGIN, ACCESS_GATE: 'public', DAILY_ADMISSION_CEILING: '10', DAILY_NEURON_BUDGET: '5000', INFERENCE_TIMEOUT_MS: '100' };
  const GOOD = { claims: [{ field: 'organisation_name', blockId: 'b1', excerpt: 'Acme Trust', value: 'Acme Trust' }] };
  const req = () => new Request('https://w.test/extract', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ schemaId: 'packcheck.grant.v1', blocks: [{ id: 'b1', text: 'Organisation: Acme Trust' }] }) });

  function setup(replies: (() => Promise<unknown>)[], e: EnvVars = env) {
    const s = db();
    const logs: Record<string, unknown>[] = [];
    let calls = 0;
    const deps: Deps = {
      now: () => DAY,
      counter: { reserve: async (r, n) => s.tx(() => reserve(s, r, n)), settle: async (id, c) => s.tx(() => settle(s, id, c)) },
      ai: { run: async () => { const f = replies[calls++]; if (!f) throw new Error('unexpected call'); return f(); } },
      log: (x) => logs.push(x),
    };
    return { deps, s, logs, calls: () => calls, run: () => handle(req(), e, deps) };
  }
  const expectedReservation = (repair: boolean) => {
    const p = PROFILES['packcheck.grant.v1']!;
    return reservation(p.model, buildMessages(p, [{ id: 'b1', text: 'Organisation: Acme Trust' }], repair), p.maxOutputTokens)!;
  };

  it('a successful call: reserved at the worst case, settled from reported tokens', async () => {
    const t = setup([async () => ({ response: GOOD, usage: { prompt_tokens: 600, completion_tokens: 50 } })]);
    expect((await t.run()).status).toBe(200);
    expect(budgetOn(t.s, DAY)).toEqual({ attempts: 1, charged: charge(BASELINE_MODEL, 600, 50), unsettled: 0, overruns: 0 });
    expect(t.logs.find((l) => l.evt === 'settle')).toMatchObject({ reserved: expectedReservation(false), measured: true, overrun: false });
  });

  it('usage missing: the reservation stands', async () => {
    const t = setup([async () => ({ response: GOOD })]);
    expect((await t.run()).status).toBe(200);
    expect(budgetOn(t.s, DAY).charged).toBe(expectedReservation(false));
  });

  it('model error and timeout: the reservation stands and is not refunded', async () => {
    const e = setup([async () => { throw new Error('capacity temporarily exceeded'); }]);
    expect((await e.run()).status).toBe(503);
    expect(budgetOn(e.s, DAY)).toMatchObject({ attempts: 1, charged: expectedReservation(false), unsettled: 0 });
    const t = setup([() => new Promise((r) => setTimeout(() => r({ response: GOOD, usage: { prompt_tokens: 1, completion_tokens: 1 } }), 400))]);
    expect((await t.run()).status).toBe(504);
    expect(budgetOn(t.s, DAY).charged).toBe(expectedReservation(false));
  });

  it('a repair is reserved and settled separately; an unusable first answer with usage is charged from its tokens', async () => {
    const t = setup([async () => ({ response: 'not json', usage: { prompt_tokens: 500, completion_tokens: 20 } }), async () => ({ response: GOOD, usage: { prompt_tokens: 520, completion_tokens: 40 } })]);
    expect((await t.run()).status).toBe(200);
    expect(budgetOn(t.s, DAY)).toMatchObject({ attempts: 2, unsettled: 0 });
    expect(budgetOn(t.s, DAY).charged).toBeCloseTo(charge(BASELINE_MODEL, 500, 20)! + charge(BASELINE_MODEL, 520, 40)!, 6);
    expect(t.logs.filter((l) => l.evt === 'settle').map((l) => l.reserved)).toEqual([expectedReservation(false), expectedReservation(true)]);
  });

  it('an overrun is charged in full and logged', async () => {
    const t = setup([async () => ({ response: GOOD, usage: { prompt_tokens: 50_000, completion_tokens: 5000 } })]);
    expect((await t.run()).status).toBe(200);
    const b = budgetOn(t.s, DAY);
    expect(b.overruns).toBe(1);
    expect(b.charged).toBe(charge(BASELINE_MODEL, 50_000, 5000));
    expect(t.logs.find((l) => l.evt === 'settle')).toMatchObject({ overrun: true });
  });

  it('budget exhausted: daily_limit before the model is called; the log says why', async () => {
    const t = setup([], { ...env, DAILY_NEURON_BUDGET: '100' });
    const r = await t.run();
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('daily_limit');
    expect(t.calls()).toBe(0);
    expect(t.logs.find((l) => l.evt === 'admission')).toMatchObject({ refused: 'neurons' });
    expect(budgetOn(t.s, DAY)).toEqual({ attempts: 0, charged: 0, unsettled: 0, overruns: 0 });
  });

  it('a repair that would pass the budget is refused before the second call', async () => {
    const first = expectedReservation(false);
    const t = setup([async () => ({ response: 'not json' })], { ...env, DAILY_NEURON_BUDGET: String(Math.ceil(first) + 1) });
    const r = await t.run();
    expect(r.status).toBe(429);
    expect(t.calls()).toBe(1);
  });

  it('DAILY_NEURON_BUDGET is required and bounded: missing or above the free allocation closes the service', async () => {
    for (const v of [undefined, '', 'lots', '10001']) {
      const e = { ...env, DAILY_NEURON_BUDGET: v };
      const t = setup([], e);
      const r = await t.run();
      expect(r.status).toBe(503);
      expect(t.calls()).toBe(0);
    }
  });

  // A counter whose settle fails (throws) or reports an unknown reservation, while reserve works.
  function brokenSettle(replies: (() => Promise<unknown>)[], mode: 'throw' | 'unknown', e: EnvVars = env) {
    const s = db();
    const logs: Record<string, unknown>[] = [];
    let calls = 0, settles = 0;
    const deps: Deps = {
      now: () => DAY,
      counter: {
        reserve: async (r, n) => s.tx(() => reserve(s, r, n)),
        settle: async () => { settles++; if (mode === 'throw') throw new Error('down'); return { settled: false, charged: 0, reserved: 0, overrun: false }; },
      },
      ai: { run: async () => { const f = replies[calls++]; if (!f) throw new Error('unexpected call'); return f(); } },
      log: (x) => logs.push(x),
    };
    return { s, logs, calls: () => calls, settles: () => settles, run: () => handle(req(), e, deps) };
  }

  it('a settlement failure stops the request: 503 limiter_unavailable, no claims, the reservation stands, retried once, logged', async () => {
    for (const mode of ['throw', 'unknown'] as const) {
      const t = brokenSettle([async () => ({ response: GOOD, usage: { prompt_tokens: 1, completion_tokens: 1 } })], mode);
      const r = await t.run();
      expect(r.status).toBe(503);
      const body = (await r.json()) as { error?: { code: string }; claims?: unknown };
      expect(body.error?.code).toBe('limiter_unavailable');
      expect(body.claims).toBeUndefined();
      expect(t.settles()).toBe(2);
      expect(budgetOn(t.s, DAY)).toMatchObject({ attempts: 1, charged: expectedReservation(false), unsettled: 1 });
      expect(t.logs.find((l) => l.evt === 'settle')).toMatchObject({ error: 'ledger_unavailable', knownOverrun: false });
    }
  });

  it('a settlement failure after an unusable answer stops BEFORE the repair: one model call, one attempt', async () => {
    const t = brokenSettle([async () => ({ response: 'not json', usage: { prompt_tokens: 500, completion_tokens: 20 } }), async () => ({ response: GOOD, usage: { prompt_tokens: 1, completion_tokens: 1 } })], 'throw');
    const r = await t.run();
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('limiter_unavailable');
    expect(t.calls()).toBe(1);
    expect(budgetOn(t.s, DAY)).toMatchObject({ attempts: 1, unsettled: 1 });
  });

  it('a settlement failure after a model error or timeout also stops with limiter_unavailable (no repair, no retry of the call)', async () => {
    const t = brokenSettle([async () => { throw new Error('capacity temporarily exceeded'); }], 'throw');
    expect((await t.run()).status).toBe(503);
    expect(t.calls()).toBe(1);
    expect(t.logs.find((l) => l.evt === 'settle')).toMatchObject({ error: 'ledger_unavailable', measured: false });
  });

  it('a known overrun whose settlement fails is not silently kept at the smaller charge: the request stops and the log carries the estimate', async () => {
    const t = brokenSettle([async () => ({ response: GOOD, usage: { prompt_tokens: 50_000, completion_tokens: 5000 } })], 'throw');
    const r = await t.run();
    expect(r.status).toBe(503);
    const settleLog = t.logs.find((l) => l.evt === 'settle')!;
    expect(settleLog).toMatchObject({ error: 'ledger_unavailable', knownOverrun: true, overrun: true, estimate: charge(BASELINE_MODEL, 50_000, 5000) });
    expect(settleLog.estimate as number).toBeGreaterThan(expectedReservation(false));
    expect(t.logs.find((l) => l.evt === 'extract')).toMatchObject({ status: 503, code: 'limiter_unavailable' });
  });

  it('an overrun on the first attempt blocks its own repair, even with budget left', async () => {
    // Unusable first answer whose reported usage exceeds its reservation; 5,000 budget leaves plenty of headroom.
    const t = setup([async () => ({ response: 'not json', usage: { prompt_tokens: 50_000, completion_tokens: 5000 } }), async () => ({ response: GOOD, usage: { prompt_tokens: 1, completion_tokens: 1 } })]);
    const r = await t.run();
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('daily_limit');
    expect(t.calls()).toBe(1);
    const b = budgetOn(t.s, DAY);
    expect(b).toMatchObject({ attempts: 1, overruns: 1, charged: charge(BASELINE_MODEL, 50_000, 5000) });
    expect(b.charged).toBeLessThan(5000);
    expect(t.logs.find((l) => l.evt === 'admission')).toMatchObject({ refused: 'overrun' });
  });

  it('after an overrun, every later request that day is refused before the model, with budget left', async () => {
    const t = setup([async () => ({ response: GOOD, usage: { prompt_tokens: 50_000, completion_tokens: 5000 } })]);
    expect((await t.run()).status).toBe(200); // the overrunning answer itself is valid and returned; its charge is recorded in full
    const second = await t.run();
    expect(second.status).toBe(429);
    expect(t.calls()).toBe(1);
    expect(budgetOn(t.s, DAY)).toMatchObject({ attempts: 1, overruns: 1 });
  });
});
