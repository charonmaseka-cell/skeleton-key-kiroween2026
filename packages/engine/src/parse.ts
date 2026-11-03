import Decimal from 'decimal.js';

// Candidate extraction from an excerpt. Every candidate carries ambiguity flags
// so callers can keep "Needs review" instead of guessing.

export type Span = { start: number; end: number };

const CODES = 'ZAR|USD|EUR|GBP|AUD|CAD|NZD|CHF|JPY|CNY|INR|BWP|NAD|MZN|KES|NGN';
const MAG: Record<string, number> = {
  k: 3, thousand: 3, m: 6, mn: 6, million: 6, bn: 9, billion: 9,
};
const MAG_RE = '(?:\\s?(thousand|Thousand|million|Million|billion|Billion|bn|BN|mn|m|M|k|K)\\b)?';
const NUM_MONEY = '\\d{1,3}(?:[ \\u00a0\\u202f,]\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?';
const NUM_QTY = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?';

export function parseNumber(raw: string): { value: Decimal; ambiguous: boolean } | null {
  const s = raw.trim();
  try {
    if (/^\d{1,3}(?:[ \u00a0\u202f,]\d{3})+(?:\.\d+)?$/.test(s)) {
      return { value: new Decimal(s.replace(/[ \u00a0\u202f,]/g, '')), ambiguous: false };
    }
    if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) {
      return { value: new Decimal(s.replace(/\./g, '')), ambiguous: true }; // 1.600 : decimal or thousands?
    }
    if (/^\d+,\d+$/.test(s)) {
      return { value: new Decimal(s.replace(',', '.')), ambiguous: true }; // decimal comma
    }
    if (/^\d+(?:\.\d+)?$/.test(s)) return { value: new Decimal(s), ambiguous: false };
  } catch {
    return null;
  }
  return null;
}

export type MoneyCandidate = Span & {
  text: string;
  amount: Decimal;
  currency: string | null;
  currencyAmbiguous: boolean;
  numberAmbiguous: boolean;
};

const SYMBOL_CUR: Record<string, string | null> = { R: 'ZAR', '€': 'EUR', '£': 'GBP', 'US$': 'USD', 'A$': 'AUD', 'C$': 'CAD', $: null };

export function moneyCandidates(text: string): MoneyCandidate[] {
  const found: MoneyCandidate[] = [];
  const prefix = new RegExp(
    `(?<![A-Za-z0-9])(US\\$|A\\$|C\\$|R|\\$|€|£|${CODES})\\s?(${NUM_MONEY})${MAG_RE}`,
    'g',
  );
  const suffix = new RegExp(`(?<![\\w.,])(${NUM_MONEY})${MAG_RE}\\s?(${CODES})\\b`, 'g');
  const build = (m: RegExpMatchArray, curTok: string, numTok: string, magTok: string | undefined) => {
    const num = parseNumber(numTok);
    if (!num) return;
    const exp = magTok ? MAG[magTok.toLowerCase()] : undefined;
    const amount = exp ? num.value.mul(new Decimal(10).pow(exp)) : num.value;
    const isCode = new RegExp(`^(?:${CODES})$`).test(curTok);
    const sym = isCode ? curTok : SYMBOL_CUR[curTok];
    found.push({
      start: m.index!,
      end: m.index! + m[0].length,
      text: m[0],
      amount,
      currency: sym ?? null,
      currencyAmbiguous: sym === null || sym === undefined,
      numberAmbiguous: num.ambiguous,
    });
  };
  for (const m of text.matchAll(prefix)) build(m, m[1]!, m[2]!, m[3]);
  for (const m of text.matchAll(suffix)) build(m, m[3]!, m[1]!, m[2]);
  return dropOverlaps(found);
}

function dropOverlaps<T extends Span>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: T[] = [];
  for (const it of sorted) {
    const last = kept[kept.length - 1];
    if (!last || it.start >= last.end) kept.push(it);
  }
  return kept;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

export type DateCandidate = Span & { text: string; iso: string | null; ambiguous: boolean; /** set when an ambiguous date was read in the order another date proved */ orderFrom?: 'excerpt' | 'document' };

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The order of a numeric date: 25/03/2026 can only be day first; 03/25/2026 only month first. */
export type DateOrder = 'day_first' | 'month_first';

