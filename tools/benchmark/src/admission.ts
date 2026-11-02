import { DatabaseSync } from 'node:sqlite';
import { admit, budgetOn, initLedger, reserve, settle, utcDay, type AdmitResult, type BudgetDay, type ReserveRequest, type ReserveResult, type SettleResult, type SqlLike } from '../../../services/extraction-api/src/admission';

/**
 * Local persistent admission counter. It runs the SAME admit() code as the Durable Object,
 * over a SQLite file, so a live run is bounded by a hard server-side style ceiling.
 * Stores only a UTC day and an integer.
 */
export class SqliteAdmission {
  private db: DatabaseSync;
  private sql: SqlLike;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.sql = {
      exec: (query: string, ...bindings: unknown[]) => {
        const stmt = this.db.prepare(query);
        if (stmt.columns().length === 0) {
          stmt.run(...(bindings as never[]));
          return { toArray: () => [] };
        }
        return { toArray: () => stmt.all(...(bindings as never[])) };
      },
    };
    initLedger(this.sql);
  }

  private tx<T>(f: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = f();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async admit(ceiling: number, nowMs: number): Promise<AdmitResult> {
    return this.tx(() => admit(this.sql, ceiling, nowMs));
  }

  /** The Worker's reservation and settlement, the same code as the Durable Object. */
  async reserve(req: ReserveRequest, nowMs: number): Promise<ReserveResult> {
    return this.tx(() => reserve(this.sql, req, nowMs));
  }

  async settle(id: number, charged: number | null): Promise<SettleResult> {
    return this.tx(() => settle(this.sql, id, charged));
  }

  budgetToday(nowMs: number): BudgetDay {
    return budgetOn(this.sql, nowMs);
  }

  usedToday(nowMs: number): number {
    const rows = this.sql.exec('SELECT admitted FROM usage WHERE day = ?', utcDay(nowMs)).toArray() as { admitted: number }[];
    return rows[0]?.admitted ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
