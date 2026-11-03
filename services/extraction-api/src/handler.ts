import { z } from 'zod';
import type { CloseRunResult, OpenRunRequest, OpenRunResult, ReserveRequest, ReserveResult, RunAttempt, RunChunk, SettleResult } from './admission';
import { secondsUntilUtcMidnight } from './admission';
import { parseConfig, parseOrigins, type EnvVars } from './config';
import { ERRORS, type ErrorCode } from './errors';
import { reservation, settlementCharge } from './cost';
import { checkGate } from './gate';
import { classifyUpstream, withTimeout } from './inference';
import { buildMessages, getProfile, parseModelOutput, responseFormat } from './profiles';
import { parseExtractRequest, readBounded } from './request';
import { MAX_PLAN_CHUNKS, plannedNeurons } from './run-plan';

/** How long an admitted run may take, and how many may be open at once. A run holds budget until it closes. */
export const RUN_TTL_MS = 20 * 60_000;
export const MAX_OPEN_RUNS = 3;

export type RunCounter = {
  openRun(req: OpenRunRequest, nowMs: number): Promise<OpenRunResult>;
  runChunk(id: number, token: string, chunk: number, nowMs: number): Promise<RunChunk>;
  reserveInRun(id: number, token: string, chunk: number, neurons: number, nowMs: number): Promise<RunAttempt>;
  settleInRun(attemptId: number, charged: number | null): Promise<SettleResult>;
  closeRun(id: number, token: string, nowMs: number): Promise<CloseRunResult>;
};

const RunBody = z.object({ plan: z.array(z.object({ schemaId: z.string().min(1).max(64), bodyBytes: z.number().int().min(1), values: z.number().int().min(0).max(1000) }).strict()).min(1).max(MAX_PLAN_CHUNKS) }).strict();
const CloseBody = z.object({ runId: z.number().int().min(1), token: z.string().min(16).max(64) }).strict();

export interface Deps {
  now(): number;
  /**
   * Strict global admission ledger (Durable Object): attempt ceiling and neuron budget, reserved before every attempt and settled
   * after it. A reservation failure must never be bypassed; a settlement failure leaves the reservation standing (conservative).
   */
  counter: { reserve(req: ReserveRequest, nowMs: number): Promise<ReserveResult>; settle(id: number, charged: number | null): Promise<SettleResult> } & Partial<RunCounter>;
  ai: { run(model: string, input: unknown): Promise<unknown> };
  /** Optional per-client limiter; the strict global ceiling does not depend on it. */
  clientLimiter?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** Content-free log sink: status, code and counts only. */
  log(entry: Record<string, string | number | boolean | null>): void;
}

