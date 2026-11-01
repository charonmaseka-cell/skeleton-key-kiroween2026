import type { DocumentExtraction } from './coverage';
import type { Fact } from './types';

// Extraction issues: everything that went wrong or stayed uncertain during extraction.
// Issues never establish coverage; they are what a person should look at.

export type ExtractionIssue = {
  docId: string;
  kind:
    | 'claim_rejected' // excerpt/value not supported by the source, malformed claim, unknown block (client side)
    | 'claim_ambiguous' // plausible but not identifiable without review
    | 'server_dropped' // dropped by the Worker: unknown block ID, field outside the profile, bad value shape
    | 'chunk_failed' // a request did not complete
    | 'block_oversized' // a block was too large to send, so it was never processed
    | 'block_unprocessed'; // block never offered to a successful chunk
  reason: string;
  count: number;
  factId?: string;
};

const AMBIGUOUS = new Set([
  'multiple_candidates_no_context',
  'ambiguous_candidates',
  'date_format_ambiguous',
  'number_format_ambiguous',
  'currency_ambiguous',
  'unit_not_in_excerpt',
  'excerpt_ambiguous_location',
]);

export function issuesFromFacts(facts: Fact[]): ExtractionIssue[] {
  return facts
    .filter((f) => f.status === 'needs_review')
    .map((f) => ({
      docId: f.docId,
      kind: AMBIGUOUS.has(f.reason ?? '') ? ('claim_ambiguous' as const) : ('claim_rejected' as const),
      reason: f.reason ?? 'unknown',
      count: 1,
      factId: f.id,
    }));
}

export function issuesFromDocument(doc: DocumentExtraction): ExtractionIssue[] {
  const out: ExtractionIssue[] = [];
  for (const c of doc.chunks) {
    if (c.status === 'failed') out.push({ docId: doc.docId, kind: 'chunk_failed', reason: c.id, count: c.blockIds.length });
  }
  const offered = new Set(doc.chunks.filter((c) => c.status === 'ok').flatMap((c) => c.blockIds));
  const missing = doc.blockIds.filter((b) => !offered.has(b));
  if (missing.length > 0) out.push({ docId: doc.docId, kind: 'block_unprocessed', reason: 'not_in_successful_chunk', count: missing.length });
  return out;
}

export function serverDroppedIssue(docId: string, droppedReasons: Record<string, number>): ExtractionIssue[] {
  return Object.entries(droppedReasons)
    .filter(([, n]) => n > 0)
    .map(([reason, count]) => ({ docId, kind: 'server_dropped' as const, reason, count }));
}
