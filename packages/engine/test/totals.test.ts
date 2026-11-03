import { describe, expect, it } from 'vitest';
import { totalAsQuoted } from '../src';

const zar = (amount: string) => ({ amount, currency: 'ZAR' });

describe('totalAsQuoted', () => {
  it('adds quantity x unit price exactly (decimal, never floating point)', () => {
    const t = totalAsQuoted([{ quantity: '3', unitPrice: zar('0.1') }, { quantity: '7', unitPrice: zar('0.2') }, { quantity: '400', unitPrice: zar('18') }]);
    expect(t).toEqual({ total: { amount: '7201.7', currency: 'ZAR' }, complete: true, lines: 3, included: 3, excluded: 0, reason: null });
    expect(totalAsQuoted([{ quantity: '1', unitPrice: zar('0.1') }, { quantity: '1', unitPrice: zar('0.2') }]).total!.amount).toBe('0.3');
  });
  it('a missing or held quantity or price excludes the line, and the total is incomplete with the count', () => {
    const t = totalAsQuoted([{ quantity: '2', unitPrice: zar('100') }, { quantity: null, unitPrice: zar('5') }, { quantity: '4', unitPrice: null }]);
    expect(t).toEqual({ total: { amount: '200', currency: 'ZAR' }, complete: false, lines: 3, included: 1, excluded: 2, reason: 'lines_excluded' });
  });
  it('different or unknown currencies are never added', () => {
    expect(totalAsQuoted([{ quantity: '1', unitPrice: zar('1') }, { quantity: '1', unitPrice: { amount: '1', currency: 'USD' } }])).toMatchObject({ total: null, complete: false, reason: 'currency_differs' });
    expect(totalAsQuoted([{ quantity: '1', unitPrice: { amount: '1', currency: null } }])).toMatchObject({ total: null, complete: false, reason: 'unknown_currency' });
    expect(totalAsQuoted([{ quantity: '1', unitPrice: zar('1') }, { quantity: '1', unitPrice: { amount: '1', currency: 'zar' } }])).toMatchObject({ complete: true, total: { amount: '2', currency: 'ZAR' } });
  });
  it('no lines, or no usable line, gives no total', () => {
    expect(totalAsQuoted([])).toMatchObject({ total: null, complete: false, reason: 'no_lines' });
    expect(totalAsQuoted([{ quantity: null, unitPrice: null }])).toMatchObject({ total: null, complete: false, excluded: 1, reason: 'lines_excluded' });
  });
  it('a malformed number is excluded, never parsed loosely', () => {
    expect(totalAsQuoted([{ quantity: '1,5', unitPrice: zar('2') }, { quantity: '2', unitPrice: zar('1e3') }])).toMatchObject({ included: 0, excluded: 2, total: null });
  });
});
