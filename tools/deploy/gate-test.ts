// Task 5.5: the gated binding test against the THROWAWAY staging Worker (wrangler.gate.toml). Sequential, at most 4 inference
// attempts in total (the staging Worker's own ceiling), and every stop condition ends inference immediately.
//
//   GATE_URL=https://skeleton-key-extraction-gate.<subdomain>.workers.dev npx tsx tools/deploy/gate-test.ts
//
// Sequence (docs/task-5-5-plan.md):
//   P0 time: at least MIN_MS_BEFORE_MIDNIGHT before 00:00 UTC (the counter resets at midnight; a reset would re-open admission)
//   P1 /health: gate token-mode and valid, ceiling 4, counter 0, binding present
//   P2 refusals that consume nothing: no token (401), wrong token (401), right token from a non-allowed origin (403); counter still 0
//   T1 tiny, T2 largest realistic chunk, T3 a chunk of a second document; T4 tiny ONLY while the counter is below 4
//      (a repair the Worker made in T1 to T3 uses the slot T4 would have used)
//   R  only if the counter is exactly 4, no stop fired and it is still the same UTC day: one more request, which must be refused
//      with daily_limit, and the counter must still be 4. A refused request consumes nothing.
// Stop conditions (no further /extract request of any kind once one fires): non-200 from an inference step, missing token usage,
// a counter that does not equal the attempts reported, latency at or above the timeout, a failed precheck.
// The bearer token is read from the git-ignored secret file and is never printed or written to the result.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toRequestBlock, type Block } from '@skeleton-key/engine';
import { frozenChunker, type FrozenPlan } from '../benchmark/src/chunking';
import { loadBlocks, loadSample, SAMPLES_DIR } from '../benchmark/src/samples';
import { readSecret } from './gate-secret';

export const CEILING = 4;
export const TIMEOUT_MS = 25_000;
export const MIN_MS_BEFORE_MIDNIGHT = 60 * 60_000;
export const TEST_ORIGIN = 'https://gate-test-client.invalid';
export const NOT_ALLOWED_ORIGIN = 'https://skeleton-key-scopecheck.pages.dev';

export type StepId = 'T1' | 'T2' | 'T3' | 'T4';
export type Payload = { step: StepId; id: string; schemaId: string; body: string };
export const PAYLOAD_IDS: Record<StepId, { sample: string; doc: string; chunk: number | null }> = {
  T1: { sample: 'scopecheck', doc: 'rfq', chunk: null },
  T2: { sample: 'scopecheck-realistic', doc: 'rfq', chunk: 6 },
  T3: { sample: 'scopecheck-realistic', doc: 'quote-a', chunk: 8 },
  T4: { sample: 'packcheck', doc: 'registration', chunk: null },
};

/** Builds the exact request bodies offline, as the client does (frozen chunk plans, toRequestBlock). */
export async function buildPayloads(): Promise<Record<StepId, Payload>> {
  const out = {} as Record<StepId, Payload>;
  for (const step of Object.keys(PAYLOAD_IDS) as StepId[]) {
    const { sample, doc, chunk } = PAYLOAD_IDS[step];
    const d = loadSample(sample).docs.find((x) => x.id === doc)!;
    const blocks = await loadBlocks(sample, d);
    let chosen: Block[] = blocks;
    let schemaId = d.schemaId;
    if (chunk !== null) {
      const plan = JSON.parse(readFileSync(join(SAMPLES_DIR, sample, 'chunk-plan.json'), 'utf8')) as FrozenPlan;
      schemaId = plan.docs.find((x) => x.docId === doc)!.schemaId;
      chosen = frozenChunker(plan)(doc, blocks, schemaId).chunks[chunk - 1]!;
    }
    out[step] = { step, id: `${sample}/${doc}${chunk ? `#${chunk}` : ''}`, schemaId, body: JSON.stringify({ schemaId, blocks: chosen.map((b) => toRequestBlock(b)) }) };
  }
  return out;
}

export type Http = (path: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json: unknown; ms: number }>;
type Health = { ok?: boolean; checks?: { workersAiBinding?: string; durableObject?: { usedToday?: number | null }; admission?: { dailyCeiling?: number | null }; accessGate?: { mode?: string; valid?: boolean; credentialBound?: boolean } } };
type ExtractJson = { claims?: unknown[]; meta?: { attempts?: number; repaired?: boolean; dropped?: number; usage?: { promptTokens?: number | null; completionTokens?: number | null } }; error?: { code?: string } };

export type StepRecord = {
  step: string; payload?: string; bodyBytes?: number; status: number | null; code: string; ms: number | null;
  attempts: number | null; repaired: boolean | null; claims: number | null; dropped: number | null;
  promptTokens: number | null; completionTokens: number | null; counterBefore: number | null; counterAfter: number | null;
};
export type GateTestResult = {
  startedAt: string; endedAt: string; ceiling: number; prechecks: { name: string; ok: boolean; detail: string }[];
  steps: StepRecord[]; skipped: { step: string; reason: string }[]; stop: { at: string; reason: string } | null;
  refusal: StepRecord | null; inferenceRequestsSent: number; counterEnd: number | null; verdict: 'pass' | 'fail';
};

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msToMidnight = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - ms; };

