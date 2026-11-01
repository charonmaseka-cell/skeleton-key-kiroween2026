import { DatabaseSync } from 'node:sqlite';
import { admit, initSchema, utcDay, type AdmitResult, type SqlLike } from '../../../services/extraction-api/src/admission';

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
    initSchema(this.sql);
  }

  async admit(ceiling: number, nowMs: number): Promise<AdmitResult> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = admit(this.sql, ceiling, nowMs);
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  usedToday(nowMs: number): number {
    const rows = this.sql.exec('SELECT admitted FROM usage WHERE day = ?', utcDay(nowMs)).toArray() as { admitted: number }[];
    return rows[0]?.admitted ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
