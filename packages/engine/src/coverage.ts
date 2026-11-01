import type { Fact } from './types';

// Processing completion (every chunk request succeeded) is NOT extraction coverage
// (the model found every item). Absence conclusions need both.

export type ChunkRecord = { id: string; blockIds: string[]; status: 'ok' | 'failed' };
export type CoverageState = 'unverified' | 'verified' | 'user_confirmed';

export type DocumentExtraction = {
  docId: string;
  blockIds: string[];
  chunks: ChunkRecord[];
  coverage: { state: CoverageState; note?: string };
};

export function newExtraction(docId: string, blockIds: string[], chunks: ChunkRecord[]): DocumentExtraction {
  return { docId, blockIds, chunks, coverage: { state: 'unverified' } };
}

export function processingComplete(doc: DocumentExtraction): boolean {
  if (doc.blockIds.length === 0 || doc.chunks.some((c) => c.status !== 'ok')) return false;
  const offered = new Set(doc.chunks.flatMap((c) => c.blockIds));
  return doc.blockIds.every((b) => offered.has(b));
}

export const coverageVerified = (doc: DocumentExtraction): boolean =>
  doc.coverage.state === 'verified' || doc.coverage.state === 'user_confirmed';

export type AbsenceBlocker = 'processing_incomplete' | 'coverage_unverified';

export function absenceBlocker(doc: DocumentExtraction): AbsenceBlocker | null {
  if (!processingComplete(doc)) return 'processing_incomplete';
  if (!coverageVerified(doc)) return 'coverage_unverified';
  return null;
}

export const absenceAllowed = (doc: DocumentExtraction): boolean => absenceBlocker(doc) === null;

/** Record that coverage was verified by a deterministic check or explicitly confirmed by the user. */
export function confirmCoverage(doc: DocumentExtraction, by: 'check' | 'user', note?: string): DocumentExtraction {
  if (!processingComplete(doc)) throw new Error('Cannot confirm coverage of an incompletely processed document');
  return { ...doc, coverage: { state: by === 'user' ? 'user_confirmed' : 'verified', note } };
}

/** Blocks that no extracted fact cites: what the user should look at before confirming coverage. */
export function uncoveredBlocks(doc: DocumentExtraction, facts: Fact[]): string[] {
  const cited = new Set(facts.filter((f) => f.docId === doc.docId).flatMap((f) => f.evidence.map((e) => e.blockId)));
  return doc.blockIds.filter((b) => !cited.has(b));
}
