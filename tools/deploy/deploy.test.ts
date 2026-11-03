import { describe, expect, it } from 'vitest';
import { OPEN, ORIGINS, PAGES, buildApps, verify, verifyOpen, workerDeployArgs } from './deploy';

// The deployment verification logic, against a fake deployment (no network, no inference).

const healthy = { ok: true, checks: { workersAiBinding: 'present (not called)', durableObject: { reachable: true, zeroCeilingRefused: true, unchangedAfterCheck: true }, admission: { dailyCeiling: 0, open: false } } };
function fake(o: { health?: unknown; healthStatus?: number; allowedStatus?: number; allowedCode?: string; otherStatus?: number; pageStatus?: number } = {}) {
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url.endsWith('/health')) return j(o.healthStatus ?? 200, o.health ?? healthy);
    if (url.endsWith('/extract')) {
      const origin = (init?.headers as Record<string, string>).origin ?? '';
      return ORIGINS.includes(origin) ? j(o.allowedStatus ?? 429, { error: { code: o.allowedCode ?? 'daily_limit' } }) : j(o.otherStatus ?? 403, { error: { code: 'origin_denied' } });
    }
    return new Response('<!doctype html><div id="root"></div>', { status: o.pageStatus ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('deployment verification', () => {
  it('passes a closed deployment with working bindings and both sites up', async () => {
    const { f, calls } = fake();
    const v = await verify('https://w.example', f);
    expect(v.filter((c) => !c.ok)).toEqual([]);
    expect(v).toHaveLength(8);
    expect(calls.filter((c) => c.includes('pages.dev'))).toEqual(Object.values(PAGES).map((p) => `GET https://${p}.pages.dev/`));
  });

  it('fails if public admission is OPEN', async () => {
    const v = await verify('https://w.example', fake({ health: { ...healthy, checks: { ...healthy.checks, admission: { dailyCeiling: 20, open: true } } }, allowedStatus: 200, allowedCode: 'ok' }).f);
    expect(v.filter((c) => !c.ok).map((c) => c.name)).toEqual(['public admission CLOSED (ceiling 0)', '/extract from a Pages origin is refused before inference (daily_limit)']);
  });

  it('fails if the Durable Object is not reachable or the AI binding is missing', async () => {
    const bad = { ok: false, checks: { workersAiBinding: 'missing', durableObject: { reachable: false }, admission: { dailyCeiling: 0, open: false } } };
    const v = await verify('https://w.example', fake({ health: bad, healthStatus: 503 }).f);
    expect(v.filter((c) => !c.ok).map((c) => c.name)).toEqual(['Worker /health ok', 'Workers AI binding present (not called)', 'deployed Durable Object reachable, refuses at ceiling 0, writes nothing']);
  });

  it('fails if another origin is let through, or a site is down', async () => {
    const v = await verify('https://w.example', fake({ otherStatus: 429, pageStatus: 404 }).f);
    expect(v.filter((c) => !c.ok).map((c) => c.name)).toEqual(['/extract from another origin is refused (origin_denied)', 'scopecheck Pages site serves the app', 'packcheck Pages site serves the app']);
  });
});

describe('opening public analysis is explicit and separate', () => {
  it('a normal deploy is always closed (0 and 0), whatever wrangler.toml says', () => {
    const a = workerDeployArgs('closed');
    expect(a).toContain('DAILY_ADMISSION_CEILING:0');
    expect(a).toContain('DAILY_NEURON_BUDGET:0');
    expect(a).not.toContain('--dry-run');
  });
  it('opening needs the confirmation value to equal the approved budget, and passes the approved values', () => {
    expect(() => workerDeployArgs('open')).toThrow(/CONFIRM_OPEN_LIVE=4000/);
    expect(() => workerDeployArgs('open', { confirm: '5000' })).toThrow(/refusing to open/);
    const a = workerDeployArgs('open', { confirm: '4000', dryRun: true });
    expect(OPEN).toEqual({ dailyAdmissionCeiling: 40, dailyNeuronBudget: 4000 });
    expect(a).toEqual(['deploy', '--dry-run', '--var', `ALLOWED_ORIGINS:${ORIGINS.join(',')}`, '--var', 'DAILY_ADMISSION_CEILING:40', '--var', 'DAILY_NEURON_BUDGET:4000']);
  });
  it('the apps are only ever built with the production Worker URL', () => {
    expect(() => buildApps([], 'https://evil.example')).toThrow(/production Worker/);
    expect(() => buildApps([], 'https://skeleton-key-extraction-gate.x.workers.dev')).toThrow(/production Worker/);
  });
  it('verifyOpen passes an open deployment with the approved values and fails a closed or differently sized one, sending nothing that reaches the model', async () => {
    const open = { ok: true, checks: { workersAiBinding: 'present (not called)', durableObject: { reachable: true, zeroCeilingRefused: true, unchangedAfterCheck: true }, admission: { open: true, dailyCeiling: 40, dailyNeuronBudget: 4000 }, accessGate: { mode: 'public' } } };
    const mk = (health: unknown) => (async (url: string, init?: RequestInit) => {
      const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (url.endsWith('/health')) return j(200, health);
      if (url.endsWith('/extract')) {
        const h = init?.headers as Record<string, string>;
        if (!ORIGINS.includes(h.origin ?? '')) return j(403, { error: { code: 'origin_denied' } });
        expect(h['content-type']).toBe('text/plain'); // never a well-formed request from an allowed origin
        return j(400, { error: { code: 'invalid_input' } });
      }
      return new Response('<div id="root"></div>', { status: 200 });
    }) as unknown as typeof fetch;
    expect((await verifyOpen('https://w', mk(open))).filter((c) => !c.ok)).toEqual([]);
    const closed = { ...open, checks: { ...open.checks, admission: { open: false, dailyCeiling: 0, dailyNeuronBudget: 0 } } };
    expect((await verifyOpen('https://w', mk(closed))).some((c) => !c.ok)).toBe(true);
    const bigger = { ...open, checks: { ...open.checks, admission: { open: true, dailyCeiling: 40, dailyNeuronBudget: 5000 } } };
    expect((await verifyOpen('https://w', mk(bigger))).some((c) => !c.ok)).toBe(true);
  });
});
