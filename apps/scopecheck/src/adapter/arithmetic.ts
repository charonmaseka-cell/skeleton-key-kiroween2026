import Decimal from 'decimal.js';
import { compareQuantities, type Quantity } from '@skeleton-key/engine';

// Deterministic unit and price-arithmetic checks for ScopeCheck (foundation R2.9, R4, R6). Pure functions over validated values:
// no document text is read here beyond the evidence excerpts passed in, nothing is converted unless the documents state the
// conversion, and every doubt is returned as "unclear" (the caller keeps it in Needs review). All arithmetic is decimal.js.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (u: string) => u.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * A conversion between two units that the documents STATE, in one of two written forms: "1 box = 100 each" or "100 each per box".
 * Returns how many `to` units are in one `from` unit, or null. "box of 100" is NOT a stated conversion (it leaves the unit of the
 * 100 unsaid), and nothing is ever guessed from common knowledge (a roll is not assumed to be any number of metres).
 */
export function statedConversion(from: string, to: string, texts: string[]): Decimal | null {
  const f = esc(norm(from));
  const t = esc(norm(to));
  const num = '(\\d+(?:[.,]\\d+)?)';
  const forms = [new RegExp(`\\b1\\s*${f}\\s*(?:=|equals)\\s*${num}\\s*${t}\\b`, 'i'), new RegExp(`\\b${num}\\s*${t}\\s*per\\s*${f}\\b`, 'i')];
  const found = new Set<string>();
  for (const text of texts) for (const re of forms) {
    const m = text.match(re);
    if (m) found.add(m[1]!.replace(',', '.'));
  }
  return found.size === 1 ? new Decimal([...found][0]!) : null; // two different statements: not clear
}

export type UnitVerdict =
  | { kind: 'same' }
  | { kind: 'converted'; quantity: Quantity; factor: string; from: string; to: string }
  | { kind: 'unclear'; reason: 'unit_missing' | 'unit_differs'; requested: string | null; offered: string | null };

/** Compare the units of a requested and an offered quantity. Same unit (ignoring case): fine. Otherwise a stated conversion, or unclear. */
export function unitVerdict(requested: Quantity, offered: Quantity, texts: string[]): UnitVerdict {
  const c = compareQuantities(requested, offered);
  if (c.result !== 'incomparable') return { kind: 'same' };
  if (c.reason === 'unknown_unit') return { kind: 'unclear', reason: 'unit_missing', requested: requested.unit, offered: offered.unit };
  if (c.reason !== 'unit_differs') return { kind: 'same' }; // some other doubt: not a unit question
  const factor = statedConversion(offered.unit!, requested.unit!, texts);
  if (factor) return { kind: 'converted', quantity: { value: new Decimal(offered.value).times(factor).toFixed(), unit: requested.unit }, factor: factor.toFixed(), from: offered.unit!, to: requested.unit! };
  return { kind: 'unclear', reason: 'unit_differs', requested: requested.unit, offered: offered.unit };
}

export type PriceInput = {
  quantity: Quantity;
  unitPrice: { amount: string; currency: string | null };
  lineTotal: { amount: string; currency: string | null };
  /** a stated discount on the line, as a percentage of the gross (for example "10" for 10 %), or null when none is stated */
  discountPercent: string | null;
  /** the line mentions tax (a rate or an amount): whether the total includes it is then not known from the values alone */
  taxStated: boolean;
};
export type PriceVerdict = { result: 'ok' | 'mismatch'; expected: string; stated: string; currency: string } | { result: 'unclear'; reason: 'currency_unknown' | 'currency_differs' | 'unit_unknown' | 'tax_basis_unclear' | 'discount_basis_unclear' };

/**
 * line total = quantity x unit price, less a stated percentage discount, rounded to cents (half up). A difference of one cent or less
 * is rounding, not an error. Returns "unclear" instead of a verdict when the basis is not justified by the values: unknown or
 * different currencies (never converted), an unknown unit of the quantity, a tax figure on the line, or a discount that is not a
 * percentage between 0 and 100.
 */
export function checkLinePrice(p: PriceInput): PriceVerdict {
  const cur = [p.unitPrice.currency, p.lineTotal.currency];
  if (cur.some((c) => !c)) return { result: 'unclear', reason: 'currency_unknown' };
  if (cur[0]!.toUpperCase() !== cur[1]!.toUpperCase()) return { result: 'unclear', reason: 'currency_differs' };
  if (!p.quantity.unit) return { result: 'unclear', reason: 'unit_unknown' };
  if (p.taxStated) return { result: 'unclear', reason: 'tax_basis_unclear' };
  let factor = new Decimal(1);
  if (p.discountPercent !== null) {
    const d = new Decimal(p.discountPercent);
    if (d.lt(0) || d.gt(100)) return { result: 'unclear', reason: 'discount_basis_unclear' };
    factor = new Decimal(100).minus(d).div(100);
  }
  const expected = new Decimal(p.quantity.value).times(p.unitPrice.amount).times(factor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const stated = new Decimal(p.lineTotal.amount);
  const ok = expected.minus(stated).abs().lte('0.01');
  return { result: ok ? 'ok' : 'mismatch', expected: expected.toFixed(2), stated: stated.toFixed(2), currency: cur[0]!.toUpperCase() };
}
