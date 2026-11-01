import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteAdmission } from '../src/admission';

describe('local admission counter (same admit() code as the Durable Object)', () => {
  it('enforces the ceiling, persists across reopen, and rolls over at UTC midnight', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-adm-'));
    const file = join(dir, 'a.sqlite');
    const t = Date.UTC(2026, 10, 1, 23, 59, 59, 999);
    try {
      let c = new SqliteAdmission(file);
      expect((await c.admit(2, t)).ok).toBe(true);
      expect((await c.admit(2, t)).ok).toBe(true);
      expect((await c.admit(2, t)).ok).toBe(false);
      c.close();
      c = new SqliteAdmission(file); // restart
      expect(c.usedToday(t)).toBe(2);
      expect((await c.admit(2, t)).ok).toBe(false);
      expect((await c.admit(2, Date.UTC(2026, 10, 2, 0, 0, 0, 0))).ok).toBe(true); // new UTC day
      c.close();
      // only a day and a count are stored
      const bytes = readdirSync(dir).map((f) => readFileSync(join(dir, f)).toString('latin1')).join('');
      expect(bytes).toContain('2026-11-01');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
