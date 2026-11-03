// Task 5.5: the gated binding test against the THROWAWAY staging Worker (wrangler.gate.toml). Sequential (concurrency 1), at most
// 4 inference attempts in total (the staging Worker's own ceiling, repairs included), at most RUN_NEURON_CAP estimated neurons for
// the run and DAILY_NEURON_CAP for the UTC day, and every stop condition ends inference immediately.
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
//
// Neuron budget (client side; the staging Worker counts attempts only). BEFORE each step, the worst case of every attempt the
// step may use (1, or 2 when the Worker's single repair can still be admitted) is reserved at the GUARANTEED bound (1 byte per
// token, whole output allowance; budget.ts). The step is not sent if that would pass the run cap or the daily cap. AFTER it:
//   - the attempts actually used are the Durable Object counter's increase;
//   - the attempt whose usage the Worker reported (the last one of a 200) is charged in full from its tokens, NOT clipped to its
//     reservation; an overrun is recorded;
//   - every other used attempt (the first attempt of a repaired request; every attempt of a failed one) keeps its reservation,
//     because its consumption is unknown;
//   - reserved attempts that were not used are released.
// The daily baseline is the larger of the local ledger and every committed batch and gate record for the UTC day.
//
// Claims are validated (evidence located in the block, value supported) and audited by the benchmark's independent check BEFORE
// the next step. A value accepted as validated that its own evidence does not support stops the run (existing stop condition).
// Values held for review, dropped claims and extraction misses are OBSERVATIONS, recorded and never a stop.
//
// Other stop conditions (no further /extract request of any kind once one fires): non-200 from an inference step (schema,
// quota, auth, timeout ...), missing token usage, a counter that does not match the attempts reported, latency at or above the
// timeout, a failed precheck, a budget refusal. The result file is written after every step, so a failure keeps what was done.
// The bearer token is read from the git-ignored secret file and is never printed or written to the result.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { toRequestBlock, validateClaims, type Block, type Fact } from '@skeleton-key/engine';
import { PROFILES, buildMessages } from '../../services/extraction-api/src/profiles';
import { BYTES_PER_TOKEN_STRICT, charge, worstCaseNeurons } from '../benchmark/src/budget';
import { frozenChunker, type FrozenPlan } from '../benchmark/src/chunking';
import { auditFact } from '../benchmark/src/run';
import { HINTS, loadBlocks, loadSample, SAMPLES_DIR } from '../benchmark/src/samples';
import { readSecret } from './gate-secret';

export const CEILING = 4;
export const RUN_NEURON_CAP = 2_000;
export const DAILY_NEURON_CAP = 8_000;
export const TIMEOUT_MS = 25_000;
export const MIN_MS_BEFORE_MIDNIGHT = 60 * 60_000;
export const TEST_ORIGIN = 'https://gate-test-client.invalid';
export const NOT_ALLOWED_ORIGIN = 'https://skeleton-key-scopecheck.pages.dev';
const REPO = new URL('../../', import.meta.url).pathname;
export const RESULT_FILE = join(REPO, 'docs', 'results', 'task-5-5-binding-test.json');
export const LEDGER_FILE = join(REPO, '.benchmark-state', 'live-usage.json');

export type StepId = 'T1' | 'T2' | 'T3' | 'T4';
export type Payload = { step: StepId; id: string; docId: string; schemaId: string; body: string; blocks: Block[]; reserve: { first: number; repair: number } };
export const PAYLOAD_IDS: Record<StepId, { sample: string; doc: string; chunk: number | null }> = {
  T1: { sample: 'scopecheck', doc: 'rfq', chunk: null },
  T2: { sample: 'scopecheck-realistic', doc: 'rfq', chunk: 6 },
  T3: { sample: 'scopecheck-realistic', doc: 'quote-a', chunk: 8 },
  T4: { sample: 'packcheck', doc: 'registration', chunk: null },
};

const round = (n: number) => Math.ceil(n * 1000) / 1000; // charges round UP: never under-count

/** Builds the exact request bodies offline, as the client does (frozen chunk plans, toRequestBlock), with their reservations. */
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
    const sent = chosen.map((b) => toRequestBlock(b));
    const profile = PROFILES[schemaId]!;
    const worst = (repair: boolean) => round(worstCaseNeurons({ messages: buildMessages(profile, sent, repair), max_tokens: profile.maxOutputTokens }, profile.model, BYTES_PER_TOKEN_STRICT).neurons);
    out[step] = {
      step, id: `${sample}/${doc}${chunk ? `#${chunk}` : ''}`, docId: doc, schemaId, body: JSON.stringify({ schemaId, blocks: sent }),
      blocks, // the whole document's blocks: claims are validated against them, as the client does
      reserve: { first: worst(false), repair: worst(true) },
    };
  }
  return out;
}

