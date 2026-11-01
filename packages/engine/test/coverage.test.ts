import { describe, expect, it } from 'vitest';
import {
  absenceBlocker,
  buildEffectiveFacts,
  concludeAbsence,
  confirmCoverage,
  newExtraction,
  processingComplete,
  resolveMatches,
  runRules,
  uncoveredBlocks,
  validateClaims,
} from '../src';
import { absenceRule, block, okDoc } from './helpers';

// Response document with three lines. The model returns claims for lines 1 and 2 only.
const blocks = [
  block('resp', 'l1', 'Item A: 10 units'),
  block('resp', 'l2', 'Item B: 5 units'),
  block('resp', 'l3', 'Item C: 7 units'), // the line the extraction misses
];
const claims = [
  { field: 'qty:A', kind: 'text', blockId: 'l1', excerpt: 'Item A', value: 'Item A' },
  { field: 'qty:B', kind: 'text', blockId: 'l2', excerpt: 'Item B', value: 'Item B' },
];

describe('processing completion is not extraction coverage', () => {
  it('all chunks succeed yet a line was missed: unmatched requirement stays Needs review', () => {
    const doc = okDoc('resp', blocks.map((b) => b.id));
    expect(processingComplete(doc)).toBe(true); // every request succeeded
    const facts = validateClaims(claims, { docId: 'resp', blocks });
    expect(uncoveredBlocks(doc, facts)).toEqual(['l3']); // what the user should look at

    const slot = { subjectId: 'req-C', responseDocId: 'resp', contextId: 'pair' };
    const [res] = resolveMatches([slot], []);
    expect(concludeAbsence(res!, doc)).toEqual({ kind: 'absent', state: 'needs_review', reason: 'coverage_unverified' });

    const findings = runRules([absenceRule()], {
      facts: buildEffectiveFacts(facts, []),
      documents: new Map([['resp', doc]]),
      matches: [res!],
      data: { subjects: ['req-C'], responses: ['resp'] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ state: 'needs_review', reason: 'coverage_unverified', basis: 'absence' });
  });

  it('becomes a confirmed absence only after coverage is confirmed by the user', () => {
    const doc = confirmCoverage(okDoc('resp', ['l1', 'l2', 'l3']), 'user', 'checked all lines');
    const [res] = resolveMatches([{ subjectId: 'req-C', responseDocId: 'resp', contextId: 'pair' }], []);
    expect(concludeAbsence(res!, doc)).toMatchObject({ state: 'confirmed' });
    const [f] = runRules([absenceRule()], {
      facts: new Map(),
      documents: new Map([['resp', doc]]),
      matches: [res!],
      data: { subjects: ['req-C'], responses: ['resp'] },
    });
    expect(f).toMatchObject({ state: 'confirmed', basis: 'absence' });
  });

  it('a failed chunk blocks absence, and coverage cannot be confirmed over it', () => {
    const doc = newExtraction('resp', ['l1', 'l2', 'l3'], [
      { id: 'c1', blockIds: ['l1', 'l2'], status: 'ok' },
      { id: 'c2', blockIds: ['l3'], status: 'failed' },
    ]);
    expect(absenceBlocker(doc)).toBe('processing_incomplete');
    expect(() => confirmCoverage(doc, 'user')).toThrow();
  });

  it('blocks never offered to a chunk are incomplete processing', () => {
    const doc = newExtraction('resp', ['l1', 'l2', 'l3'], [{ id: 'c1', blockIds: ['l1', 'l2'], status: 'ok' }]);
    expect(processingComplete(doc)).toBe(false);
  });

  it('the findings guard downgrades a confirmed absence that lacks verified coverage', () => {
    const doc = okDoc('resp', ['l1', 'l2', 'l3']); // unverified
    const rule = absenceRule();
    const forced = {
      ...rule,
      run: (ctx: Parameters<typeof rule.run>[0]) => rule.run(ctx).map((d) => ({ ...d, state: 'confirmed' as const })),
    };
    const [res] = resolveMatches([{ subjectId: 'req-C', responseDocId: 'resp', contextId: 'pair' }], []);
    const [f] = runRules([forced], {
      facts: new Map(),
      documents: new Map([['resp', doc]]),
      matches: [res!],
      data: { subjects: ['req-C'], responses: ['resp'] },
    });
    expect(f).toMatchObject({ state: 'needs_review', reason: 'absence_requires_verified_coverage' });
  });
});
