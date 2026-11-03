import type { ReserveRequest, ReserveResult, SettleResult } from './admission';
import { secondsUntilUtcMidnight } from './admission';
import { parseConfig, parseOrigins, type EnvVars } from './config';
import { ERRORS, type ErrorCode } from './errors';
import { reservation, settlementCharge } from './cost';
import { checkGate } from './gate';
import { classifyUpstream, withTimeout } from './inference';
import { buildMessages, getProfile, parseModelOutput, responseFormat } from './profiles';
import { parseExtractRequest, readBounded } from './request';

export interface Deps {
  now(): number;
  /**
   * Strict global admission ledger (Durable Object): attempt ceiling and neuron budget, reserved before every attempt and settled
   * after it. A reservation failure must never be bypassed; a settlement failure leaves the reservation standing (conservative).
   */
  counter: { reserve(req: ReserveRequest, nowMs: number): Promise<ReserveResult>; settle(id: number, charged: number | null): Promise<SettleResult> };
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

  try {
    if (url.pathname !== '/extract') return fail('not_found');
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