/** Estimated neurons already charged on `day`: the larger of the local ledger and the committed batch and gate records. */
export function dailyBaseline(day: string, opts: { ledgerFile?: string; resultsDir?: string; gateFile?: string } = {}): { neurons: number; sources: string[] } {
  const ledgerFile = opts.ledgerFile ?? LEDGER_FILE;
  const resultsDir = opts.resultsDir ?? join(REPO, 'samples', 'benchmark-results');
  const gateFile = opts.gateFile ?? RESULT_FILE;
  const sources: string[] = [];
  let local = 0;
  if (existsSync(ledgerFile)) {
    const s = JSON.parse(readFileSync(ledgerFile, 'utf8')) as { day?: string; neuronsEstimated?: number };
    if (s.day === day && typeof s.neuronsEstimated === 'number') { local = s.neuronsEstimated; sources.push(`local ledger ${local}`); }
  }
  let committed = 0;
  if (existsSync(resultsDir)) {
    for (const f of readdirSync(resultsDir).filter((x) => /^batch-.*\.json$/.test(x))) {
      const b = JSON.parse(readFileSync(join(resultsDir, f), 'utf8')) as { neuronsCharged?: number; invocations?: { startedAt?: string }[] };
      if ((b.invocations ?? []).some((i) => i.startedAt?.slice(0, 10) === day) && typeof b.neuronsCharged === 'number') { committed += b.neuronsCharged; sources.push(`${f} ${b.neuronsCharged}`); }
    }
  }
  if (existsSync(gateFile)) {
    const g = JSON.parse(readFileSync(gateFile, 'utf8')) as { startedAt?: string; budget?: { runCharged?: number } };
    if (g.startedAt?.slice(0, 10) === day && typeof g.budget?.runCharged === 'number') { committed += g.budget.runCharged; sources.push(`earlier gate run ${g.budget.runCharged}`); }
  }
  return { neurons: Math.max(local, committed), sources };
}

export type Http = (path: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json: unknown; ms: number }>;
type Health = { ok?: boolean; checks?: { workersAiBinding?: string; durableObject?: { usedToday?: number | null }; admission?: { dailyCeiling?: number | null }; accessGate?: { mode?: string; valid?: boolean; credentialBound?: boolean } } };
type ExtractJson = { claims?: unknown[]; meta?: { attempts?: number; repaired?: boolean; dropped?: number; droppedReasons?: Record<string, number>; usage?: { promptTokens?: number | null; completionTokens?: number | null } }; error?: { code?: string } };

export type AttemptLedger = { step: string; attempt: number; reserved: number; charged: number; basis: 'reserved' | 'measured' | 'kept_unknown'; promptTokens: number | null; completionTokens: number | null; overrun: boolean };
export type Observations = { validated: number; heldForReview: Record<string, number>; droppedByWorker: number; droppedReasons: Record<string, number>; suspect: { field: string; value: unknown; blockId: string | null }[] };
export type StepRecord = {
  step: string; payload?: string; bodyBytes?: number; status: number | null; code: string; ms: number | null;
  attempts: number | null; repaired: boolean | null; claims: number | null; dropped: number | null;
  promptTokens: number | null; completionTokens: number | null; counterBefore: number | null; counterAfter: number | null;
  reservedBefore?: number; observations?: Observations; rawClaims?: unknown[];
};
export type GateTestResult = {
  startedAt: string; endedAt: string; complete: boolean; ceiling: number; prechecks: { name: string; ok: boolean; detail: string }[];
  steps: StepRecord[]; skipped: { step: string; reason: string }[]; stop: { at: string; reason: string } | null;
  refusal: StepRecord | null; inferenceRequestsSent: number; counterEnd: number | null; verdict: 'pass' | 'fail';
  budget: { runCap: number; dailyCap: number; dailyBaseline: number; baselineSources: string[]; runCharged: number; dailyAfter: number; overruns: number; attempts: AttemptLedger[]; basis: string };
};

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msToMidnight = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - ms; };

