import type { Finding } from './findings';

export type ReviewStatus = 'open' | 'accepted' | 'dismissed';

export type ReviewHistoryEntry = {
  status: ReviewStatus;
  note?: string;
  fingerprint: string;
  at: number;
  event: 'decided' | 'reopened' | 'noted';
};

export type ReviewDecision = {
  findingId: string;
  /** The finding fingerprint this decision was made against. */
  fingerprint: string;
  status: ReviewStatus;
  note?: string;
  reopened: boolean;
  history: ReviewHistoryEntry[];
};

export type ReviewStore = Record<string, ReviewDecision>;
export type ReviewItem = { finding: Finding; review: ReviewDecision };

export function decide(store: ReviewStore, finding: Finding, status: ReviewStatus, note: string | undefined, at: number): ReviewStore {
  const prev = store[finding.id];
  return {
    ...store,
    [finding.id]: {
      findingId: finding.id,
      fingerprint: finding.fingerprint,
      status,
      note,
      reopened: false,
      history: [...(prev?.history ?? []), { status, note, fingerprint: finding.fingerprint, at, event: 'decided' }],
    },
  };
}

/**
 * Save a note on its own, without changing the decision. The note becomes the current note of the item and is recorded in the decision
 * history (event 'noted') with the status it was written under. An empty note clears it (also recorded). A finding that has no decision
 * yet gets one with status 'open', so a note on an undecided item is kept too.
 */
export function saveNote(store: ReviewStore, finding: Finding, note: string, at: number): ReviewStore {
  const prev = store[finding.id];
  const text = note.trim() || undefined;
  if ((prev?.note ?? undefined) === text) return store; // nothing changed: no history entry
  const status = prev?.status ?? 'open';
  return {
    ...store,
    [finding.id]: {
      findingId: finding.id,
      fingerprint: prev?.fingerprint ?? finding.fingerprint,
      status,
      note: text,
      reopened: prev?.reopened ?? false,
      history: [...(prev?.history ?? []), { status, note: text, fingerprint: prev?.fingerprint ?? finding.fingerprint, at, event: 'noted' }],
    },
  };
}

/**
 * Attach review state to current findings. A decision applies only if made against the
 * same fingerprint; otherwise the finding reopens as 'open' and the old decision and
 * note stay in history (they are never carried forward as the current status).
 */
export function reconcileReview(findings: Finding[], store: ReviewStore, at: number): { items: ReviewItem[]; store: ReviewStore } {
  const next: ReviewStore = { ...store };
  const items = findings.map((finding) => {
    const prev = next[finding.id];
    let review: ReviewDecision;
    if (!prev) {
      review = { findingId: finding.id, fingerprint: finding.fingerprint, status: 'open', reopened: false, history: [] };
    } else if (prev.fingerprint === finding.fingerprint) {
      review = prev;
    } else if (prev.status === 'open') {
      review = { ...prev, fingerprint: finding.fingerprint };
    } else {
      review = {
        findingId: finding.id,
        fingerprint: finding.fingerprint,
        status: 'open',
        note: undefined,
        reopened: true,
        history: [...prev.history, { status: prev.status, note: prev.note, fingerprint: prev.fingerprint, at, event: 'reopened' }],
      };
    }
    next[finding.id] = review;
    return { finding, review };
  });
  return { items, store: next };
}
