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
// Admission needs ALL of: attempts below the attempt ceiling; (sum of charged today) + this reservation <= the neuron budget; and
// NO recorded overrun today. An overrun means the cost bound (cost.ts A1 to A4) was wrong for a real call, so the day's total can
// no longer be trusted: the day is locked against every further admission, repairs included, even when nominal budget remains.
// The lock is per UTC day and ends at 00:00 UTC with the day's rows.
// Rows hold no document text, no client data: day, three numbers, a state.

export type ReserveRequest = { ceiling: number; budget: number; neurons: number };
export type ReserveResult =
  | { ok: true; id: number; used: number; charged: number }
  | { ok: false; reason: 'attempts' | 'neurons' | 'overrun'; used: number; charged: number };
export type SettleResult = { settled: boolean; charged: number; reserved: number; overrun: boolean };
export type BudgetDay = { attempts: number; charged: number; unsettled: number; overruns: number };

export function initLedger(sql: SqlLike): void {
  initSchema(sql);
  initRuns(sql);
  sql.exec(
    'CREATE TABLE IF NOT EXISTS reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, reserved REAL NOT NULL, charged REAL NOT NULL, state TEXT NOT NULL, overrun INTEGER NOT NULL DEFAULT 0)',
  );
  sql.exec('CREATE INDEX IF NOT EXISTS reservations_day ON reservations (day)');
}

const overrunsOn = (sql: SqlLike, day: string): number =>
  Number((sql.exec('SELECT COALESCE(SUM(overrun), 0) AS o FROM reservations WHERE day = ?', day).toArray()[0] as { o: number } | undefined)?.o ?? 0) +
  Number((sql.exec('SELECT COALESCE(SUM(a.overrun), 0) AS o FROM run_attempts a JOIN runs r ON r.id = a.run_id WHERE r.day = ?', day).toArray()[0] as { o: number } | undefined)?.o ?? 0);

/**
 * What the day has been charged: single attempts (reservations) plus runs. An OPEN run counts its whole hold (or what its attempts
 * have actually been charged, if that is ever more); a closed run counts only what its attempts were charged.
 */
const chargedOn = (sql: SqlLike, day: string): number => {
  const single = Number((sql.exec('SELECT COALESCE(SUM(charged), 0) AS c FROM reservations WHERE day = ?', day).toArray()[0] as { c: number } | undefined)?.c ?? 0);
  const runs = sql
    .exec("SELECT r.state AS state, r.hold AS hold, COALESCE((SELECT SUM(a.charged) FROM run_attempts a WHERE a.run_id = r.id), 0) AS spent FROM runs r WHERE r.day = ?", day)
    .toArray() as { state: string; hold: number; spent: number }[];
  return single + runs.reduce((n, r) => n + (r.state === 'open' ? Math.max(r.hold, r.spent) : r.spent), 0);
};

/**
 * Reserve one attempt. Must run inside a synchronous transaction (the Durable Object runs one at a time, so concurrent callers
 * cannot both take the same headroom). Never writes when refused. Refused with 'overrun' for the rest of the UTC day once any
 * settlement today was an overrun (this covers a repair of the request that overran, and every other request).
 */
