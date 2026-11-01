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