/** Validate and audit a response's claims against the document's blocks: the stop list and the observations. */
export function inspectClaims(p: Payload, claims: unknown[], audit: (f: Fact) => ReturnType<typeof auditFact> = auditFact): Observations {
  const facts = validateClaims(claims, { docId: p.docId, blocks: p.blocks, hintsByField: HINTS });
  const held: Record<string, number> = {};
  for (const f of facts) if (f.status !== 'validated') held[f.reason ?? 'unknown'] = (held[f.reason ?? 'unknown'] ?? 0) + 1;
  const suspect = facts.filter((f) => f.status === 'validated' && audit(f) === 'suspect').map((f) => ({ field: f.field, value: f.value, blockId: f.evidence[0]?.blockId ?? null }));
  return { validated: facts.filter((f) => f.status === 'validated').length, heldForReview: held, droppedByWorker: 0, droppedReasons: {}, suspect };
}

export type RunOptions = {
  http: Http; token: string; payloads: Record<StepId, Payload>; now?: () => number;
  /** called with the result so far after every change; the CLI writes it to disk (partial results survive a failure) */
  persist?: (r: GateTestResult) => void;
  dailyBaseline?: { neurons: number; sources: string[] };
  audit?: (f: Fact) => ReturnType<typeof auditFact>;
};