export function reserve(sql: SqlLike, req: ReserveRequest, nowMs: number): ReserveResult {
  const { ceiling, budget, neurons } = req;
  if (!Number.isFinite(nowMs) || !Number.isInteger(ceiling) || ceiling < 0 || !Number.isFinite(budget) || budget < 0 || !Number.isFinite(neurons) || neurons <= 0) throw new Error('invalid reservation arguments');
  const day = utcDay(nowMs);
  const used = (sql.exec('SELECT admitted FROM usage WHERE day = ?', day).toArray()[0] as { admitted: number } | undefined)?.admitted ?? 0;
  const charged = chargedOn(sql, day);
  if (used >= ceiling) return { ok: false, reason: 'attempts', used, charged };
  if (overrunsOn(sql, day) > 0) return { ok: false, reason: 'overrun', used, charged }; // locked for the day, whatever headroom remains
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
  const r = sql.exec("SELECT COALESCE(SUM(CASE WHEN state = 'reserved' THEN 1 ELSE 0 END), 0) AS u FROM reservations WHERE day = ?", day).toArray()[0] as { u: number };
  const ru = sql.exec("SELECT COALESCE(SUM(CASE WHEN a.state = 'reserved' THEN 1 ELSE 0 END), 0) AS u FROM run_attempts a JOIN runs r ON r.id = a.run_id WHERE r.day = ?", day).toArray()[0] as { u: number };
  return { attempts: usedOn(sql, nowMs), charged: chargedOn(sql, day), unsettled: Number(r.u) + Number(ru.u), overruns: overrunsOn(sql, day) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Whole-run admission. Before anything is sent, the client states its chunk plan; the Worker computes each chunk's worst case
// (run-plan.ts: the exact input bound and an ENFORCED output cap, one attempt, no automatic repair) and holds the sum for the run in
// ONE transaction, together with one admission per chunk. If the day cannot cover the whole hold, nothing is held and the run is
// refused up front. Once held, no attempt inside the run can be refused for budget: each chunk's attempt draws from its own part of
// the hold, is limited to the cap that was planned, and the hold is released down to what was actually used when the run closes
// (all chunks settled, the client closes it, or it expires). Unused attempts are released too; a call that timed out or reported no
// usage keeps its reservation. A recorded overrun locks the day for NEW runs and single attempts, not for a run already held.

export type OpenRunRequest = { ceiling: number; budget: number; token: string; /** each chunk's single attempt: its worst-case neurons and its enforced output cap */ chunks: { neurons: number; cap: number }[]; ttlMs: number; maxOpen: number };
export type OpenRunResult =
  | { ok: true; id: number; hold: number; attempts: number; expiresMs: number; remaining: number }
  | { ok: false; reason: 'attempts' | 'neurons' | 'overrun' | 'busy'; need: number; remaining: number; used: number };
export type RunAttempt = { ok: true; id: number } | { ok: false; reason: 'unknown_run' | 'expired' | 'chunk_used' | 'over_plan' };
export type RunChunk = { ok: true; neurons: number; cap: number } | { ok: false; reason: 'unknown_run' | 'expired' | 'chunk_used' };
export type CloseRunResult = { closed: boolean; charged: number; released: number };

export function initRuns(sql: SqlLike): void {
  sql.exec('CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, token TEXT NOT NULL, hold REAL NOT NULL, attempts INTEGER NOT NULL, planned TEXT NOT NULL, state TEXT NOT NULL, expires_ms INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS run_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, chunk INTEGER NOT NULL, reserved REAL NOT NULL, charged REAL NOT NULL, state TEXT NOT NULL, overrun INTEGER NOT NULL DEFAULT 0)');
  sql.exec('CREATE INDEX IF NOT EXISTS runs_day ON runs (day)');
  sql.exec('CREATE INDEX IF NOT EXISTS run_attempts_run ON run_attempts (run_id)');
}

type RunRow = { id: number; day: string; token: string; hold: number; attempts: number; planned: string; state: string; expires_ms: number };
const runRow = (sql: SqlLike, id: number): RunRow | undefined => sql.exec('SELECT id, day, token, hold, attempts, planned, state, expires_ms FROM runs WHERE id = ?', id).toArray()[0] as RunRow | undefined;

/** Close a run: it counts what its attempts were charged from now on, and the attempts it never used go back to the day. */
function closeRow(sql: SqlLike, r: RunRow): CloseRunResult {
  if (r.state !== 'open') return { closed: false, charged: 0, released: 0 };
  const used = Number((sql.exec('SELECT COUNT(*) AS n FROM run_attempts WHERE run_id = ?', r.id).toArray()[0] as { n: number }).n);
  const spent = Number((sql.exec('SELECT COALESCE(SUM(charged), 0) AS c FROM run_attempts WHERE run_id = ?', r.id).toArray()[0] as { c: number }).c);
  const unused = Math.max(0, r.attempts - used);
  sql.exec("UPDATE runs SET state = 'closed' WHERE id = ?", r.id);
  if (unused > 0) sql.exec('UPDATE usage SET admitted = MAX(0, admitted - ?) WHERE day = ?', unused, r.day);
  return { closed: true, charged: spent, released: Math.max(0, r.hold - spent) };
}

/** Close every open run whose time is up (called at the start of every run operation). */
export function expireRuns(sql: SqlLike, nowMs: number): number {
  const rows = sql.exec("SELECT id, day, token, hold, attempts, planned, state, expires_ms FROM runs WHERE state = 'open' AND expires_ms < ?", nowMs).toArray() as RunRow[];
  for (const r of rows) closeRow(sql, r);
  return rows.length;
}

export function openRun(sql: SqlLike, req: OpenRunRequest, nowMs: number): OpenRunResult {
  const { ceiling, budget, chunks } = req;
  if (!Number.isFinite(nowMs) || !Number.isInteger(ceiling) || ceiling < 0 || !Number.isFinite(budget) || budget < 0 || chunks.length === 0 || chunks.some((c) => !Number.isFinite(c.neurons) || c.neurons <= 0 || !Number.isInteger(c.cap) || c.cap <= 0) || !req.token) throw new Error('invalid run arguments');
  expireRuns(sql, nowMs);
  const day = utcDay(nowMs);
  const used = usedOn(sql, nowMs);
  const charged = chargedOn(sql, day);
  const hold = Math.ceil(chunks.reduce((a, c) => a + c.neurons, 0) * 1000) / 1000;
  const remaining = Math.max(0, Math.floor((budget - charged) * 1000) / 1000);
  const refuse = (reason: 'attempts' | 'neurons' | 'overrun' | 'busy'): OpenRunResult => ({ ok: false, reason, need: hold, remaining, used });
  if (overrunsOn(sql, day) > 0) return refuse('overrun');
  const open = Number((sql.exec("SELECT COUNT(*) AS n FROM runs WHERE state = 'open'").toArray()[0] as { n: number }).n);
  if (open >= req.maxOpen) return refuse('busy');
  if (used + chunks.length > ceiling) return refuse('attempts');
  if (charged + hold > budget) return refuse('neurons');
  sql.exec('INSERT INTO usage (day, admitted) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET admitted = excluded.admitted', day, used + chunks.length);
  const expiresMs = nowMs + req.ttlMs;
  sql.exec("INSERT INTO runs (day, token, hold, attempts, planned, state, expires_ms) VALUES (?, ?, ?, ?, ?, 'open', ?)", day, req.token, hold, chunks.length, JSON.stringify(chunks.map((c) => [c.neurons, c.cap])), expiresMs);
  const id = Number((sql.exec('SELECT last_insert_rowid() AS id').toArray()[0] as { id: number }).id);
  const old = utcDay(nowMs - 7 * 86_400_000);
  sql.exec('DELETE FROM run_attempts WHERE run_id IN (SELECT id FROM runs WHERE day < ?)', old);
  sql.exec('DELETE FROM runs WHERE day < ?', old);
  return { ok: true, id, hold, attempts: chunks.length, expiresMs, remaining: Math.max(0, Math.floor((budget - charged - hold) * 1000) / 1000) };
}

const timingSafeEqual = (a: string, b: string): boolean => {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
};

/** The planned worst case of one chunk, if the run is open, unexpired, matched by token, and the chunk has no attempt yet. */
export function runChunk(sql: SqlLike, id: number, token: string, chunk: number, nowMs: number): RunChunk {
  expireRuns(sql, nowMs);
  const r = runRow(sql, id);
  if (!r || !timingSafeEqual(r.token, token)) return { ok: false, reason: 'unknown_run' };
  if (r.state !== 'open') return { ok: false, reason: 'expired' };
  const planned = JSON.parse(r.planned) as [number, number][];
  if (!Number.isInteger(chunk) || chunk < 0 || chunk >= planned.length) return { ok: false, reason: 'unknown_run' };
  const taken = sql.exec('SELECT 1 AS x FROM run_attempts WHERE run_id = ? AND chunk = ?', id, chunk).toArray().length;
  if (taken) return { ok: false, reason: 'chunk_used' };
  return { ok: true, neurons: planned[chunk]![0], cap: planned[chunk]![1] };
}

/** Take the chunk's attempt out of the hold. It can never be refused for budget; it is refused only if it is larger than planned. */
export function reserveInRun(sql: SqlLike, id: number, token: string, chunk: number, neurons: number, nowMs: number): RunAttempt {
  const c = runChunk(sql, id, token, chunk, nowMs);
  if (!c.ok) return c;
  if (!Number.isFinite(neurons) || neurons <= 0 || neurons > c.neurons + 1e-9) return { ok: false, reason: 'over_plan' };
  sql.exec("INSERT INTO run_attempts (run_id, chunk, reserved, charged, state) VALUES (?, ?, ?, ?, 'reserved')", id, chunk, neurons, neurons);
  return { ok: true, id: Number((sql.exec('SELECT last_insert_rowid() AS id').toArray()[0] as { id: number }).id) };
}

/** Settle a run attempt once, like settle(): measured tokens in full (an overrun is recorded, never clipped), or the reservation stands. */
export function settleInRun(sql: SqlLike, attemptId: number, charged: number | null): SettleResult {
  const row = sql.exec('SELECT run_id, reserved, charged, state FROM run_attempts WHERE id = ?', attemptId).toArray()[0] as { run_id: number; reserved: number; charged: number; state: string } | undefined;
  if (!row) return { settled: false, charged: 0, reserved: 0, overrun: false };
  if (row.state !== 'reserved') return { settled: false, charged: row.charged, reserved: row.reserved, overrun: row.charged > row.reserved };
  let res: SettleResult;
  if (charged === null || !Number.isFinite(charged) || charged < 0) {
    sql.exec("UPDATE run_attempts SET state = 'kept' WHERE id = ?", attemptId);
    res = { settled: true, charged: row.reserved, reserved: row.reserved, overrun: false };
  } else {
    const overrun = charged > row.reserved;
    sql.exec("UPDATE run_attempts SET charged = ?, state = 'measured', overrun = ? WHERE id = ?", charged, overrun ? 1 : 0, attemptId);
    res = { settled: true, charged, reserved: row.reserved, overrun };
  }
  // Every chunk has been attempted and settled: the run is over, and the hold falls to what was used.
  const r = runRow(sql, row.run_id);
  if (r && r.state === 'open') {
    const total = (JSON.parse(r.planned) as unknown[]).length;
    const done = Number((sql.exec("SELECT COUNT(*) AS n FROM run_attempts WHERE run_id = ? AND state != 'reserved'", r.id).toArray()[0] as { n: number }).n);
    if (done >= total) closeRow(sql, r);
  }
  return res;
}

/** The client says it is finished (or stopped): release what was not used. */
export function closeRun(sql: SqlLike, id: number, token: string, nowMs: number): CloseRunResult {
  expireRuns(sql, nowMs);
  const r = runRow(sql, id);
  if (!r || !timingSafeEqual(r.token, token)) return { closed: false, charged: 0, released: 0 };
  return closeRow(sql, r);
}
