import Decimal from 'decimal.js';
import { z } from 'zod';
import { containsTokenRun, nameTokens } from './names';
import { dateCandidates, moneyCandidates, quantityCandidates, type DateOrder, type Span } from './parse';
import type { ValueKind } from './types';

// "Is the claimed value actually supported by its cited excerpt?" (R4.3)
// The resolved value is parsed from the excerpt by code, never taken from the model.

export type SupportInput = {
  kind: ValueKind;
  claimed: unknown;
  excerpt: string;
  /** Field labels that precede the intended value, supplied by the caller's adapter. */
  hints?: string[];
  /** The numeric date order the whole document proves (numericDateOrder over its blocks), used when the excerpt proves none. */
  documentDateOrder?: DateOrder | null;
};

export type SupportResult =
  | { status: 'supported'; resolved: unknown; span?: Span }
  | { status: 'needs_review'; reason: string; resolved: unknown | null }
  | { status: 'unsupported'; reason: string };

const decimalish = z.union([z.string().regex(/^-?\d+(\.\d+)?$/), z.number().finite()]).transform((v) => new Decimal(v));
const MoneyClaim = z.object({ amount: decimalish, currency: z.string().nullable() });
const QuantityClaim = z.object({ value: decimalish, unit: z.string().nullable() });
const DateClaim = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * When an excerpt holds several plausible values, require a label (hint) that
 * immediately precedes exactly one candidate. Otherwise the field is not identifiable.
 */
function pick<T extends Span>(excerpt: string, cands: T[], hints: string[] | undefined): { cand: T } | { reason: string } {
  const sorted = [...cands].sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return { reason: 'no_candidate' };
  if (sorted.length === 1) return { cand: sorted[0]! };
  if (!hints || hints.length === 0) return { reason: 'multiple_candidates_no_context' };
  const labelled = sorted.filter((c, i) => {
    const from = Math.max(i > 0 ? sorted[i - 1]!.end : 0, c.start - 80);
    const window = excerpt.slice(from, c.start).toLowerCase();
    return hints.some((h) => window.includes(h.toLowerCase()));
  });
  return labelled.length === 1 ? { cand: labelled[0]! } : { reason: 'ambiguous_candidates' };
}

export function checkSupport(input: SupportInput): SupportResult {
  const { kind, claimed, excerpt, hints, documentDateOrder } = input;
  switch (kind) {
    case 'money': {
      const c = MoneyClaim.safeParse(claimed);
      if (!c.success) return { status: 'unsupported', reason: 'claim_shape_invalid' };
      const sel = pick(excerpt, moneyCandidates(excerpt), hints);
      if ('reason' in sel) return sel.reason === 'no_candidate' ? { status: 'unsupported', reason: 'value_not_in_excerpt' } : { status: 'needs_review', reason: sel.reason, resolved: null };
      const k = sel.cand;
      if (!k.amount.equals(c.data.amount)) return { status: 'unsupported', reason: 'value_not_in_excerpt' };
      const claimedCur = c.data.currency?.toUpperCase() ?? null;
      if (claimedCur && k.currency && claimedCur !== k.currency) return { status: 'unsupported', reason: 'currency_mismatch' };
      const resolved = { amount: k.amount.toFixed(), currency: k.currency };
      if (k.numberAmbiguous) return { status: 'needs_review', reason: 'number_format_ambiguous', resolved: null };
      if (k.currencyAmbiguous) return { status: 'needs_review', reason: 'currency_ambiguous', resolved };
      return { status: 'supported', resolved, span: k };
    }
    case 'date': {
      const c = DateClaim.safeParse(claimed);
      if (!c.success) return { status: 'unsupported', reason: 'claim_shape_invalid' };
      const sel = pick(excerpt, dateCandidates(excerpt, documentDateOrder ?? null), hints);
      if ('reason' in sel) return sel.reason === 'no_candidate' ? { status: 'unsupported', reason: 'value_not_in_excerpt' } : { status: 'needs_review', reason: sel.reason, resolved: null };
      const k = sel.cand;
      if (k.ambiguous) return { status: 'needs_review', reason: 'date_format_ambiguous', resolved: null };
      if (k.iso !== c.data) return { status: 'unsupported', reason: 'value_not_in_excerpt' };
      return { status: 'supported', resolved: k.iso, span: k };
    }
    case 'quantity': {
      const c = QuantityClaim.safeParse(claimed);
      if (!c.success) return { status: 'unsupported', reason: 'claim_shape_invalid' };
      const exclude = [...moneyCandidates(excerpt), ...dateCandidates(excerpt)];
      const sel = pick(excerpt, quantityCandidates(excerpt, exclude), hints);
      if ('reason' in sel) return sel.reason === 'no_candidate' ? { status: 'unsupported', reason: 'value_not_in_excerpt' } : { status: 'needs_review', reason: sel.reason, resolved: null };
      const k = sel.cand;
      if (!k.value.equals(c.data.value)) return { status: 'unsupported', reason: 'value_not_in_excerpt' };
      if (k.numberAmbiguous) return { status: 'needs_review', reason: 'number_format_ambiguous', resolved: null };
      const unitOk = c.data.unit === null || (k.nextWord !== null && k.nextWord.toLowerCase() === c.data.unit.toLowerCase());
      if (!unitOk) return { status: 'needs_review', reason: 'unit_not_in_excerpt', resolved: { value: k.value.toFixed(), unit: null } };
      // A unit the model did not claim stays unknown (null) even if a word follows the number.
      return { status: 'supported', resolved: { value: k.value.toFixed(), unit: c.data.unit }, span: k };
    }
    case 'name': {
      if (typeof claimed !== 'string' || nameTokens(claimed).length === 0) return { status: 'unsupported', reason: 'claim_shape_invalid' };
      return containsTokenRun(excerpt, claimed)
        ? { status: 'supported', resolved: claimed.trim() }
        : { status: 'unsupported', reason: 'value_not_in_excerpt' };
    }
    case 'text': {
      if (typeof claimed !== 'string' || nameTokens(claimed).length === 0) return { status: 'unsupported', reason: 'claim_shape_invalid' };
      const have = new Set(nameTokens(excerpt));
      return nameTokens(claimed).every((t) => have.has(t))
        ? { status: 'supported', resolved: claimed.trim() }
        : { status: 'unsupported', reason: 'value_not_in_excerpt' };
    }
  }
}
