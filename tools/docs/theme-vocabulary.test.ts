import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCOPE_THEME } from '../../apps/scopecheck/src/adapter/labels';
import { PACK_THEME } from '../../apps/packcheck/src/adapter/labels';

// .kiro/steering/theme.md lists the names the apps show; this keeps the table and the adapters from drifting apart.
const doc = readFileSync(new URL('../../.kiro/steering/theme.md', import.meta.url), 'utf8');
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const rowOf = (code: string) => doc.split('\n').find((l) => l.startsWith('|') && l.includes(`\`${code}\``)) ?? '';

describe('theme.md vocabulary table', () => {
  for (const [code, entry] of [...Object.entries(SCOPE_THEME), ...Object.entries(PACK_THEME)]) {
    it(`${code} is listed with the name the app shows${entry.review ? ' and its Needs-review name' : ''}`, () => {
      const row = rowOf(code);
      expect(row, code).not.toBe('');
      expect(row.toLowerCase()).toContain(entry.name.toLowerCase());
      if (entry.review) expect(row.toLowerCase()).toContain(entry.review.name.toLowerCase());
    });
  }
  it('price.arithmetic is Phantom maths and is no longer listed as reserved; "Unseen" is gone', () => {
    expect(SCOPE_THEME['price.arithmetic']?.name).toBe('phantom maths');
    expect(doc).not.toMatch(/Reserved for rules not built yet:[^\n]*Phantom maths/);
    expect(doc).not.toMatch(/unseen/i);
    expect(cap(SCOPE_THEME['price.arithmetic']!.name)).toBe('Phantom maths');
  });
});
