import Decimal from 'decimal.js';

// Decimal comparisons that refuse to compare what cannot be justified.

export type Comparison = { result: 'equal' | 'different' } | { result: 'incomparable'; reason: string };

export type Amount = { amount: string; currency: string | null };
export type Quantity = { value: string; unit: string | null };

export function compareAmounts(a: Amount | null, b: Amount | null): Comparison {
  if (!a || !b) return { result: 'incomparable', reason: 'unknown_value' };
  if (!a.currency || !b.currency) return { result: 'incomparable', reason: 'unknown_currency' };
  if (a.currency.toUpperCase() !== b.currency.toUpperCase()) return { result: 'incomparable', reason: 'currency_differs' }; // no conversion
  return new Decimal(a.amount).equals(b.amount) ? { result: 'equal' } : { result: 'different' };
}

export function compareQuantities(a: Quantity | null, b: Quantity | null): Comparison {
  if (!a || !b) return { result: 'incomparable', reason: 'unknown_value' };
  if (!a.unit || !b.unit) return { result: 'incomparable', reason: 'unknown_unit' };
  if (a.unit.toLowerCase() !== b.unit.toLowerCase()) return { result: 'incomparable', reason: 'unit_differs' };
  return new Decimal(a.value).equals(b.value) ? { result: 'equal' } : { result: 'different' };
}
