// Text normalisation that keeps a mapping back to the ORIGINAL characters.
// Evidence offsets always refer to the original block text.

export type NormalizedText = {
  text: string;
  /** map[i] = index in the original string of normalised character i */
  map: number[];
};

const HYPHENS = /[\u2010-\u2015\u2212-]/;
const isHyphen = (c: string) => HYPHENS.test(c);
const isLetter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);
const isSpace = (c: string) => /\s/.test(c);

export function normalizeWithMap(original: string): NormalizedText {
  const out: string[] = [];
  const map: number[] = [];
  const n = original.length;
  let i = 0;
  while (i < n) {
    const ch = original[i]!;
    if (isSpace(ch)) {
      let j = i;
      while (j < n && isSpace(original[j]!)) j++;
      if (out.length > 0 && out[out.length - 1] !== ' ') {
        out.push(' ');
        map.push(i);
      }
      i = j;
      continue;
    }
    if (isHyphen(ch) && isLetter(original[i - 1])) {
      // Line-break hyphenation: letter, hyphen, whitespace containing a newline, letter.
      let j = i + 1;
      let newline = false;
      while (j < n && isSpace(original[j]!)) {
        if (original[j] === '\n' || original[j] === '\r') newline = true;
        j++;
      }
      if (newline && isLetter(original[j])) {
        i = j;
        continue;
      }
    }
    let c = ch;
    if (isHyphen(c)) c = '-';
    else if (/[\u2018\u2019]/.test(c)) c = "'";
    else if (/[\u201c\u201d]/.test(c)) c = '"';
    const lower = c.toLowerCase();
    out.push(lower.length === 1 ? lower : c);
    map.push(i);
    i++;
  }
  if (out[out.length - 1] === ' ') {
    out.pop();
    map.pop();
  }
  return { text: out.join(''), map };
}

export type Located = { start: number; end: number; text: string; occurrences: number };

/**
 * Find `excerpt` in `blockText` ignoring case, whitespace runs, typographic
 * dashes/quotes and line-break hyphenation. Offsets index the ORIGINAL block
 * text and `text` is the original slice, so `text === blockText.slice(start, end)`.
 */
export function locateExcerpt(blockText: string, excerpt: string): Located | null {
  const nb = normalizeWithMap(blockText);
  const ne = normalizeWithMap(excerpt);
  if (ne.text.length === 0) return null;
  const first = nb.text.indexOf(ne.text);
  if (first === -1) return null;
  let occurrences = 0;
  for (let at = nb.text.indexOf(ne.text); at !== -1; at = nb.text.indexOf(ne.text, at + 1)) occurrences++;
  const start = nb.map[first]!;
  const end = nb.map[first + ne.text.length - 1]! + 1;
  return { start, end, text: blockText.slice(start, end), occurrences };
}
