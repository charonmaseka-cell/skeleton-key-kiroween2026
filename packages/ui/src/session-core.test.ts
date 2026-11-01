import { describe, expect, it } from 'vitest';
import { parseCorrection } from './session-core';

// Review #5: a correction must never silently change magnitude.

describe('money correction input', () => {
  const money = (amount: string, currency = 'ZAR') => parseCorrection('money', { amount, currency });

  it('accepts plain numbers and space-grouped thousands', () => {
    expect(money('1600000')).toEqual({ ok: true, value: { amount: '1600000', currency: 'ZAR' } });
    expect(money('1 600 000')).toEqual({ ok: true, value: { amount: '1600000', currency: 'ZAR' } });
    expect(money('450.50')).toEqual({ ok: true, value: { amount: '450.50', currency: 'ZAR' } });
    expect(money('12 500.75')).toEqual({ ok: true, value: { amount: '12500.75', currency: 'ZAR' } });
  });

  it('refuses commas instead of guessing (1,5 must not become 15, nor 1 600,50 become 160050)', () => {
    for (const bad of ['1,5', '1 600,50', '1,600', '1,600,000', '1.600,50']) {
      const r = money(bad);
      expect(r.ok, bad).toBe(false);
      expect(r.ok ? '' : r.error).toMatch(/commas are not accepted/);
    }
  });

  it('refuses malformed groupings and a missing or invalid currency', () => {
    expect(money('1 60 000').ok).toBe(false);
    expect(money('abc').ok).toBe(false);
    expect(money('100', '').ok).toBe(false);
    expect(money('100', 'RAND').ok).toBe(false);
  });
});
