import { locateExcerpt } from './text';
import type { Block, Evidence } from './types';

export type EvidenceResult =
  | { ok: true; evidence: Evidence; occurrences: number }
  | { ok: false; reason: 'block_missing' | 'excerpt_not_found' };

/** Validate a model-supplied excerpt against the real block. Offsets are computed by code. */
export function validateEvidence(block: Block | undefined, excerpt: string): EvidenceResult {
  if (!block) return { ok: false, reason: 'block_missing' };
  const hit = locateExcerpt(block.text, excerpt);
  if (!hit) return { ok: false, reason: 'excerpt_not_found' };
  return {
    ok: true,
    occurrences: hit.occurrences,
    evidence: { docId: block.docId, blockId: block.id, start: hit.start, end: hit.end, text: hit.text },
  };
}

/** True only if the stored excerpt equals the original slice at its offsets. */
export function isEvidenceIntact(evidence: Evidence, blocks: Map<string, Block>): boolean {
  const block = blocks.get(evidence.blockId);
  return (
    block !== undefined &&
    block.docId === evidence.docId &&
    block.text.slice(evidence.start, evidence.end) === evidence.text
  );
}
