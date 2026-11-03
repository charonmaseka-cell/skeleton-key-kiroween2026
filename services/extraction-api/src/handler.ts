import type { AdmitResult } from './admission';
import { secondsUntilUtcMidnight } from './admission';
import { parseConfig, parseOrigins, type EnvVars } from './config';
import { ERRORS, type ErrorCode } from './errors';
import { checkGate } from './gate';
import { classifyUpstream, withTimeout } from './inference';
import { buildMessages, getProfile, parseModelOutput, responseFormat } from './profiles';
import { parseExtractRequest, readBounded } from './request';

export interface Deps {
  now(): number;
  /** Strict global admission counter (Durable Object). Failure must never be bypassed. */
  counter: { admit(ceiling: number, nowMs: number): Promise<AdmitResult> };
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
      // Every inference attempt, repairs included, is admitted before the model is called.
      let admission: AdmitResult;
      try {
        admission = await deps.counter.admit(cfg.dailyCeiling, deps.now());
      } catch {
        return fail('limiter_unavailable'); // fail closed
      }
      if (!admission.ok) return fail('daily_limit', { 'retry-after': String(secondsUntilUtcMidnight(deps.now())) });
      stats.attempts = attempt;

      let raw: unknown;
      try {
        raw = await withTimeout(
          deps.ai.run(profile.model, {
            messages: buildMessages(profile, blocks, attempt > 1),
            response_format: responseFormat(profile),
            max_tokens: profile.maxOutputTokens,
          }),
          cfg.timeoutMs,
        );
      } catch (err) {
        return fail(classifyUpstream(err)); // allowance is not refunded
      }

      const payload = (raw as { response?: unknown } | null)?.response ?? raw;
      const out = parseModelOutput(profile, blockIds, payload);
      if (out.ok) {
        const u = (raw as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null)?.usage;
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
