import type { AdmitResult } from './admission';
import { parseConfig, type EnvVars } from './config';

// GET /health: a deployment check of the bindings that makes NO inference call and admits nothing.
//  - configuration: the variables parse to a valid configuration
//  - Workers AI binding: present and callable in shape. It is NOT called: this proves the binding is wired, not that inference works.
//  - Durable Object: a read of today's count, and a fail-closed admission at ceiling 0. admit() never writes when the ceiling is
//    reached, so this exercises the deployed counter's admission path with zero consumption.
//  - whether public admission is open (DAILY_ADMISSION_CEILING > 0)
// The response carries no document content, no secrets and no account identifiers.

export type HealthDeps = {
  now(): number;
  ai: unknown;
  counter: { admit(ceiling: number, nowMs: number): Promise<AdmitResult>; usedToday(nowMs: number): Promise<number> };
};

export async function health(env: EnvVars, deps: HealthDeps): Promise<Response> {
  const cfg = parseConfig(env);
  const aiBound = typeof (deps.ai as { run?: unknown } | undefined)?.run === 'function';
  let durableObject: { reachable: boolean; usedToday: number | null; zeroCeilingRefused: boolean | null; unchangedAfterCheck: boolean | null; error?: string };
  try {
    const now = deps.now();
    const before = await deps.counter.usedToday(now);
    const probe = await deps.counter.admit(0, now); // ceiling 0: must be refused, and must not write
    const after = await deps.counter.usedToday(now);
    durableObject = { reachable: true, usedToday: before, zeroCeilingRefused: probe.ok === false, unchangedAfterCheck: after === before };
  } catch {
    durableObject = { reachable: false, usedToday: null, zeroCeilingRefused: null, unchangedAfterCheck: null, error: 'admission counter unreachable' };
  }
  const ceiling = cfg?.dailyCeiling ?? null;
  const ok = !!cfg && aiBound && durableObject.reachable && durableObject.zeroCeilingRefused === true && durableObject.unchangedAfterCheck === true;
  const body = {
    ok,
    checks: {
      configuration: cfg ? 'valid' : 'invalid',
      workersAiBinding: aiBound ? 'present (not called)' : 'missing',
      durableObject,
      admission: { dailyCeiling: ceiling, open: (ceiling ?? 0) > 0 },
    },
    inference: 'not called by this check',
  };
  return new Response(JSON.stringify(body), { status: ok ? 200 : 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
