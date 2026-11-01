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

export type DateCandidate = Span & { text: string; iso: string | null; ambiguous: boolean };

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function dateCandidates(text: string): DateCandidate[] {
  const found: DateCandidate[] = [];
  const add = (m: RegExpMatchArray, value: string | null, ambiguous: boolean) =>
    found.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], iso: ambiguous ? null : value, ambiguous });
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    add(m, iso(+m[1]!, +m[2]!, +m[3]!), false);
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\.?,?\\s+(\\d{4})\\b`, 'gi'))) {
    add(m, iso(+m[3]!, MONTHS[m[2]!.toLowerCase()]!, +m[1]!), false);
  }
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'))) {
    add(m, iso(+m[3]!, MONTHS[m[1]!.toLowerCase()]!, +m[2]!), false);
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) {
    const a = +m[1]!, b = +m[2]!, y = +m[3]!;
    if (a > 12 && b <= 12) add(m, iso(y, b, a), false);
    else if (b > 12 && a <= 12) add(m, iso(y, a, b), false);
    else if (a === b) add(m, iso(y, a, b), false);
    else add(m, null, true); // 01/02/2026: day-first or month-first?
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
