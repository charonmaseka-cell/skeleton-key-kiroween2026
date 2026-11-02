import { useCallback, useMemo, useState } from 'react';
import type { Finding, ReviewStatus } from '@skeleton-key/engine';
import {
  applyCorrection,
  confirmDocumentCoverage,
  decideFinding,
  emptySession,
  evaluateSession,
  revertCorrection,
  withReconciledStore,
  withdrawDocumentCoverage,
  type DomainAdapter,
  type Fixture,
  type SessionState,
} from './session-core';

/** In-memory session for one fixture at a time. State per fixture is kept until reset; nothing is stored or sent anywhere. */
export function useSession(adapter: DomainAdapter, fixtures: Fixture[]) {
  const [fixtureId, setFixtureId] = useState(fixtures[0]!.id);
  const [states, setStates] = useState<Record<string, SessionState>>({});
  const [stamp, setStamp] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [announceCount, setAnnounceCount] = useState(0);

  const fixture = fixtures.find((f) => f.id === fixtureId) ?? fixtures[0]!;
  const state = states[fixture.id] ?? emptySession();
  const view = useMemo(() => evaluateSession(adapter, fixture, state, stamp), [adapter, fixture, state, stamp]);

  const update = useCallback(
    (fn: (s: SessionState, at: number) => SessionState, message: string) => {
      const at = Date.now();
      setStates((prev) => {
        const next = fn(prev[fixture.id] ?? emptySession(), at);
        return { ...prev, [fixture.id]: withReconciledStore(next, evaluateSession(adapter, fixture, next, at)) };
      });
      setStamp(at);
      // A trailing no-break space on alternate messages makes an identical consecutive message announce again.
      setAnnounceCount((n) => n + 1);
      setAnnouncement(message + (announceCount % 2 ? '\u00a0' : ''));
    },
    [adapter, fixture, announceCount],
  );

  return {
    fixtures,
    fixture,
    setFixtureId: (id: string) => {
      setFixtureId(id);
      setAnnouncement('');
    },
    state,
    view,
    announcement,
    correct: (factId: string, value: unknown, note?: string) => update((s, at) => applyCorrection(s, factId, value, note, at), 'Correction saved. The original value is kept. Checks have re-run.'),
    revert: (factId: string) => update((s) => revertCorrection(s, factId), 'Correction removed. The document value is back in use. Checks have re-run.'),
    decide: (finding: Finding, status: ReviewStatus, note?: string) => update((s, at) => decideFinding(s, finding, status, note, at), `Decision saved: ${status}.`),
    confirmCoverage: (docId: string) => update((s, at) => confirmDocumentCoverage(s, docId, at), 'Coverage confirmed for this document. Checks have re-run.'),
    withdrawCoverage: (docId: string) => update((s) => withdrawDocumentCoverage(s, docId), 'Coverage confirmation withdrawn. Absences are back to Needs review.'),
    reset: () => {
      setStates((prev) => ({ ...prev, [fixture.id]: emptySession() }));
      setStamp(0);
      setAnnouncement('Session reset to the fixture as loaded.');
    },
  };
}

export type Session = ReturnType<typeof useSession>;