export async function runGateTest(opts: RunOptions): Promise<GateTestResult> {
  const now = opts.now ?? Date.now;
  const start = now();
  const base = opts.dailyBaseline ?? { neurons: 0, sources: [] };
  const r: GateTestResult = {
    startedAt: new Date(start).toISOString(), endedAt: '', complete: false, ceiling: CEILING, prechecks: [], steps: [], skipped: [], stop: null, refusal: null, inferenceRequestsSent: 0, counterEnd: null, verdict: 'fail',
    budget: { runCap: RUN_NEURON_CAP, dailyCap: DAILY_NEURON_CAP, dailyBaseline: base.neurons, baselineSources: base.sources, runCharged: 0, dailyAfter: base.neurons, overruns: 0, attempts: [], basis: 'ESTIMATES: published rates x 1.1 (budget.ts). Reservations at 1 byte per token with the whole output allowance; measured attempts charged in full from reported tokens; unknown attempts keep their reservation. Not dashboard-confirmed.' },
  };
  const save = () => { r.budget.runCharged = round(r.budget.attempts.reduce((n, a) => n + a.charged, 0)); r.budget.dailyAfter = round(base.neurons + r.budget.runCharged); r.budget.overruns = r.budget.attempts.filter((a) => a.overrun).length; r.endedAt = new Date(now()).toISOString(); opts.persist?.(r); };
  const finish = async () => { try { r.counterEnd = await counter(); } catch { r.counterEnd = null; } r.complete = true; save(); return r; };
  const stop = (at: string, reason: string) => { r.stop = { at, reason }; save(); };
  const health = async (): Promise<Health | null> => { try { const h = await opts.http('/health', { method: 'GET', headers: {} }); return h.json as Health; } catch { return null; } };
  const counter = async () => { const h = await health(); const u = h?.checks?.durableObject?.usedToday; return typeof u === 'number' ? u : null; };
  const post = (p: Payload, headers: Record<string, string>) => opts.http('/extract', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: p.body });
  const auth = { origin: TEST_ORIGIN, authorization: `Bearer ${opts.token}` };
  const pre = (name: string, ok: boolean, detail: string) => { r.prechecks.push({ name, ok, detail }); save(); if (!ok) stop(name, detail); return ok; };
  const charged = () => r.budget.attempts.reduce((n, a) => n + a.charged, 0);
  save();

  // P0
  if (!pre('P0 time before 00:00 UTC', msToMidnight(start) >= MIN_MS_BEFORE_MIDNIGHT, `${Math.round(msToMidnight(start) / 60_000)} min to midnight`)) return finish();
  if (!pre('P0 daily budget headroom', base.neurons < DAILY_NEURON_CAP, `${base.neurons} of ${DAILY_NEURON_CAP} estimated today (${base.sources.join('; ') || 'no earlier record'})`)) return finish();
  // P1
  const h = await health();
  const g = h?.checks?.accessGate;
  if (!pre('P1 health', !!h?.ok && g?.mode === 'token' && g.valid === true && g.credentialBound === true && h.checks?.admission?.dailyCeiling === CEILING && h.checks?.durableObject?.usedToday === 0 && h.checks?.workersAiBinding === 'present (not called)',
    JSON.stringify({ ok: h?.ok ?? null, gate: g ?? null, ceiling: h?.checks?.admission?.dailyCeiling ?? null, used: h?.checks?.durableObject?.usedToday ?? null }))) return finish();
  // P2: refused before admission; consumes nothing
  const expectRefused = async (name: string, headers: Record<string, string>, status: number, code: string) => {
    let res: Awaited<ReturnType<Http>>;
    try { res = await post(opts.payloads.T1, headers); } catch (e) { return pre(name, false, `request failed: ${(e as Error).name}`); }
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
    if (used === null || used >= CEILING) { r.skipped.push({ step, reason: `counter ${used} of ${CEILING}: the ceiling was used (by a repair)` }); save(); continue; }
    const p = opts.payloads[step];
    // Reserve every attempt this step may use, before sending.
    const possible = Math.min(2, CEILING - used);
    const slots = [p.reserve.first, p.reserve.repair].slice(0, possible);
    const need = slots.reduce((n, x) => n + x, 0);
    if (charged() + need > RUN_NEURON_CAP) { stop(step, `run cap ${RUN_NEURON_CAP}: ${round(charged())} charged + ${round(need)} reserved for ${possible} attempt(s) would pass it; not sent`); return finish(); }
    if (base.neurons + charged() + need > DAILY_NEURON_CAP) { stop(step, `daily cap ${DAILY_NEURON_CAP}: ${round(base.neurons + charged())} today + ${round(need)} reserved would pass it; not sent`); return finish(); }
    const ledger: AttemptLedger[] = slots.map((x, k) => ({ step, attempt: k + 1, reserved: x, charged: x, basis: 'reserved', promptTokens: null, completionTokens: null, overrun: false }));
    r.budget.attempts.push(...ledger);
    r.inferenceRequestsSent++;
    save();

    let res: Awaited<ReturnType<Http>>;
    try { res = await post(p, auth); } catch (e) {
      for (const a of ledger) a.basis = 'kept_unknown'; // the request may have reached the model: everything reserved stands
      r.steps.push({ step, payload: p.id, bodyBytes: Buffer.byteLength(p.body), status: null, code: 'request_failed', ms: null, attempts: null, repaired: null, claims: null, dropped: null, promptTokens: null, completionTokens: null, counterBefore: used, counterAfter: null, reservedBefore: round(need) });
      stop(step, `request failed: ${(e as Error).name}`);
      return finish();
    }
    const j = res.json as ExtractJson;
    const after = await counter();
    const u = j.meta?.usage;
    const rec: StepRecord = {
      step, payload: p.id, bodyBytes: Buffer.byteLength(p.body), status: res.status, code: j.error?.code ?? 'ok', ms: res.ms,
      attempts: j.meta?.attempts ?? null, repaired: j.meta?.repaired ?? null, claims: j.claims?.length ?? null, dropped: j.meta?.dropped ?? null,
      promptTokens: typeof u?.promptTokens === 'number' ? u.promptTokens : null, completionTokens: typeof u?.completionTokens === 'number' ? u.completionTokens : null,
      counterBefore: used, counterAfter: after, reservedBefore: round(need), rawClaims: j.claims,
    };
    r.steps.push(rec);

    // Settle. Attempts used = the counter's increase (unknown counter: everything reserved stands).
    const usedNow = after === null ? ledger.length : Math.max(0, Math.min(ledger.length, after - used));
    if (after !== null) r.budget.attempts.splice(r.budget.attempts.length - ledger.length + usedNow, ledger.length - usedNow); // release unused
    const kept = ledger.slice(0, usedNow);
    for (const a of kept) a.basis = 'kept_unknown';
    if (res.status === 200 && rec.promptTokens !== null && rec.completionTokens !== null && kept.length > 0) {
      const last = kept[kept.length - 1]!; // the Worker reports the usage of the attempt that succeeded, the last one
      const c = round(charge(rec.promptTokens, rec.completionTokens, PROFILES[p.schemaId]!.model));
      last.charged = c; // in full, not clipped to the reservation
      last.basis = 'measured';
      last.promptTokens = rec.promptTokens;
      last.completionTokens = rec.completionTokens;
      last.overrun = c > last.reserved;
    }
    save();

    if (res.status !== 200) { stop(step, `HTTP ${res.status} ${rec.code}`); return finish(); }
    if (rec.promptTokens === null || rec.completionTokens === null) { stop(step, 'token usage not reported'); return finish(); }
    if (after === null || rec.attempts === null || after !== used + rec.attempts) { stop(step, `counter ${used} -> ${after} does not match ${rec.attempts} attempt(s)`); return finish(); }
    // Validate and audit before anything else is sent. Holds, drops and misses are observations; an unsupported validated value stops.
    const obs = inspectClaims(p, j.claims ?? [], opts.audit);
    obs.droppedByWorker = j.meta?.dropped ?? 0;
    obs.droppedReasons = j.meta?.droppedReasons ?? {};
    rec.observations = obs;
    save();
    if (obs.suspect.length) { stop(step, `unsupported_value_validated: ${obs.suspect.length} validated value(s) not supported by their own evidence: ${obs.suspect.slice(0, 3).map((s) => `${s.field}=${JSON.stringify(s.value)}`).join('; ')}`); return finish(); }
    if (res.ms >= TIMEOUT_MS) { stop(step, `latency ${res.ms} ms at or above the ${TIMEOUT_MS} ms timeout`); return finish(); }
    if (charged() >= RUN_NEURON_CAP || base.neurons + charged() >= DAILY_NEURON_CAP) { stop(step, `neuron cap reached after settlement (${round(charged())} run, ${round(base.neurons + charged())} today)`); return finish(); }
    used = after;
  }

  // R: refusal at the ceiling (only when it is certainly reached, and on the same UTC day)
  if (used !== CEILING) { stop('R', `counter ${used}, not ${CEILING}: refusal not tested`); return finish(); }
  if (utcDay(now()) !== utcDay(start)) { stop('R', 'UTC day changed: the counter has reset, so a request could be admitted; refusal not sent'); return finish(); }
  let res: Awaited<ReturnType<Http>>;
  try { res = await post(opts.payloads.T4, auth); } catch (e) { stop('R', `request failed: ${(e as Error).name}`); return finish(); }
  const after = await counter();
  const code = (res.json as ExtractJson).error?.code ?? 'ok';
  r.refusal = { step: 'R', payload: opts.payloads.T4.id, bodyBytes: Buffer.byteLength(opts.payloads.T4.body), status: res.status, code, ms: res.ms, attempts: null, repaired: null, claims: null, dropped: null, promptTokens: null, completionTokens: null, counterBefore: used, counterAfter: after };
  if (res.status !== 429 || code !== 'daily_limit' || after !== CEILING) {
    // An unexpected admission consumed an unknown amount: reserve its worst case, so the ledger never under-counts.
    if (res.status === 200 || (after ?? CEILING) > CEILING) r.budget.attempts.push({ step: 'R', attempt: 1, reserved: opts.payloads.T4.reserve.first, charged: opts.payloads.T4.reserve.first, basis: 'kept_unknown', promptTokens: null, completionTokens: null, overrun: false });
    stop('R', `expected 429 daily_limit with counter ${CEILING}; got ${res.status} ${code}, counter ${after}`);
    return finish();
  }
  r.verdict = 'pass';
  return finish();
}

