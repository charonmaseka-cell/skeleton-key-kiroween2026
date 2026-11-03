import Decimal from 'decimal.js';

// "Total as quoted": the sum of quantity x unit price over a document's priced lines, in exact decimal arithmetic. Domain-neutral:
// the adapter decides which lines exist and passes null for any value that is missing or not validated. A line with a missing or
// held value is EXCLUDED (never estimated), and the total then says it is incomplete and how many lines it left out. Different
// currencies are never added up. Nothing here ranks or compares documents.

export type PricedLine = {
  /** the quoted quantity, validated (or supplied by the user); null when missing or held */
  quantity: string | null;
  /** the unit price, validated (or supplied by the user); null when missing or held */
  unitPrice: { amount: string; currency: string | null } | null;
};

export type TotalAsQuoted = {
  /** the sum over the included lines, or null when nothing could be added (or currencies differ) */
  total: { amount: string; currency: string } | null;
  /** true only when every line was included and there is one known currency */
  complete: boolean;
  lines: number;
  included: number;
  /** lines left out because a quantity or unit price is missing or held */
  excluded: number;
  /** why the total is not complete, in order of importance */
  reason: 'no_lines' | 'lines_excluded' | 'currency_differs' | 'unknown_currency' | null;
};

const isDecimal = (s: string) => /^-?\d+(\.\d+)?$/.test(s);

export function totalAsQuoted(lines: PricedLine[]): TotalAsQuoted {
  const usable = lines.filter((l) => l.quantity !== null && isDecimal(l.quantity) && l.unitPrice !== null && isDecimal(l.unitPrice.amount));
  const excluded = lines.length - usable.length;
  const base = { lines: lines.length, included: usable.length, excluded };
  if (lines.length === 0) return { ...base, total: null, complete: false, reason: 'no_lines' };
  const currencies = new Set(usable.map((l) => l.unitPrice!.currency?.toUpperCase() ?? null));
  if (currencies.has(null)) return { ...base, total: null, complete: false, reason: 'unknown_currency' };
  if (currencies.size > 1) return { ...base, total: null, complete: false, reason: 'currency_differs' };
  if (usable.length === 0) return { ...base, total: null, complete: false, reason: 'lines_excluded' };
  const sum = usable.reduce((acc, l) => acc.plus(new Decimal(l.quantity!).times(l.unitPrice!.amount)), new Decimal(0));
  return { ...base, total: { amount: sum.toFixed(), currency: [...currencies][0]! }, complete: excluded === 0, reason: excluded > 0 ? 'lines_excluded' : null };
}
