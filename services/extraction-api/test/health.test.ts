import { describe, expect, it } from 'vitest';
import { health } from '../src/health';

// The deployment check, with fakes: what makes it fail, and that the response carries nothing sensitive.

const env = { ALLOWED_ORIGINS: 'https://scopecheck.example', DAILY_ADMISSION_CEILING: '0', ACCESS_GATE: 'public' };
const counter = (used = 0, opts: { writes?: boolean; throws?: boolean } = {}) => {
  let n = used;
  return {
    admit: async (ceiling: number) => { if (opts.throws) throw new Error('down'); if (opts.writes) n++; return { ok: n < ceiling, used: n, ceiling }; },
    usedToday: async () => { if (opts.throws) throw new Error('down'); return n; },
  };
};
const ai = { run: async () => { throw new Error('the deployment check must not call the model'); } };

describe('health()', () => {
  it('passes for a closed, correctly bound deployment', async () => {
    const r = await health(env, { now: () => 0, ai, counter: counter() });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, checks: { admission: { dailyCeiling: 0, open: false } } });
  });

  it('fails when the counter is unreachable', async () => {
    const r = await health(env, { now: () => 0, ai, counter: counter(0, { throws: true }) });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ ok: false, checks: { durableObject: { reachable: false } } });
  });

  it('fails if the zero-ceiling probe ever writes (a counter that admits past its ceiling)', async () => {
    const r = await health(env, { now: () => 0, ai, counter: counter(0, { writes: true }) });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { checks: { durableObject: { unchangedAfterCheck: boolean } } }).checks.durableObject.unchangedAfterCheck).toBe(false);
  });

  it('fails on an invalid configuration', async () => {
    const r = await health({ DAILY_ADMISSION_CEILING: 'many' }, { now: () => 0, ai, counter: counter() });
    expect(r.status).toBe(503);
  });

  it('never calls the model, and the body holds no origins, secrets or account identifiers', async () => {
    const r = await health(env, { now: () => 0, ai, counter: counter() });
    const text = await r.text();
    expect(text).not.toMatch(/scopecheck\\.example|token|account|secret/i);
  });
});
