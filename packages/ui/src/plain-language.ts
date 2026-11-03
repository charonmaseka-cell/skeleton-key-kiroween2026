import { KNOWN_REASONS, type DomainAdapter, type Fixture } from './session-core';

// Checks that no internal name reaches a person: field keys, document IDs, reason codes, schema IDs and block IDs. Block IDs
// are allowed only inside the evidence detail (elements marked data-evidence-ref). Used by both apps' tests.

/** Internal names of an adapter and its fixtures that must never be shown. */
export function internalNames(adapter: DomainAdapter, fixtures: Fixture[]): { names: string[]; blockIds: string[] } {
  const docIds = fixtures.flatMap((f) => f.docs.map((d) => d.id));
  // Plain-word IDs (budget, requirements, registration) are ordinary words in labels; only IDs that could not be words are checked.
  const idLike = docIds.filter((d) => /[-_\d]/.test(d) || d === 'rfq');
  const names = new Set<string>([
    ...Object.keys(adapter.labels.fields).filter((k) => /_|<=/.test(k)),
    ...idLike,
    ...KNOWN_REASONS(),
    ...fixtures.flatMap((f) => f.docs.map((d) => d.profile)),
  ]);
  return { names: [...names], blockIds: [...new Set(fixtures.flatMap((f) => f.docs.flatMap((d) => d.blocks.map((b) => b.id))))] };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Matches a name as a whole token: not inside a longer word, ID or file name ("quote-a.pdf" is a file name, still a leak). */
const token = (n: string) => new RegExp(`(?<![A-Za-z0-9_-])${esc(n)}(?![A-Za-z0-9_-])`);

/** Every text a person can perceive: text content and accessible names (aria-label), outside the evidence detail. */
export function perceivableText(root: HTMLElement): string[] {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-evidence-ref]').forEach((e) => e.remove());
  const labels = [...clone.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') ?? '');
  // Text node by text node: textContent would run neighbouring elements together ("Field" + "organisation_name") and hide a
  // whole-token match.
  const texts: string[] = [];
  const walk = clone.ownerDocument.createTreeWalker(clone, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) texts.push(n.nodeValue ?? '');
  // In the text and CSV exports the evidence detail is written "(block ID)"; that is the one place a block ID may appear.
  return [...texts, ...labels].map((t) => t.replace(/\(block [^)\s]+\)/g, ''));
}

/** The leaks found, as "name in: ...context..." strings (empty when everything is plain). */
export function findLeaks(root: HTMLElement, names: string[], blockIds: string[]): string[] {
  const out: string[] = [];
  for (const text of perceivableText(root)) {
    for (const n of [...names, ...blockIds]) {
      const m = token(n).exec(text);
      if (m) out.push(`${n} in: ...${text.slice(Math.max(0, m.index - 40), m.index + n.length + 40)}...`);
    }
    // any remaining snake_case key, whatever its source
    const snake = /(?<![A-Za-z0-9_-])[a-z]+(?:_[a-z0-9]+)+(?![A-Za-z0-9_-])/.exec(text);
    if (snake) out.push(`${snake[0]} in: ...${text.slice(Math.max(0, snake.index - 40), snake.index + snake[0].length + 40)}...`);
  }
  return [...new Set(out)];
}
