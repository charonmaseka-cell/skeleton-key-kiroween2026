// Name comparison that preserves meaningful differences.
// Only case, punctuation, whitespace and "&" vs "and" are ignored. Differences in
// legal-form words are reported separately; any other token difference is "different".

const LEGAL_FORM = new Set([
  'pty', 'ltd', 'limited', 'inc', 'incorporated', 'llc', 'plc', 'cc', 'npc', 'co', 'corp', 'corporation',
]);

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

export type NameComparison = 'same' | 'legal_form_differs' | 'different';

export function compareNames(a: string, b: string): NameComparison {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 'different';
  if (ta.join(' ') === tb.join(' ')) return 'same';
  const ca = ta.filter((t) => !LEGAL_FORM.has(t));
  const cb = tb.filter((t) => !LEGAL_FORM.has(t));
  if (ca.length > 0 && ca.join(' ') === cb.join(' ')) return 'legal_form_differs';
  return 'different';
}

/** True if the tokens of `needle` appear as a contiguous run in `haystack`. */
export function containsTokenRun(haystack: string, needle: string): boolean {
  const h = nameTokens(haystack);
  const n = nameTokens(needle);
  if (n.length === 0) return false;
  for (let i = 0; i + n.length <= h.length; i++) {
    if (n.every((t, k) => h[i + k] === t)) return true;
  }
  return false;
}
