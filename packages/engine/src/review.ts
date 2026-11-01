import type { Finding } from './findings';

export type ReviewStatus = 'open' | 'accepted' | 'dismissed';

export type ReviewHistoryEntry = {
  status: ReviewStatus;
  note?: string;
  fingerprint: string;
  at: number;
  event: 'decided' | 'reopened';
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
