// Admission counter logic for the SQLite-backed Durable Object. Plain functions over a
// minimal SQL interface so the same code runs in the DO and can be reasoned about alone.
// Stores only a UTC day and an integer count: no document text, filenames or client data.

export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] };
}

export type AdmitResult = { ok: boolean; used: number; ceiling: number };

export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function initSchema(sql: SqlLike): void {
  sql.exec('CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, admitted INTEGER NOT NULL)');
}

/** Seconds until the next 00:00 UTC, for Retry-After. */
export function secondsUntilUtcMidnight(ms: number): number {
  const d = new Date(ms);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - ms) / 1000));
}

/**
 * Admit one inference attempt if today's (UTC) count is below the ceiling.
 * Must run inside a synchronous transaction. There is deliberately no refund:
 * an attempt that errors or times out may still have consumed inference.
 */
export function admit(sql: SqlLike, ceiling: number, nowMs: number): AdmitResult {
  if (!Number.isFinite(nowMs) || !Number.isInteger(ceiling) || ceiling < 0) throw new Error('invalid admission arguments');
  const day = utcDay(nowMs);
  const rows = sql.exec('SELECT admitted FROM usage WHERE day = ?', day).toArray() as { admitted: number }[];
  const used = rows[0]?.admitted ?? 0;
  if (used >= ceiling) return { ok: false, used, ceiling };
  sql.exec('INSERT INTO usage (day, admitted) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET admitted = excluded.admitted', day, used + 1);
  sql.exec('DELETE FROM usage WHERE day < ?', utcDay(nowMs - 7 * 86_400_000));
  return { ok: true, used: used + 1, ceiling };
}

/** Today's admitted count, read only (no row is written). */
export function usedOn(sql: SqlLike, nowMs: number): number {
  const rows = sql.exec('SELECT admitted FROM usage WHERE day = ?', utcDay(nowMs)).toArray() as { admitted: number }[];
  return rows[0]?.admitted ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Neuron reservations and settlement (task 5.5). One row per admitted attempt, per UTC day:
//   reserved  the worst case computed by the Worker before the call (cost.ts)
//   charged   what counts against the day's budget: the reservation until settled; then the full estimate from the tokens the
//             model reported (NOT clipped to the reservation), or the reservation again when usage is unknown
//   state     'reserved' (call outstanding, or the Worker died before settling: it stands), 'measured', 'kept' (usage unknown)
// Admission needs BOTH: attempts below the attempt ceiling, and (sum of charged today) + this reservation <= the neuron budget.
// Rows hold no document text, no client data: day, three numbers, a state.

export type ReserveRequest = { ceiling: number; budget: number; neurons: number };
export type ReserveResult =
  | { ok: true; id: number; used: number; charged: number }
  | { ok: false; reason: 'attempts' | 'neurons'; used: number; charged: number };
export type SettleResult = { settled: boolean; charged: number; reserved: number; overrun: boolean };
export type BudgetDay = { attempts: number; charged: number; unsettled: number; overruns: number };

export function initLedger(sql: SqlLike): void {
  initSchema(sql);
  sql.exec(
    'CREATE TABLE IF NOT EXISTS reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, reserved REAL NOT NULL, charged REAL NOT NULL, state TEXT NOT NULL, overrun INTEGER NOT NULL DEFAULT 0)',
  );
  sql.exec('CREATE INDEX IF NOT EXISTS reservations_day ON reservations (day)');
}

const chargedOn = (sql: SqlLike, day: string): number =>
  Number((sql.exec('SELECT COALESCE(SUM(charged), 0) AS c FROM reservations WHERE day = ?', day).toArray()[0] as { c: number } | undefined)?.c ?? 0);

/**
 * Reserve one attempt. Must run inside a synchronous transaction (the Durable Object runs one at a time, so concurrent callers
 * cannot both take the same headroom). Never writes when refused.
 */
export function reserve(sql: SqlLike, req: ReserveRequest, nowMs: number): ReserveResult {
  const { ceiling, budget, neurons } = req;
  if (!Number.isFinite(nowMs) || !Number.isInteger(ceiling) || ceiling < 0 || !Number.isFinite(budget) || budget < 0 || !Number.isFinite(neurons) || neurons <= 0) throw new Error('invalid reservation arguments');
  const day = utcDay(nowMs);
  const used = (sql.exec('SELECT admitted FROM usage WHERE day = ?', day).toArray()[0] as { admitted: number } | undefined)?.admitted ?? 0;
  const charged = chargedOn(sql, day);
  if (used >= ceiling) return { ok: false, reason: 'attempts', used, charged };
  if (charged + neurons > budget) return { ok: false, reason: 'neurons', used, charged };
  sql.exec('INSERT INTO usage (day, admitted) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET admitted = excluded.admitted', day, used + 1);
  sql.exec("INSERT INTO reservations (day, reserved, charged, state) VALUES (?, ?, ?, 'reserved')", day, neurons, neurons);
  const id = Number((sql.exec('SELECT last_insert_rowid() AS id').toArray()[0] as { id: number }).id);
  const old = utcDay(nowMs - 7 * 86_400_000);
  sql.exec('DELETE FROM usage WHERE day < ?', old);
  sql.exec('DELETE FROM reservations WHERE day < ?', old);
  return { ok: true, id, used: used + 1, charged: charged + neurons };
}

/**
 * Settle a reservation once. `charged` is the estimate from the reported tokens, or null when usage is unknown (the call failed,
 * timed out, or reported nothing): then the reservation stands. A measured charge above the reservation is kept in full and
 * flagged as an overrun; it counts against the day, so later reservations are refused sooner. A second settle changes nothing.
 */
export function settle(sql: SqlLike, id: number, charged: number | null): SettleResult {
  const row = sql.exec('SELECT reserved, charged, state FROM reservations WHERE id = ?', id).toArray()[0] as { reserved: number; charged: number; state: string } | undefined;
  if (!row) return { settled: false, charged: 0, reserved: 0, overrun: false };
  if (row.state !== 'reserved') return { settled: false, charged: row.charged, reserved: row.reserved, overrun: row.charged > row.reserved };
  if (charged === null || !Number.isFinite(charged) || charged < 0) {
    sql.exec("UPDATE reservations SET state = 'kept' WHERE id = ?", id);
    return { settled: true, charged: row.reserved, reserved: row.reserved, overrun: false };
  }
  const overrun = charged > row.reserved;
  sql.exec("UPDATE reservations SET charged = ?, state = 'measured', overrun = ? WHERE id = ?", charged, overrun ? 1 : 0, id);
  return { settled: true, charged, reserved: row.reserved, overrun };
}

/** Today's ledger, read only. */
export function budgetOn(sql: SqlLike, nowMs: number): BudgetDay {
  const day = utcDay(nowMs);
  const r = sql.exec("SELECT COUNT(*) AS n, COALESCE(SUM(charged), 0) AS c, COALESCE(SUM(CASE WHEN state = 'reserved' THEN 1 ELSE 0 END), 0) AS u, COALESCE(SUM(overrun), 0) AS o FROM reservations WHERE day = ?", day).toArray()[0] as { n: number; c: number; u: number; o: number };
  return { attempts: usedOn(sql, nowMs), charged: Number(r.c), unsettled: Number(r.u), overruns: Number(r.o) };
}
