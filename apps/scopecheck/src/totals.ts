import Decimal from 'decimal.js';
import type { EffectiveFact } from '@skeleton-key/engine';
import { linesOf, type Line } from './adapter/rules';

// "Total as quoted": for each quotation, the sum of (validated unit price x validated quantity) over the quotation's lines, computed
// here in code with decimal.js (never by the model, never in floating point). A line enters the total only when BOTH its unit price
// and its quantity are validated (or supplied by the reviewer) and unambiguous. Any other line is excluded and counted, and the total
// is then shown as incomplete. It is the quotation's own quantity, as quoted, not the RFQ quantity. The result is a number per
// quotation and nothing else: no ranking, no comparison between quotations, no recommendation.
//
// The extraction schema has unit prices and quantities but no line-total field, so a line total is computed as quantity x unit price.

export type ExcludedReason = 'price_missing' | 'price_held' | 'quantity_missing' | 'quantity_held' | 'ambiguous_values' | 'unreadable_value';

export const EXCLUDED_TEXT: Record<ExcludedReason, string> = {
  price_missing: 'no unit price was extracted',
  price_held: 'the unit price is held for review (not validated)',
  quantity_missing: 'no quantity was extracted',
  quantity_held: 'the quantity is held for review (not validated)',
  ambiguous_values: 'the line has more than one price, quantity or item value',
  unreadable_value: 'a price or quantity could not be read as a number',
};

export type ExcludedLine = { blockId: string; reasons: ExcludedReason[] };
export type CountedLine = { blockId: string; unitPrice: string; quantity: string; lineTotal: string; currency: string | null; supplied: boolean };

export type QuoteTotal = {
  quote: string;
  /** complete: every line counted; incomplete: some excluded; none: no line could be counted; mixed_currency: counted lines use different currencies */
  state: 'complete' | 'incomplete' | 'none' | 'mixed_currency';
  currency: string | null;
  /** the sum of the counted lines, fixed to 2 decimals; null when there is nothing to sum or the currencies differ */
  sum: string | null;
  counted: CountedLine[];
  excluded: ExcludedLine[];
  currencies: (string | null)[];
};

const isLine = (l: Line) => !!(l.f.item || l.f.quantity || l.f.unit_price);

function amountOf(e: EffectiveFact | undefined, key: 'amount' | 'value'): Decimal | null {
  const v = e?.value as Record<string, unknown> | null | undefined;
  const raw = v && typeof v === 'object' ? v[key] : undefined;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  try {
    const d = new Decimal(raw);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export function totalFor(facts: Map<string, EffectiveFact>, quote: string): QuoteTotal {
  const counted: CountedLine[] = [];
  const excluded: ExcludedLine[] = [];
  let sum = new Decimal(0);
  for (const l of linesOf(facts, quote).filter(isLine)) {
    const reasons: ExcludedReason[] = [];
    const prices = l.all.unit_price ?? [];
    const qtys = l.all.quantity ?? [];
    if ((l.all.item?.length ?? 0) > 1 || prices.length > 1 || qtys.length > 1) reasons.push('ambiguous_values');
    else {
      const p = prices[0];
      const q = qtys[0];
      if (!p) reasons.push('price_missing');
      else if (!p.usable) reasons.push('price_held');
      if (!q) reasons.push('quantity_missing');
      else if (!q.usable) reasons.push('quantity_held');
      if (!reasons.length) {
        const price = amountOf(p, 'amount');
        const qty = amountOf(q, 'value');
        if (!price || !qty) reasons.push('unreadable_value');
        else {
          const lineTotal = price.mul(qty);
          sum = sum.plus(lineTotal);
          const currency = ((p!.value as { currency?: string | null }).currency ?? null) || null;
          counted.push({ blockId: l.blockId, unitPrice: price.toFixed(), quantity: qty.toFixed(), lineTotal: lineTotal.toFixed(), currency, supplied: p!.provenance === 'user_supplied' || q!.provenance === 'user_supplied' });
        }
      }
    }
    if (reasons.length) excluded.push({ blockId: l.blockId, reasons });
  }
  const currencies = [...new Set(counted.map((c) => c.currency))];
  const mixed = currencies.length > 1;
  const state: QuoteTotal['state'] = mixed ? 'mixed_currency' : !counted.length ? 'none' : excluded.length ? 'incomplete' : 'complete';
  return { quote, state, currency: currencies.length === 1 ? currencies[0]! : null, sum: counted.length && !mixed ? sum.toFixed(2) : null, counted, excluded, currencies };
}

export const totalsFor = (facts: Map<string, EffectiveFact>, quotes: string[]): QuoteTotal[] => quotes.map((q) => totalFor(facts, q));

/** "12 345.00" with a space for thousands: no locale dependence. */
export const formatAmount = (fixed2: string): string => fixed2.replace(/^(-?\d+)(\.\d+)$/, (_m, i: string, f: string) => i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + f);
