import type { SessionView, ThemeEntry } from './session-core';

// Séance summary (haunted-ui HU-13, design section 6): one sentence per response document, built from the SAME review items and
// comparison ledger as the summary bar and the export, so the counts cannot disagree with them. Lights off uses the adapter's
// theme names; Lights on uses the plain nouns. Never says "clean", "all clear", "no problems" or "nothing found".

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const list = (parts: string[]): string => (parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

export type SeanceDoc = {
  docId: string;
  docName: string;
  confirmed: number;
  review: number;
  didNotRun: number;
  /** the sentence in the requested mode */
  text: string;
  /** the same sentence in plain words (always available; used for assistive technology and Lights on) */
  plain: string;
};

export type Seance = { docs: SeanceDoc[]; coverage: string | null; confirmed: number; review: number; didNotRun: number };

const noun = (t: ThemeEntry | undefined, n: number, themed: boolean, fallback: [string, string]): string => {
  if (!t) return plural(n, fallback[0], fallback[1]);
  return themed ? plural(n, t.name, t.plural) : plural(n, t.plain, t.plainPlural);
};

function sentence(view: SessionView, docId: string, themed: boolean): { text: string; confirmed: number; review: number; didNotRun: number } {
  const name = view.docName(docId);
  const mine = view.items.filter((i) => i.finding.responseDocId === docId);
  const confirmed = mine.filter((i) => i.finding.state === 'confirmed');
  const review = mine.filter((i) => i.finding.state === 'needs_review');
  const didNotRun = view.evaluation.comparisons.filter((c) => c.status === 'not_evaluated' && c.docs[1] === docId).length;

  const byCode = new Map<string, number>();
  for (const i of confirmed) byCode.set(i.finding.code, (byCode.get(i.finding.code) ?? 0) + 1);
  const parts = [...byCode].map(([code, n]) => noun(view.theme[code], n, themed, ['other finding', 'other findings']));
  const out: string[] = [];
  out.push(confirmed.length === 0 ? `Nothing confirmed so far in ${name}.` : `${list(parts)} confirmed in ${name}.`);

  if (review.length > 0) {
    const codes = new Set(review.map((i) => i.finding.code));
    const only = codes.size === 1 ? view.theme[[...codes][0]!] : undefined;
    const label = themed && only?.review ? plural(review.length, only.review.name, only.review.plural) : only && !themed ? plural(review.length, only.plain, only.plainPlural) : plural(review.length, 'item', 'items');
    out.push(`${label[0]!.toUpperCase()}${label.slice(1)} ${review.length === 1 ? 'needs' : 'need'} review${!themed && only ? ' (not confirmed)' : ''}.`);
  }
  if (didNotRun > 0) out.push(`${plural(didNotRun, 'comparison', 'comparisons')} did not run.`);
  return { text: out.join(' '), confirmed: confirmed.length, review: review.length, didNotRun };
}

/** The response documents: those a comparison or a finding is about (never the reference document itself). */
export function responseDocs(view: SessionView): string[] {
  const ids = new Set<string>();
  for (const c of view.evaluation.comparisons) if (c.docs[1]) ids.add(c.docs[1]);
  for (const i of view.items) if (i.finding.responseDocId) ids.add(i.finding.responseDocId);
  return view.fixture.docs.map((d) => d.id).filter((d) => ids.has(d));
}

export function seanceSentences(view: SessionView, mode: 'on' | 'off'): Seance {
  const themed = mode === 'off';
  const docs = responseDocs(view).map((docId) => {
    const t = sentence(view, docId, themed);
    const p = sentence(view, docId, false);
    return { docId, docName: view.docName(docId), confirmed: t.confirmed, review: t.review, didNotRun: t.didNotRun, text: t.text, plain: p.text };
  });
  // Coverage: any document whose extraction is not confirmed (or not fully processed) makes every absence uncertain.
  const unconfirmed = view.fixture.docs.filter((d) => {
    const c = view.exportModel.coverage.find((x) => x.docId === d.id);
    return !c || c.state === 'unverified' || c.state === 'processing_incomplete';
  }).length;
  const coverage = unconfirmed > 0 ? `Coverage is not confirmed for ${plural(unconfirmed, 'document', 'documents')}: nothing missing is certain until you confirm it.` : null;
  const sum = (k: 'confirmed' | 'review' | 'didNotRun') => docs.reduce((n, d) => n + d[k], 0);
  return { docs, coverage, confirmed: sum('confirmed'), review: sum('review'), didNotRun: sum('didNotRun') };
}
