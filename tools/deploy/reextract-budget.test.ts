import { describe, expect, it } from 'vitest';
import { GATE_URL_RE, MAX_ATTEMPTS, RUN_NEURON_CAP, TEST_ORIGIN, buildRequest, healthProblem, runReextract, toRecording, type Http, type Request1 } from './reextract-budget';

// The single-attempt re-extraction runner, offline: a fake Worker counts what it is sent. These tests are what makes the live
// step safe to run once: one POST at most, no retry on any outcome, nothing sent unless the health check is clean.

const TOKEN = 'T'.repeat(43);
const healthy = (over: Record<string, unknown> = {}) => ({
  ok: true,
  checks: { accessGate: { mode: 'token', valid: true, credentialBound: true }, admission: { dailyCeiling: 1, open: true }, durableObject: { usedToday: 0, budgetToday: { attempts: 0, charged: 0 } }, ...over },
});
const CLAIMS = [{ field: 'organisation_name', kind: 'name', blockId: 'p1-l2', excerpt: 'Applicant: X', value: 'X' }];

function fake(opts: { health0?: unknown; status?: number; body?: unknown; throws?: boolean; afterCounter?: number; ms?: number } = {}) {
  const seen: { path: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const http: Http = async (path, init) => {
    seen.push({ path, method: init.method, headers: init.headers, body: init.body });
    if (path === '/health') {
      const first = seen.filter((s) => s.path === '/health').length === 1;
      return { status: 200, json: first ? (opts.health0 ?? healthy()) : healthy({ durableObject: { usedToday: opts.afterCounter ?? 1, budgetToday: { attempts: 1, charged: 300 } } }), ms: 5 };
    }
    if (opts.throws) throw new Error('boom');
    return { status: opts.status ?? 200, json: opts.body ?? { claims: CLAIMS, meta: { attempts: 1, repaired: false, dropped: 0, usage: { promptTokens: 400, completionTokens: 120 } } }, ms: opts.ms ?? 9000 };
  };
  return { http, seen, posts: () => seen.filter((s) => s.path === '/extract') };
}

let request: Request1;
const run = async (f: ReturnType<typeof fake>, over: Partial<Request1> = {}) => {
  request ??= await buildRequest();
  const writes: string[] = [];
  const r = await runReextract({ http: f.http, token: TOKEN, request: { ...request, ...over }, persist: (x) => writes.push(JSON.stringify(x)), gateUrl: 'https://skeleton-key-extraction-gate.x.workers.dev' });
  return { r, writes };
};

describe('the request is the browser client\'s request for the CURRENT budget PDF', () => {
  it('is exactly one chunk with the v2 PackCheck profile and the current text, and fits the run cap', async () => {
    const q = await buildRequest();
    const body = JSON.parse(q.body) as { schemaId: string; blocks: { id: string; text: string }[] };
    expect(body.schemaId).toBe('packcheck.grant.v2');
    expect(Object.keys(body).sort()).toEqual(['blocks', 'schemaId']);
    expect(body.blocks.length).toBe(q.blocksSent);
    expect(body.blocks.map((b) => b.text)).toContain('Project period: 01/03/2026 to 28 February 2027'); // the CURRENT pdf, not the old line
    expect(body.blocks.map((b) => b.text).join('\n')).not.toContain('28/02/2027');
    expect(q.model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(q.reservation).toBeGreaterThan(0);
    expect(q.reservation).toBeLessThan(RUN_NEURON_CAP);
    expect(q.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('exactly one attempt', () => {
  it('a clean run sends one POST /extract with the bearer token and the test origin, and nothing else', async () => {
    const f = fake();
    const { r } = await run(f);
    expect(MAX_ATTEMPTS).toBe(1);
    expect(f.posts()).toHaveLength(1);
    expect(f.posts()[0]!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, origin: TEST_ORIGIN });
    expect(f.posts()[0]!.body).toBe(request.body);
    expect(r).toMatchObject({ verdict: 'pass', stop: null, attemptsSent: 1, counterEnd: 1 });
    expect(r.neurons.estimateBeforeMargin).toBeGreaterThan(0);
    expect(r.neurons.chargeWithMargin).toBeCloseTo(r.neurons.estimateBeforeMargin! * 1.1, 9);
  });

  for (const [name, o] of [['a 5xx', { status: 503, body: { error: { code: 'model_unavailable' } } }], ['a schema error', { status: 502, body: { error: { code: 'schema_invalid' } } }], ['a 429', { status: 429, body: { error: { code: 'daily_limit' } } }], ['a thrown request', { throws: true }], ['a timeout-length answer', { ms: 25_000 }]] as const) {
    it(`${name}: stops, never retries, never repairs, keeps what happened`, async () => {
      const f = fake(o);
      const { r, writes } = await run(f);
      expect(f.posts()).toHaveLength(1);
      expect(r.verdict).toBe('fail');
      expect(r.stop).toBeTruthy();
      expect(r.attemptsSent).toBe(1);
      expect(writes.length).toBeGreaterThan(0); // partial results were written
      expect(() => toRecording(r, { workerCommit: 'x', budgetPdfSha256: 'y' })).toThrow(/only a passed run/);
    });
  }

  it('a 200 without a claims array, or without token usage, is a failure and is not recorded', async () => {
    for (const body of [{ meta: {} }, { claims: CLAIMS, meta: {} }]) {
      const f = fake({ body });
      const { r } = await run(f);
      expect(f.posts()).toHaveLength(1);
      expect(r.verdict).toBe('fail');
    }
  });

  it('a counter that does not end at 1 is a failure', async () => {
    const { r } = await run(fake({ afterCounter: 2 }));
    expect(r).toMatchObject({ verdict: 'fail', stop: 'counter ended at 2, not 1' });
  });
});

describe('nothing is sent unless the staging Worker is exactly as expected', () => {
  const bad: [string, unknown][] = [
    ['public gate mode', healthy({ accessGate: { mode: 'public', valid: true, credentialBound: false } })],
    ['credential not bound', healthy({ accessGate: { mode: 'token', valid: true, credentialBound: false } })],
    ['invalid gate', healthy({ accessGate: { mode: 'token', valid: false, credentialBound: true } })],
    ['ceiling 4', healthy({ admission: { dailyCeiling: 4, open: true } })],
    ['ceiling 0', healthy({ admission: { dailyCeiling: 0, open: false } })],
    ['counter already 1', healthy({ durableObject: { usedToday: 1, budgetToday: { attempts: 1, charged: 0 } } })],
    ['ledger already charged', healthy({ durableObject: { usedToday: 0, budgetToday: { attempts: 0, charged: 12 } } })],
    ['not ok', { ok: false }],
  ];
  for (const [name, h] of bad) {
    it(`${name}: zero POSTs`, async () => {
      const f = fake({ health0: h });
      const { r } = await run(f);
      expect(f.posts()).toHaveLength(0);
      expect(r).toMatchObject({ verdict: 'fail', attemptsSent: 0 });
      expect(r.stop).toMatch(/^precheck:/);
    });
  }

  it('a worst case above the run cap sends nothing', async () => {
    const f = fake();
    const { r } = await run(f, { reservation: RUN_NEURON_CAP + 1 });
    expect(f.posts()).toHaveLength(0);
    expect(r.stop).toMatch(/exceeds the run cap/);
  });

  it('only the staging gate Worker URL is accepted, never the production Worker', () => {
    expect(GATE_URL_RE.test('https://skeleton-key-extraction-gate.teddykgroup.workers.dev')).toBe(true);
    expect(GATE_URL_RE.test('https://skeleton-key-extraction.teddykgroup.workers.dev')).toBe(false);
    expect(GATE_URL_RE.test('https://skeleton-key-extraction-gate.teddykgroup.workers.dev.evil.example')).toBe(false);
    expect(GATE_URL_RE.test('http://skeleton-key-extraction-gate.teddykgroup.workers.dev')).toBe(false);
  });

  it('healthProblem accepts exactly the expected state', () => {
    expect(healthProblem(healthy() as never, 200)).toBeNull();
    expect(healthProblem(healthy() as never, 503)).toMatch(/health 503/);
  });
});

describe('the result and the recording', () => {
  it('never contain the token, keep the claims byte for byte, and carry their provenance', async () => {
    const f = fake();
    const { r, writes } = await run(f);
    expect(writes.every((w) => !w.includes(TOKEN))).toBe(true);
    const rec = toRecording(r, { workerCommit: 'abc123', budgetPdfSha256: 'def456' });
    expect(JSON.stringify(rec)).not.toContain(TOKEN);
    expect(rec.samples[0]!.docs[0]).toMatchObject({ docId: 'budget', profile: { id: 'packcheck.grant.v2' } });
    expect(rec.samples[0]!.docs[0]!.claimsReturned).toEqual(CLAIMS);
    expect(JSON.stringify(rec.samples[0]!.docs[0]!.claimsReturned)).toBe(JSON.stringify(CLAIMS));
    expect(rec.provenance).toMatchObject({ workerCommit: 'abc123', budgetPdfSha256: 'def456', attemptsSent: 1 });
    expect(rec.settings.maxRepairAttempts).toBe(0);
  });
});