const json = (status: number, body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

export async function handle(request: Request, env: EnvVars, deps: Deps): Promise<Response> {
  const started = deps.now();
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const allowed = origin !== null && parseOrigins(env).includes(origin);
  const cors: Record<string, string> = allowed ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
  const stats = { blocks: 0, chars: 0, attempts: 0 };

  const fail = (code: ErrorCode, extra: Record<string, string> = {}): Response => {
    const e = ERRORS[code];
    deps.log({ evt: 'extract', status: e.status, code, blocks: stats.blocks, chars: stats.chars, attempts: stats.attempts, ms: deps.now() - started });
    return json(e.status, { error: { code, message: e.message, retryable: e.retryable } }, { ...cors, ...extra });
  };

  const runs = deps.counter as Partial<RunCounter>;

  // POST /run: the whole run's plan (schema, request size, expected values per chunk; no text) is priced at its worst case and held
  // in one step, or refused up front with the numbers. Nothing is sent to the model here.
  const openRunRoute = async (text: string): Promise<Response> => {
    const cfg = parseConfig(env);
    if (!cfg || !runs.openRun) return fail('not_configured');
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return fail('invalid_input'); }
    const p = RunBody.safeParse(raw);
    if (!p.success) return fail('invalid_input');
    const chunks: { neurons: number; cap: number }[] = [];
    for (const c of p.data.plan) {
      const profile = getProfile(c.schemaId);
      if (!profile) return fail('invalid_input');
      if (c.bodyBytes > cfg.maxBodyBytes) return fail('too_large');
      const w = plannedNeurons(profile, c);
      if (w === null) return fail('not_configured');
      chunks.push(w);
    }
    stats.blocks = chunks.length;
    if (cfg.dailyCeiling === 0 || cfg.dailyNeuronBudget === 0) return fail('daily_limit', { 'retry-after': String(secondsUntilUtcMidnight(deps.now())) });
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    let r: OpenRunResult;
    try {
      r = await runs.openRun({ ceiling: cfg.dailyCeiling, budget: cfg.dailyNeuronBudget, token, chunks, ttlMs: RUN_TTL_MS, maxOpen: MAX_OPEN_RUNS }, deps.now());
    } catch {
      return fail('limiter_unavailable');
    }
    if (!r.ok) {
      deps.log({ evt: 'run', refused: r.reason, chunks: chunks.length, need: r.need, remaining: r.remaining });
      if (r.reason === 'neurons') {
        const e = ERRORS.run_exceeds_allowance;
        deps.log({ evt: 'run', status: e.status, code: 'run_exceeds_allowance' });
        return json(e.status, { error: { code: 'run_exceeds_allowance', message: e.message, retryable: e.retryable, need: r.need, remaining: r.remaining, budget: cfg.dailyNeuronBudget } }, { ...cors, 'retry-after': String(secondsUntilUtcMidnight(deps.now())) });
      }
      if (r.reason === 'busy') return fail('run_busy', { 'retry-after': '120' });
      return fail('daily_limit', { 'retry-after': String(secondsUntilUtcMidnight(deps.now())) });
    }
    deps.log({ evt: 'run', status: 200, code: 'held', chunks: chunks.length, hold: r.hold, remaining: r.remaining });
    return json(200, { runId: r.id, token, holdNeurons: r.hold, attempts: r.attempts, expiresInSeconds: Math.floor(RUN_TTL_MS / 1000), budget: cfg.dailyNeuronBudget, remaining: r.remaining }, cors);
  };

  const closeRunRoute = async (text: string): Promise<Response> => {
    if (!runs.closeRun) return fail('not_configured');
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return fail('invalid_input'); }
    const p = CloseBody.safeParse(raw);
    if (!p.success) return fail('invalid_input');
    try {
      const r = await runs.closeRun(p.data.runId, p.data.token, deps.now());
      return json(200, { closed: r.closed, charged: r.charged }, cors);
    } catch {
      return fail('limiter_unavailable');
    }
  };

  try {
    const route = url.pathname;
    if (route !== '/extract' && route !== '/run' && route !== '/run/close') return fail('not_found');
    // Explicit access gate (gate.ts): before the origin check, the body, admission and the model. Fails closed.
    const gate = await checkGate(env, request);
    if (gate !== 'pass') return fail(gate);
    // Origin allowlist: an additional control, not authentication.
    if (!allowed) return fail('origin_denied');

    if (request.method === 'OPTIONS') {
      // Preflight never touches the counter or the model.
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' },
      });
    }
    if (request.method !== 'POST') return fail('method_not_allowed', { allow: 'POST, OPTIONS' });

    const cfg = parseConfig(env);
    if (!cfg) return fail('not_configured');

    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail('invalid_input');

    if (route === '/run' || route === '/run/close') {
      const small = await readBounded(request, Math.min(cfg.maxBodyBytes, 16_384));
      if (!small.ok) return fail(small.reason);
      return route === '/run' ? await openRunRoute(small.text) : await closeRunRoute(small.text);
    }

    const body = await readBounded(request, cfg.maxBodyBytes);
    if (!body.ok) return fail(body.reason);
    const parsed = parseExtractRequest(body.text, cfg);
    if (!parsed.ok) return fail(parsed.reason);
    const { schemaId, blocks } = parsed.value;
    stats.blocks = blocks.length;
    stats.chars = blocks.reduce((n, b) => n + b.text.length, 0);

    const profile = getProfile(schemaId);
    if (!profile) return fail('invalid_input');

    if (deps.clientLimiter) {
      const key = request.headers.get('cf-connecting-ip') ?? 'unknown';
      let ok = true;
      try {
        ok = (await deps.clientLimiter.limit({ key })).success;
      } catch {
        ok = true; // optional control: its failure must not decide the strict global ceiling either way
      }
      if (!ok) return fail('rate_limited', { 'retry-after': '60' });
    }

    // A request that belongs to a run admitted as a whole: ONE attempt, at the output cap that was planned and held. It is never
    // refused for budget (the hold already covers it); it is refused only if the run is gone or the request is larger than planned.
    if (parsed.value.run) {
      const ref = parsed.value.run;
      if (!runs.runChunk || !runs.reserveInRun || !runs.settleInRun) return fail('not_configured');
      let planned: RunChunk;
      try {
        planned = await runs.runChunk(ref.id, ref.token, ref.chunk, deps.now());
      } catch {
        return fail('limiter_unavailable');
      }
      if (!planned.ok) return fail(planned.reason === 'chunk_used' ? 'invalid_input' : 'run_expired');
      const runMessages = buildMessages(profile, blocks, false);
      const runNeurons = reservation(profile.model, runMessages, planned.cap);
      if (runNeurons === null) return fail('not_configured');
      let taken: RunAttempt;
      try {
        taken = await runs.reserveInRun(ref.id, ref.token, ref.chunk, runNeurons, deps.now());
      } catch {
        return fail('limiter_unavailable');
      }
      if (!taken.ok) return fail(taken.reason === 'over_plan' || taken.reason === 'chunk_used' ? 'invalid_input' : 'run_expired');
      stats.attempts = 1;
      const settleRun = async (charged: number | null): Promise<boolean> => {
        for (let tries = 1; tries <= 2; tries++) {
          try {
            const r = await runs.settleInRun!(taken.id, charged);
            if (!r.settled && r.reserved <= 0) continue;
            deps.log({ evt: 'settle', run: true, reserved: r.reserved, charged: r.charged, measured: charged !== null, overrun: r.overrun });
            return true;
          } catch {
            /* retry once */
          }
        }
        deps.log({ evt: 'settle', run: true, reserved: runNeurons, charged: null, measured: false, overrun: charged !== null && charged > runNeurons, error: 'ledger_unavailable' });
        return false;
      };
      let rawRun: unknown;
      try {
        rawRun = await withTimeout(deps.ai.run(profile.model, { messages: runMessages, response_format: responseFormat(profile), max_tokens: planned.cap }), cfg.timeoutMs);
      } catch (err) {
        const recorded = await settleRun(null);
        return recorded ? fail(classifyUpstream(err)) : fail('limiter_unavailable');
      }
      const ru = (rawRun as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null)?.usage;
      if (!(await settleRun(settlementCharge(profile.model, ru)))) return fail('limiter_unavailable');
      const outRun = parseModelOutput(profile, new Set(blocks.map((b) => b.id)), (rawRun as { response?: unknown } | null)?.response ?? rawRun);
      if (!outRun.ok) return fail('schema_invalid'); // no automatic repair inside a run: the part is reported as not processed
      const usageRun = { promptTokens: typeof ru?.prompt_tokens === 'number' ? ru.prompt_tokens : null, completionTokens: typeof ru?.completion_tokens === 'number' ? ru.completion_tokens : null };
      deps.log({ evt: 'extract', status: 200, code: 'ok', blocks: stats.blocks, chars: stats.chars, attempts: 1, run: true, ms: deps.now() - started });
      return json(200, { claims: outRun.claims, meta: { attempts: 1, repaired: false, dropped: outRun.dropped, droppedReasons: outRun.droppedReasons, usage: usageRun } }, cors);
    }

    const blockIds = new Set(blocks.map((b) => b.id));
    for (let attempt = 1; attempt <= 1 + cfg.maxRepairAttempts; attempt++) {
      const messages = buildMessages(profile, blocks, attempt > 1);
      const neurons = reservation(profile.model, messages, profile.maxOutputTokens);
      if (neurons === null) return fail('not_configured'); // no rate for this model: never call it unbudgeted
      // Every inference attempt, repairs included, is reserved (attempt + worst-case neurons) before the model is called.
      let admission: ReserveResult;
      try {
        admission = await deps.counter.reserve({ ceiling: cfg.dailyCeiling, budget: cfg.dailyNeuronBudget, neurons }, deps.now());
      } catch {
        return fail('limiter_unavailable'); // fail closed
      }
      if (!admission.ok) {
        deps.log({ evt: 'admission', refused: admission.reason, used: admission.used, charged: admission.charged });
        return fail('daily_limit', { 'retry-after': String(secondsUntilUtcMidnight(deps.now())) });
      }
      const reservationId = admission.id;
      stats.attempts = attempt;
      // Settlement: the full estimate from reported tokens (an overrun is logged, never clipped), or null (the reservation stands).
      // Returns false when the ledger could not record it (after one retry; settle is once-only, so a retry cannot double-charge).
      // The caller then STOPS the request: no repair, no further attempt, no claims returned. A known overrun that could not be
      // recorded must not leave the smaller reservation standing while the request carries on; it is logged with the estimate.
      const settleWith = async (charged: number | null): Promise<boolean> => {
        for (let tries = 1; tries <= 2; tries++) {
          try {
            const r = await deps.counter.settle(reservationId, charged);
            if (!r.settled && r.reserved <= 0) continue; // the ledger has no such reservation: not recorded
            deps.log({ evt: 'settle', attempt, reserved: r.reserved, charged: r.charged, measured: charged !== null, overrun: r.overrun });
            return true;
          } catch {
            /* retry once */
          }
        }
        deps.log({ evt: 'settle', attempt, reserved: neurons, charged: null, measured: false, overrun: charged !== null && charged > neurons, knownOverrun: charged !== null && charged > neurons, estimate: charged, error: 'ledger_unavailable' });
        return false;
      };

      let raw: unknown;
      try {
        raw = await withTimeout(
          deps.ai.run(profile.model, {
            messages,
            response_format: responseFormat(profile),
            max_tokens: profile.maxOutputTokens,
          }),
          cfg.timeoutMs,
        );
      } catch (err) {
        const recorded = await settleWith(null); // consumption unknown: the reservation stands (and is not refunded)
        return recorded ? fail(classifyUpstream(err)) : fail('limiter_unavailable');
      }
      const u = (raw as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null)?.usage;
      if (!(await settleWith(settlementCharge(profile.model, u)))) return fail('limiter_unavailable'); // ledger not updated: stop before any repair

      const payload = (raw as { response?: unknown } | null)?.response ?? raw;
      const out = parseModelOutput(profile, blockIds, payload);
      if (out.ok) {
        const usage = {
          promptTokens: typeof u?.prompt_tokens === 'number' ? u.prompt_tokens : null,
          completionTokens: typeof u?.completion_tokens === 'number' ? u.completion_tokens : null,
        };
        deps.log({ evt: 'extract', status: 200, code: 'ok', blocks: stats.blocks, chars: stats.chars, attempts: attempt, ms: deps.now() - started });
        return json(200, { claims: out.claims, meta: { attempts: attempt, repaired: attempt > 1, dropped: out.dropped, droppedReasons: out.droppedReasons, usage } }, cors);
      }
    }
    return fail('schema_invalid');
  } catch {
    return fail('internal_error');
  }
}