if (process.argv[1]?.endsWith('gate-test.ts')) {
  const baseUrl = (process.env.GATE_URL ?? '').replace(/\/$/, '');
  if (!/^https:\/\/skeleton-key-extraction-gate\.[a-z0-9-]+\.workers\.dev$/.test(baseUrl)) {
    console.error('GATE_URL must be the staging gate Worker (https://skeleton-key-extraction-gate.<subdomain>.workers.dev), never the production Worker');
    process.exit(2);
  }
  const http: Http = async (path, init) => {
    const t = performance.now();
    const res = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS + 10_000) });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, ms: Math.round(performance.now() - t) };
  };
  const day = utcDay(Date.now());
  const baseline = dailyBaseline(day);
  mkdirSync(dirname(LEDGER_FILE), { recursive: true });
  const persist = (r: GateTestResult) => {
    writeFileSync(RESULT_FILE, JSON.stringify({ gateUrl: baseUrl, ...r }, null, 2) + '\n');
    writeFileSync(LEDGER_FILE, JSON.stringify({ day, neuronsEstimated: r.budget.dailyAfter, note: 'cumulative daily CHARGE (measured estimates, plus conservative reservations where usage was unknown); not dashboard-confirmed' }));
  };
  const result = await runGateTest({ http, token: readSecret(), payloads: await buildPayloads(), persist, dailyBaseline: baseline });
  console.log(JSON.stringify({ verdict: result.verdict, stop: result.stop, inferenceRequestsSent: result.inferenceRequestsSent, counterEnd: result.counterEnd, runCharged: result.budget.runCharged, dailyAfter: result.budget.dailyAfter, overruns: result.budget.overruns, file: RESULT_FILE }, null, 2));
}
