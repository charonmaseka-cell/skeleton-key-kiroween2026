import { describe, expect, it } from 'vitest';
import { emptySession, evaluateSession } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

// Severity policy: a quantity difference is High, not Critical. Critical stays for missing items and specification mismatches.
describe('severity of ScopeCheck findings', () => {
  for (const fx of FIXTURES) {
    const v = evaluateSession(scopeCheckAdapter, fx, emptySession(), 1);
    const sev = (code: string) => [...new Set(v.items.filter((i) => i.finding.code === code).map((i) => i.finding.severity))];
    it(`${fx.id}: quantity.differs is high, spec.differs and item.absent are critical`, () => {
      expect(v.items.some((i) => i.finding.code === 'quantity.differs') || v.items.some((i) => i.finding.code === 'spec.differs') || v.items.some((i) => i.finding.code === 'item.absent')).toBe(true);
      expect(sev('quantity.differs').filter((s) => s !== 'high')).toEqual([]);
      expect(sev('spec.differs').filter((s) => s !== 'critical')).toEqual([]);
      expect(sev('item.absent').filter((s) => s !== 'critical')).toEqual([]);
    });
  }
  it('the standard sample has at least one High quantity finding, and it is shown as High', () => {
    const v = evaluateSession(scopeCheckAdapter, FIXTURES[0]!, emptySession(), 1);
    expect(v.items.filter((i) => i.finding.code === 'quantity.differs' && i.finding.state === 'confirmed').map((i) => i.finding.severity)).toContain('high');
  });
});
