// Access gate, selected EXPLICITLY by ACCESS_GATE. It is never inferred from whether a secret happens to be bound:
//   ACCESS_GATE = "public": no token (the public Worker; admission is governed by DAILY_ADMISSION_CEILING alone).
//                           A bound TEST_GATE_TOKEN here is a misconfiguration and closes the service.
//   ACCESS_GATE = "token":  every /extract request needs `Authorization: Bearer <TEST_GATE_TOKEN>`. If the secret is
//                           missing or too short the service is closed (not_configured): authentication cannot disappear
//                           because the secret was not bound.
//   missing / anything else: closed (not_configured).
// The check runs before the origin check, body reading, admission and any model call. The token is compared through
// SHA-256 digests in constant time, and is never logged or echoed.

export type GateEnv = { ACCESS_GATE?: string; TEST_GATE_TOKEN?: string };
export type GateConfig = { ok: true; mode: 'public' } | { ok: true; mode: 'token'; token: string } | { ok: false; mode: string | null; reason: 'gate_mode_invalid' | 'credential_missing' | 'credential_in_public_mode' };
export type GateResult = 'pass' | 'unauthorized' | 'not_configured';

export const MIN_GATE_TOKEN_LENGTH = 32;

export function gateConfig(env: GateEnv): GateConfig {
  const mode = env.ACCESS_GATE ?? null;
  const secret = typeof env.TEST_GATE_TOKEN === 'string' ? env.TEST_GATE_TOKEN : '';
  if (mode === 'public') return secret ? { ok: false, mode, reason: 'credential_in_public_mode' } : { ok: true, mode };
  if (mode === 'token') return secret.length >= MIN_GATE_TOKEN_LENGTH ? { ok: true, mode, token: secret } : { ok: false, mode, reason: 'credential_missing' };
  return { ok: false, mode, reason: 'gate_mode_invalid' };
}

async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** Constant-time comparison of two equal-length byte arrays (both are SHA-256 digests here). */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function checkGate(env: GateEnv, request: Request): Promise<GateResult> {
  const cfg = gateConfig(env);
  if (!cfg.ok) return 'not_configured';
  if (cfg.mode === 'public') return 'pass';
  const header = request.headers.get('authorization') ?? '';
  const m = /^Bearer ([^\s]+)$/.exec(header);
  // Digest even when the header is absent, so the work done does not depend on what was sent.
  const [given, expected] = await Promise.all([digest(m?.[1] ?? ''), digest(cfg.token)]);
  return m && equalBytes(given, expected) ? 'pass' : 'unauthorized';
}