const NUMERIC_DATE = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g;

/**
 * The order the unambiguous numeric dates in `text` prove. `order` is set only when at least one numeric date can be read
 * one way only and every such date agrees; `conflict` is true when they disagree (then nothing is inferred). Dates written
 * with a month name or in ISO form say nothing about the order and are ignored.
 */
export function numericDateOrder(text: string): { order: DateOrder | null; conflict: boolean } {
  const seen = new Set<DateOrder>();
  for (const m of text.matchAll(NUMERIC_DATE)) {
    const a = +m[1]!, b = +m[2]!, y = +m[3]!;
    if (a > 12 && b <= 12 && iso(y, b, a)) seen.add('day_first');
    else if (b > 12 && a <= 12 && iso(y, a, b)) seen.add('month_first');
  }
  if (seen.size > 1) return { order: null, conflict: true };
  return { order: [...seen][0] ?? null, conflict: false };
}

/**
 * Date candidates in `text`. A numeric date such as 01/03/2026 can be day first or month first: it is AMBIGUOUS unless
 * another date proves the order. The excerpt is consulted first: if it holds a date that can only be read one way (for
 * example 28/02/2027), its order is used. If the excerpt proves nothing, `documentOrder` (the order the whole document
 * proves, from numericDateOrder over its blocks) is used. Conflicting evidence in the excerpt, or none anywhere, leaves the
 * date ambiguous; the excerpt's own conflict is never overridden by the document. A resolved date records where its order
 * came from (`orderFrom`).
 */
export function dateCandidates(text: string, documentOrder: DateOrder | null = null): DateCandidate[] {
  const found: DateCandidate[] = [];
  const add = (m: RegExpMatchArray, value: string | null, ambiguous: boolean, orderFrom?: 'excerpt' | 'document') =>
    found.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], iso: ambiguous ? null : value, ambiguous, ...(orderFrom ? { orderFrom } : {}) });
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    add(m, iso(+m[1]!, +m[2]!, +m[3]!), false);
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\.?,?\\s+(\\d{4})\\b`, 'gi'))) {
    add(m, iso(+m[3]!, MONTHS[m[2]!.toLowerCase()]!, +m[1]!), false);
  }
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'))) {
    add(m, iso(+m[3]!, MONTHS[m[1]!.toLowerCase()]!, +m[2]!), false);
  }
  const local = numericDateOrder(text);
  const order = local.conflict ? null : (local.order ?? documentOrder);
  const from: 'excerpt' | 'document' = local.order ? 'excerpt' : 'document';
  for (const m of text.matchAll(NUMERIC_DATE)) {
    const a = +m[1]!, b = +m[2]!, y = +m[3]!;
    if (a > 12 && b <= 12) add(m, iso(y, b, a), false);
    else if (b > 12 && a <= 12) add(m, iso(y, a, b), false);
    else if (a === b) add(m, iso(y, a, b), false);
    else if (order === 'day_first') add(m, iso(y, b, a), false, from);
    else if (order === 'month_first') add(m, iso(y, a, b), false, from);
    else add(m, null, true); // 01/02/2026 with nothing to say which order: day-first or month-first?
  }
  return dropOverlaps(found);
}

export type QuantityCandidate = Span & {
  text: string;
  value: Decimal;
  numberAmbiguous: boolean;
  nextWord: string | null;
};

/** Numbers that are not part of a money or date span. */
export function quantityCandidates(text: string, exclude: Span[] = []): QuantityCandidate[] {
  const found: QuantityCandidate[] = [];
  const re = new RegExp(`(?<![\\w.,])(${NUM_QTY})(?![\\w]|[.,]\\d)(?:\\s?([A-Za-zµ²³/]{1,12}))?`, 'g');
  for (const m of text.matchAll(re)) {
    const start = m.index!;
    const end = start + m[1]!.length;
    if (exclude.some((s) => start < s.end && end > s.start)) continue;
    const num = parseNumber(m[1]!);
    if (!num) continue;
    found.push({ start, end, text: m[1]!, value: num.value, numberAmbiguous: num.ambiguous, nextWord: m[2] ?? null });
  }
  return found;
}
