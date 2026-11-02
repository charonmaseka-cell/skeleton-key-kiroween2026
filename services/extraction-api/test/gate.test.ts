import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AdmitResult } from '../src/admission';
import type { EnvVars } from '../src/config';
import { checkGate, gateConfig, MIN_GATE_TOKEN_LENGTH } from '../src/gate';
import { handle, type Deps } from '../src/handler';
import { health } from '../src/health';

// The explicit access gate. Authentication is selected by ACCESS_GATE, never by whether a secret is bound, and every
// misconfiguration closes the service before the origin check, the body, admission or the model.

const TOKEN = 'k'.repeat(43);
const DUMMY_ORIGIN = 'https://gate-test-client.invalid';
const base: EnvVars = { ALLOWED_ORIGINS: DUMMY_ORIGIN, DAILY_ADMISSION_CEILING: '4' };
const gated: EnvVars = { ...base, ACCESS_GATE: 'token', TEST_GATE_TOKEN: TOKEN };

function setup() {
  const state = { ai: 0, admit: 0, used: 0, logs: [] as string[] };
  const deps: Deps = {
    now: () => 1_700_000_000_000,
    counter: {
      async admit(c: number): Promise<AdmitResult> {
        state.admit++;
        if (state.used >= c) return { ok: false, used: state.used, ceiling: c };
        state.used++;
        return { ok: true, used: state.used, ceiling: c };
      },
    },
    ai: {
      async run() {
        state.ai++;
        return { response: { claims: [{ field: 'organisation_name', blockId: 'b1', excerpt: 'Acme Trust', value: 'Acme Trust' }] }, usage: { prompt_tokens: 7, completion_tokens: 3 } };
      },
    },
    log: (e) => state.logs.push(JSON.stringify(e)),
  };
  return { deps, state };
}

const req = (headers: Record<string, string> = {}, method = 'POST') =>
  new Request('https://gate.test/extract', {
    method,
    headers: { origin: DUMMY_ORIGIN, 'content-type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify({ schemaId: 'packcheck.grant.v1', blocks: [{ id: 'b1', text: 'Organisation: Acme Trust' }] }) : undefined,
  });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('gateConfig: explicit mode, fail closed', () => {
  it.each<[string, EnvVars, string]>([
    ['mode missing, no secret', {}, 'gate_mode_invalid'],
    ['mode missing, secret bound (a secret alone never selects a mode)', { TEST_GATE_TOKEN: TOKEN }, 'gate_mode_invalid'],
    ['mode in other casing', { ACCESS_GATE: 'Token', TEST_GATE_TOKEN: TOKEN }, 'gate_mode_invalid'],
    ['mode empty', { ACCESS_GATE: '' }, 'gate_mode_invalid'],
    ['token mode, secret not bound', { ACCESS_GATE: 'token' }, 'credential_missing'],
    ['token mode, empty secret', { ACCESS_GATE: 'token', TEST_GATE_TOKEN: '' }, 'credential_missing'],
    ['token mode, short secret', { ACCESS_GATE: 'token', TEST_GATE_TOKEN: 'x'.repeat(MIN_GATE_TOKEN_LENGTH - 1) }, 'credential_missing'],
    ['public mode with a secret bound', { ACCESS_GATE: 'public', TEST_GATE_TOKEN: TOKEN }, 'credential_in_public_mode'],
  ])('%s -> closed', (_n, env, reason) => {
    expect(gateConfig(env)).toMatchObject({ ok: false, reason });
  });

  it('valid modes', () => {
    expect(gateConfig({ ACCESS_GATE: 'public' })).toEqual({ ok: true, mode: 'public' });
    expect(gateConfig({ ACCESS_GATE: 'token', TEST_GATE_TOKEN: TOKEN })).toMatchObject({ ok: true, mode: 'token' });
  });
});

describe('handler with the gate', () => {
  const refused: [string, EnvVars, Record<string, string>, string, number][] = [
    ['token mode, no Authorization', gated, {}, 'unauthorized', 401],
    ['token mode, wrong token', gated, bearer('j'.repeat(43)), 'unauthorized', 401],
    ['token mode, token with a suffix', gated, bearer(`${TOKEN}x`), 'unauthorized', 401],
    ['token mode, token prefix only', gated, bearer(TOKEN.slice(0, 40)), 'unauthorized', 401],
    ['token mode, wrong scheme', gated, { authorization: `Basic ${TOKEN}` }, 'unauthorized', 401],
    ['token mode, right token, unlisted origin', gated, { ...bearer(TOKEN), origin: 'https://skeleton-key-scopecheck.pages.dev' }, 'origin_denied', 403],
    ['token mode, secret not bound, right token sent', { ...base, ACCESS_GATE: 'token' }, bearer(TOKEN), 'not_configured', 503],
    ['mode missing, secret bound, right token sent', { ...base, TEST_GATE_TOKEN: TOKEN }, bearer(TOKEN), 'not_configured', 503],
    ['mode missing, nothing bound', base, {}, 'not_configured', 503],
    ['public mode with a secret bound', { ...base, ACCESS_GATE: 'public', TEST_GATE_TOKEN: TOKEN }, {}, 'not_configured', 503],
  ];
  it.each(refused)('%s: refused before admission and the model', async (_n, env, headers, code, status) => {
    const { deps, state } = setup();
    const res = await handle(req(headers), env, deps);
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
    expect(state.admit).toBe(0);
    expect(state.ai).toBe(0);
  });

  it('token mode, OPTIONS without a token is refused too', async () => {
    const { deps, state } = setup();
    expect((await handle(req({}, 'OPTIONS'), gated, deps)).status).toBe(401);
    expect(state.admit + state.ai).toBe(0);
  });

  it('token mode, right token and the dummy origin: admitted once, model called once', async () => {
    const { deps, state } = setup();
    const res = await handle(req(bearer(TOKEN)), gated, deps);
    expect(res.status).toBe(200);
    expect(state.admit).toBe(1);
    expect(state.ai).toBe(1);
  });

  it('the token never appears in a response or a log line', async () => {
    const { deps, state } = setup();
    const bodies: string[] = [];
    for (const h of [{}, bearer('j'.repeat(43)), bearer(TOKEN)]) bodies.push(await (await handle(req(h), gated, deps)).text());
    for (const s of [...bodies, ...state.logs]) expect(s).not.toContain(TOKEN);
  });

  it('public mode behaves as before: no Authorization needed', async () => {
    const { deps } = setup();
    expect((await handle(req(), { ...base, ACCESS_GATE: 'public' }, deps)).status).toBe(200);
  });

  it('checkGate does not accept a missing header when the token is configured', async () => {
    expect(await checkGate(gated, new Request('https://gate.test/extract'))).toBe('unauthorized');
  });
});

describe('health reports the gate without revealing the secret', () => {
  const counter = { admit: async (c: number) => ({ ok: false, used: 0, ceiling: c }), usedToday: async () => 0 };
  const ai = { run: async () => { throw new Error('not called'); } };
  it('token mode without the secret: 503 with the reason', async () => {
    const r = await health({ ...base, ACCESS_GATE: 'token' }, { now: () => 0, ai, counter });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ ok: false, checks: { accessGate: { mode: 'token', valid: false, credentialBound: false, reason: 'credential_missing' } } });
  });
  it('token mode with the secret: 200, secret not in the body', async () => {
    const r = await health(gated, { now: () => 0, ai, counter });
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toMatchObject({ checks: { accessGate: { mode: 'token', valid: true, credentialBound: true } } });
  });
});

