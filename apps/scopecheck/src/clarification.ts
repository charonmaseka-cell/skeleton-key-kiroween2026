import { SAMPLE_MARK, type ReviewItem } from '@skeleton-key/engine';
import type { SessionView } from '@skeleton-key/ui';
import type { ScopeContext } from './adapter';

// Clarification list for each supplier: plain text from the CONFIRMED findings and the UNRESOLVED (Needs review) items about that
// supplier's quotation, each marked, ready to paste into an email. Built from the same review items as the summary and the exports.
//  - A finding the reviewer dismissed is left out; accepted and open ones are in.
//  - Each item says what the tender asks for and what the offer says, in the cited words with their line numbers (never a block ID).
//  - Marks: [CONFIRMED] a difference or stated fact the rules established from validated values; [TO CHECK] something the tool could
//    not establish (a possible omission while coverage is not confirmed, an unclear match or value). A [TO CHECK] item is a question,
//    never an accusation.
//  - Nothing here ranks, compares or recommends suppliers; each list names only its own supplier. No theme names.
//  - Samples carry the same marker as every other export.

const ASK: Record<string, string> = {
  'quantity.differs': 'Please confirm the quantity you are offering.',
  'unit.ambiguous': 'Please state the unit you are quoting in, and the quantity in the unit the tender asks for.',
  'price.arithmetic': 'Please confirm the line total and the unit price.',
  'price.unclear': 'Please explain how the line total is calculated (discount, tax, rounding).',
  'spec.differs': 'Please confirm the specification you are offering.',
  'item.absent': 'Please confirm whether this item is included in your offer.',
  'exclusion.stated': 'Please confirm that this exclusion is intended, and whether an alternative price is available.',
};
const DEFAULT_ASK = 'Please clarify.';

export type ClarificationList = { docId: string; supplier: string; confirmed: number; toCheck: number; text: string };

function evidenceLines(view: SessionView, item: ReviewItem, rfqDocId: string, docId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of item.finding.evidence) {
    const ev = e.evidence;
    const n = view.lineNumber(ev.docId, ev.blockId);
    const where = ev.docId === docId ? `Your offer${n ? `, line ${n}` : ''}` : ev.docId === rfqDocId ? `Tender (${view.docName(ev.docId)}${n ? `, line ${n}` : ''})` : `${view.docName(ev.docId)}${n ? `, line ${n}` : ''}`;
    const line = `   ${where}: "${ev.text}"`;
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

export function clarificationLists(view: SessionView): ClarificationList[] {
  const ctx = view.evaluation.context as ScopeContext | undefined;
  if (!ctx) return [];
  const { rfqDocId, quoteDocIds } = ctx.data;
  return quoteDocIds.map((docId) => {
    const mine = view.items.filter((i) => i.finding.responseDocId === docId && i.review.status !== 'dismissed');
    const confirmed = mine.filter((i) => i.finding.state === 'confirmed');
    const toCheck = mine.filter((i) => i.finding.state === 'needs_review');
    const supplier = view.docName(docId);
    const L: string[] = [];
    if (view.fixture.sample) L.push(SAMPLE_MARK, '');
    L.push(`Clarification list for ${supplier}`, `Against: ${view.docName(rfqDocId)}`, '');
    const block = (items: ReviewItem[], mark: string, start: number) =>
      items.flatMap((i, k) => {
        const f = i.finding;
        const why = f.state === 'needs_review' && f.reason ? [`   Why this is a question: ${view.reasonText(f.reason)}`] : [];
        return [`${start + k}. [${mark}] ${f.message}`, ...evidenceLines(view, i, rfqDocId, docId), ...why, `   ${ASK[f.code] ?? DEFAULT_ASK}`, ''];
      });
    if (confirmed.length) L.push(`CONFIRMED (${confirmed.length}): the documents show this`, '', ...block(confirmed, 'CONFIRMED', 1));
    if (toCheck.length) L.push(`TO CHECK (${toCheck.length}): not established from the documents as read`, '', ...block(toCheck, 'TO CHECK', 1 + confirmed.length));
    if (!confirmed.length && !toCheck.length) L.push('No items to raise with this supplier so far.', '');
    const cov = view.exportModel.coverage.find((c) => c.docId === docId);
    if (cov && (cov.state === 'unverified' || cov.state === 'processing_incomplete')) L.push('Note: the reviewer has not confirmed that every line of this offer was read, so a missing item is listed as TO CHECK, not as a finding.', '');
    L.push('This list is built from the documents as read; comparisons that could not run are not listed.');
    return { docId, supplier, confirmed: confirmed.length, toCheck: toCheck.length, text: L.join('\n') + '\n' };
  });
}
