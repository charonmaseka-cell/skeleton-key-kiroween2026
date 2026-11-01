import { absenceBlocker, type DocumentExtraction } from './coverage';
import { nameTokens } from './names';

// A score is a heuristic ranking signal, never proof. A match is "verified" only by
// user confirmation or deterministic key agreement supplied by the adapter.

export const DEFAULT_THRESHOLD = 0.7;

export type MatchCandidate = {
  id: string;
  /** The item being looked for (e.g. a requirement) and where it is looked for. */
  subjectId: string;
  responseDocId: string;
  contextId: string;
  targetId: string;
  score: number;
  source: 'model' | 'lexical' | 'key' | 'user';
  /** Adapter-computed exact agreement on a stable identifier. */
  keyAgreement?: boolean;
  userDecision?: 'confirmed' | 'rejected';
};

export type MatchStatus = 'verified' | 'suggested' | 'ambiguous' | 'none';

export type MatchResolution = {
  subjectId: string;
  responseDocId: string;
  contextId: string;
  status: MatchStatus;
  verifiedTargetId?: string;
  candidateTargetIds: string[];
};

export type MatchSlot = { subjectId: string; responseDocId: string; contextId: string };

export function resolveMatches(slots: MatchSlot[], candidates: MatchCandidate[], threshold = DEFAULT_THRESHOLD): MatchResolution[] {
  return slots.map((slot) => {
    const relevant = candidates.filter(
      (c) => c.subjectId === slot.subjectId && c.responseDocId === slot.responseDocId && c.contextId === slot.contextId && c.userDecision !== 'rejected',
    );
    const verified = [...new Set(relevant.filter((c) => c.userDecision === 'confirmed' || c.keyAgreement === true).map((c) => c.targetId))].sort();
    if (verified.length === 1) return { ...slot, status: 'verified', verifiedTargetId: verified[0], candidateTargetIds: verified };
    if (verified.length > 1) return { ...slot, status: 'ambiguous', candidateTargetIds: verified };
    const suggested = [...new Set(relevant.filter((c) => Number.isFinite(c.score) && c.score >= threshold).map((c) => c.targetId))].sort();
    if (suggested.length === 1) return { ...slot, status: 'suggested', candidateTargetIds: suggested };
    if (suggested.length > 1) return { ...slot, status: 'ambiguous', candidateTargetIds: suggested };
    return { ...slot, status: 'none', candidateTargetIds: [] };
  });
}

/** Token-overlap (Jaccard) score for lexical suggestions. Heuristic only. */
export function lexicalScore(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export type AbsenceVerdict =
  | { kind: 'present' }
  | { kind: 'absent'; state: 'confirmed' | 'needs_review'; reason: string };

/**
 * Decide whether "not found" can be stated as fact. Only when matching found
 * nothing AND the response was fully processed AND its coverage was verified or
 * confirmed. Otherwise the item stays Needs review.
 */
export function concludeAbsence(resolution: MatchResolution, doc: DocumentExtraction): AbsenceVerdict {
  if (resolution.status === 'verified') return { kind: 'present' };
  if (resolution.status !== 'none') return { kind: 'absent', state: 'needs_review', reason: 'match_unresolved' };
  const blocker = absenceBlocker(doc);
  return blocker
    ? { kind: 'absent', state: 'needs_review', reason: blocker }
    : { kind: 'absent', state: 'confirmed', reason: 'not_found_in_verified_response' };
}
