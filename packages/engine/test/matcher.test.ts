import { describe, expect, it } from 'vitest';
import { compareAmounts, compareQuantities, concludeAbsence, confirmCoverage, lexicalScore, resolveMatches, type MatchCandidate } from '../src';
import { okDoc } from './helpers';

const slot = { subjectId: 'S', responseDocId: 'R1', contextId: 'pair' };
const cand = (over: Partial<MatchCandidate>): MatchCandidate => ({
  id: 'c', ...slot, targetId: 't1', score: 0.95, source: 'model', ...over,
});

describe('matching', () => {
  it('a score above 0.7 alone is only a suggestion, never verified', () => {
    const [r] = resolveMatches([slot], [cand({ score: 0.99 })]);
    expect(r!.status).toBe('suggested');
    expect(r!.verifiedTargetId).toBeUndefined();
    // a suggested match is not "present" and does not allow an absence conclusion
    const doc = confirmCoverage(okDoc('R1', ['b']), 'user');
    expect(concludeAbsence(r!, doc)).toMatchObject({ kind: 'absent', state: 'needs_review', reason: 'match_unresolved' });
  });

  it('user confirmation or key agreement verifies; rejection removes the candidate', () => {
    expect(resolveMatches([slot], [cand({ score: 0.2, userDecision: 'confirmed' })])[0]).toMatchObject({ status: 'verified', verifiedTargetId: 't1' });
    expect(resolveMatches([slot], [cand({ score: 0.1, keyAgreement: true })])[0]!.status).toBe('verified');
    expect(resolveMatches([slot], [cand({ userDecision: 'rejected' })])[0]!.status).toBe('none');
  });

  it('several plausible targets are ambiguous and stay reviewable', () => {
    const r = resolveMatches([slot], [cand({ id: 'a', targetId: 't1' }), cand({ id: 'b', targetId: 't2', score: 0.8 })])[0]!;
    expect(r.status).toBe('ambiguous');
    expect(r.candidateTargetIds).toEqual(['t1', 't2']);
  });

  it('below-threshold candidates do not count as a match, and slots are independent per response', () => {
    const other = { ...slot, responseDocId: 'R2' };
    const rs = resolveMatches([slot, other], [cand({ score: 0.4 }), cand({ id: 'x', responseDocId: 'R2', userDecision: 'confirmed' })]);
    expect(rs.map((r) => r.status)).toEqual(['none', 'verified']);
  });

  it('lexical score is a bounded heuristic', () => {
    expect(lexicalScore('Centrifugal pump 5kW', 'centrifugal pump 5kw')).toBe(1);
    expect(lexicalScore('pump', 'valve')).toBe(0);
  });
});

describe('comparisons refuse unjustified basis', () => {
  it('unknown unit or currency is incomparable; no conversion', () => {
    expect(compareQuantities({ value: '10', unit: null }, { value: '10', unit: 'kg' }).result).toBe('incomparable');
    expect(compareQuantities({ value: '10', unit: 'kg' }, { value: '10', unit: 'KG' }).result).toBe('equal');
    expect(compareAmounts({ amount: '100', currency: 'ZAR' }, { amount: '100', currency: 'USD' }).result).toBe('incomparable');
    expect(compareAmounts({ amount: '0.1', currency: 'ZAR' }, { amount: '0.10', currency: 'ZAR' }).result).toBe('equal'); // decimal, not float
  });
});