export async function runGateTest(opts: { http: Http; token: string; payloads: Record<StepId, Payload>; now?: () => number }): Promise<GateTestResult> {
  const now = opts.now ?? Date.now;
  const start = now();
  const r: GateTestResult = { startedAt: new Date(start).toISOString(), endedAt: '', ceiling: CEILING, prechecks: [], steps: [], skipped: [], stop: null, refusal: null, inferenceRequestsSent: 0, counterEnd: null, verdict: 'fail' };
  const finish = async () => { r.counterEnd = await counter(); r.endedAt = new Date(now()).toISOString(); return r; };
  const stop = (at: string, reason: string) => { r.stop = { at, reason }; };
  const health = async (): Promise<Health | null> => { try { const h = await opts.http('/health', { method: 'GET', headers: {} }); return h.json as Health; } catch { return null; } };
  const counter = async () => { const h = await health(); const u = h?.checks?.durableObject?.usedToday; return typeof u === 'number' ? u : null; };
  const post = (p: Payload, headers: Record<string, string>) => opts.http('/extract', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: p.body });
  const auth = { origin: TEST_ORIGIN, authorization: `Bearer ${opts.token}` };
  const pre = (name: string, ok: boolean, detail: string) => { r.prechecks.push({ name, ok, detail }); if (!ok) stop(name, detail); return ok; };

  // P0
  if (!pre('P0 time before 00:00 UTC', msToMidnight(start) >= MIN_MS_BEFORE_MIDNIGHT, `${Math.round(msToMidnight(start) / 60_000)} min to midnight`)) return finish();
  // P1
  const h = await health();
  const g = h?.checks?.accessGate;
  if (!pre('P1 health', !!h?.ok && g?.mode === 'token' && g.valid === true && g.credentialBound === true && h.checks?.admission?.dailyCeiling === CEILING && h.checks?.durableObject?.usedToday === 0 && h.checks?.workersAiBinding === 'present (not called)',
    JSON.stringify({ ok: h?.ok ?? null, gate: g ?? null, ceiling: h?.checks?.admission?.dailyCeiling ?? null, used: h?.checks?.durableObject?.usedToday ?? null }))) return finish();
  // P2: refused before admission; consumes nothing
  const expectRefused = async (name: string, headers: Record<string, string>, status: number, code: string) => {
    const res = await post(opts.payloads.T1, headers);
    const c = (res.json as ExtractJson).error?.code ?? 'ok';
    return pre(name, res.status === status && c === code, `${res.status} ${c}`);
  };
  if (!(await expectRefused('P2a no token', { origin: TEST_ORIGIN }, 401, 'unauthorized'))) return finish();
  if (!(await expectRefused('P2b wrong token', { origin: TEST_ORIGIN, authorization: `Bearer ${randomBytes(32).toString('base64url')}` }, 401, 'unauthorized'))) return finish();
  if (!(await expectRefused('P2c right token, origin not allowed', { origin: NOT_ALLOWED_ORIGIN, authorization: auth.authorization }, 403, 'origin_denied'))) return finish();
  let used = await counter();
  if (!pre('P2d counter still 0', used === 0, `counter ${used}`)) return finish();

  // T1..T4
  for (const step of ['T1', 'T2', 'T3', 'T4'] as StepId[]) {
    if (used === null || used >= CEILING) { r.skipped.push({ step, reason: `counter ${used} of ${CEILING}: the ceiling was used (by a repair)` }); continue; }
    const p = opts.payloads[step];
    r.inferenceRequestsSent++;
    let res: Awaited<ReturnType<Http>>;
    try { res = await post(p, auth); } catch (e) { stop(step, `request failed: ${(e as Error).name}`); return finish(); }
    const j = res.json as ExtractJson;
    const after = await counter();
    const u = j.meta?.usage;
    const rec: StepRecord = {
      step, payload: p.id, bodyBytes: Buffer.byteLength(p.body), status: res.status, code: j.error?.code ?? 'ok', ms: res.ms,
      attempts: j.meta?.attempts ?? null, repaired: j.meta?.repaired ?? null, claims: j.claims?.length ?? null, dropped: j.meta?.dropped ?? null,
      promptTokens: typeof u?.promptTokens === 'number' ? u.promptTokens : null, completionTokens: typeof u?.completionTokens === 'number' ? u.completionTokens : null,
      counterBefore: used, counterAfter: after,
    };
    r.steps.push(rec);
    if (res.status !== 200) { stop(step, `HTTP ${res.status} ${rec.code}`); return finish(); }
    if (rec.promptTokens === null || rec.completionTokens === null) { stop(step, 'token usage not reported'); return finish(); }
    if (after === null || rec.attempts === null || after !== used + rec.attempts) { stop(step, `counter ${used} -> ${after} does not match ${rec.attempts} attempt(s)`); return finish(); }
    if (res.ms >= TIMEOUT_MS) { stop(step, `latency ${res.ms} ms at or above the ${TIMEOUT_MS} ms timeout`); return finish(); }
    used = after;
  }

  // R: refusal at the ceiling (only when it is certainly reached, and on the same UTC day)
  if (used !== CEILING) { stop('R', `counter ${used}, not ${CEILING}: refusal not tested`); return finish(); }
  if (utcDay(now()) !== utcDay(start)) { stop('R', 'UTC day changed: the counter has reset, so a request could be admitted; refusal not sent'); return finish(); }
  const res = await post(opts.payloads.T4, auth);
  const after = await counter();
  const code = (res.json as ExtractJson).error?.code ?? 'ok';
  r.refusal = { step: 'R', payload: opts.payloads.T4.id, bodyBytes: Buffer.byteLength(opts.payloads.T4.body), status: res.status, code, ms: res.ms, attempts: null, repaired: null, claims: null, dropped: null, promptTokens: null, completionTokens: null, counterBefore: used, counterAfter: after };
  if (res.status !== 429 || code !== 'daily_limit' || after !== CEILING) { stop('R', `expected 429 daily_limit with counter ${CEILING}; got ${res.status} ${code}, counter ${after}`); return finish(); }
  r.verdict = 'pass';
  return finish();
}

if (process.argv[1]?.endsWith('gate-test.ts')) {
  const base = (process.env.GATE_URL ?? '').replace(/\/$/, '');
  if (!/^https:\/\/skeleton-key-extraction-gate\.[a-z0-9-]+\.workers\.dev$/.test(base)) {
    console.error('GATE_URL must be the staging gate Worker (https://skeleton-key-extraction-gate.<subdomain>.workers.dev), never the production Worker');
    process.exit(2);
  }
  const http: Http = async (path, init) => {
    const t = performance.now();
    const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS + 10_000) });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, ms: Math.round(performance.now() - t) };
  };
  const result = await runGateTest({ http, token: readSecret(), payloads: await buildPayloads() });
  const file = join(new URL('../../', import.meta.url).pathname, 'docs', 'results', 'task-5-5-binding-test.json');
  writeFileSync(file, JSON.stringify({ gateUrl: base, ...result }, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: result.verdict, stop: result.stop, inferenceRequestsSent: result.inferenceRequestsSent, counterEnd: result.counterEnd, file }, null, 2));
}
