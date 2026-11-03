import type { BudgetDay, ReserveRequest, ReserveResult } from './admission';
import { parseConfig, type EnvVars } from './config';
import { gateConfig } from './gate';

// GET /health: a deployment check of the bindings that makes NO inference call and admits nothing.
//  - configuration: the variables parse to a valid configuration
//  - Workers AI binding: present and callable in shape. It is NOT called: this proves the binding is wired, not that inference works.
//  - Durable Object: a read of today's ledger, and a fail-closed reservation at ceiling 0 and budget 0. reserve() never writes
//    when it refuses, so this exercises the deployed ledger's admission path with zero consumption.
//  - whether public admission is open (DAILY_ADMISSION_CEILING > 0)
//  - the access gate: its mode and whether it is valid (never the secret, only whether one is bound)
// The response carries no document content, no secrets and no account identifiers.

export type HealthDeps = {
  now(): number;
  ai: unknown;
  counter: { reserve(req: ReserveRequest, nowMs: number): Promise<ReserveResult>; usedToday(nowMs: number): Promise<number>; budgetToday(nowMs: number): Promise<BudgetDay> };
};

export async function health(env: EnvVars, deps: HealthDeps): Promise<Response> {
  const cfg = parseConfig(env);
  const aiBound = typeof (deps.ai as { run?: unknown } | undefined)?.run === 'function';
  let durableObject: { reachable: boolean; usedToday: number | null; zeroCeilingRefused: boolean | null; unchangedAfterCheck: boolean | null; budgetToday?: BudgetDay; error?: string };
  try {
    const now = deps.now();
    const before = await deps.counter.budgetToday(now);
    const probe = await deps.counter.reserve({ ceiling: 0, budget: 0, neurons: 1 }, now); // must be refused, and must not write
    const after = await deps.counter.budgetToday(now);
    const usedToday = await deps.counter.usedToday(now);
    durableObject = { reachable: true, usedToday, zeroCeilingRefused: probe.ok === false, unchangedAfterCheck: after.attempts === before.attempts && after.charged === before.charged, budgetToday: before };
  } catch {
    durableObject = { reachable: false, usedToday: null, zeroCeilingRefused: null, unchangedAfterCheck: null, error: 'admission counter unreachable' };
  }
  const ceiling = cfg?.dailyCeiling ?? null;
  const gate = gateConfig(env);
  const ok = !!cfg && gate.ok && aiBound && durableObject.reachable && durableObject.zeroCeilingRefused === true && durableObject.unchangedAfterCheck === true;
  const body = {
    ok,
    checks: {
      configuration: cfg ? 'valid' : 'invalid',
      workersAiBinding: aiBound ? 'present (not called)' : 'missing',
      durableObject,
      admission: { dailyCeiling: ceiling, dailyNeuronBudget: cfg?.dailyNeuronBudget ?? null, open: (ceiling ?? 0) > 0 && (cfg?.dailyNeuronBudget ?? 0) > 0 },
      accessGate: { mode: gate.mode, valid: gate.ok, credentialBound: typeof env.TEST_GATE_TOKEN === 'string' && env.TEST_GATE_TOKEN.length > 0, ...(gate.ok ? {} : { reason: gate.reason }) },
    },
    inference: 'not called by this check',
  };
  return new Response(JSON.stringify(body), { status: ok ? 200 : 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