describe('Worker configuration files', () => {
  const vars = (file: string) => {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const section = text.slice(text.indexOf('[vars]'));
    const v: Record<string, string> = {};
    for (const m of section.matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"/gm)) v[m[1]!] = m[2]!;
    return { text, v };
  };

  it('production: explicit public mode, admission closed, no gate token', () => {
    const { text, v } = vars('wrangler.toml');
    expect(text).toMatch(/^name = "skeleton-key-extraction"$/m);
    expect(v.ACCESS_GATE).toBe('public');
    expect(v.DAILY_ADMISSION_CEILING).toBe('0');
    expect(v.TEST_GATE_TOKEN).toBeUndefined();
  });

  it('staging gate: separate Worker, token mode, dummy .invalid origin only, ceiling 4, limits fit the largest test payload', () => {
    const { text, v } = vars('wrangler.gate.toml');
    expect(text).toMatch(/^name = "skeleton-key-extraction-gate"$/m);
    expect(v.ACCESS_GATE).toBe('token');
    expect(v.TEST_GATE_TOKEN).toBeUndefined(); // a secret, never a committed var
    expect(v.ALLOWED_ORIGINS).toBe('https://gate-test-client.invalid');
    expect(v.DAILY_ADMISSION_CEILING).toBe('4');
    expect(v.MAX_REPAIR_ATTEMPTS).toBe('1');
    // largest test payload (docs/results/task-5-5-reservations.json): 4,753 body bytes, 3,471 counted chars, 48 blocks, longest block 142
    expect(Number(v.MAX_BODY_BYTES)).toBeGreaterThanOrEqual(4753);
    expect(Number(v.MAX_CHARS)).toBeGreaterThanOrEqual(3471);
    expect(Number(v.MAX_BLOCKS)).toBeGreaterThanOrEqual(48);
    expect(Number(v.MAX_BLOCK_CHARS)).toBeGreaterThanOrEqual(142);
  });
});
