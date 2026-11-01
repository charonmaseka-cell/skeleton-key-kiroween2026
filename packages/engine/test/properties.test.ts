import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildEffectiveFacts,
  compareQuantities,
  newExtraction,
  resolveMatches,
  runAdapter,
  runRules,
  validateClaim,
  type Adapter,
  type MatchCandidate,
  type Rule,
} from '../src';
import { absenceRule, amountRule, block, fact, okDoc } from './helpers';

describe('properties', () => {
  it('reordering candidates and facts does not change the comparison', () => {
    const cand = fc.record({
      id: fc.string({ minLength: 1, maxLength: 4 }),
      targetId: fc.constantFrom('t1', 't2', 't3'),
      score: fc.double({ min: 0, max: 1, noNaN: true }),
      userDecision: fc.constantFrom(undefined, 'confirmed' as const, 'rejected' as const),
    });
    fc.assert(
      fc.property(fc.array(cand, { maxLength: 8 }), fc.nat(), (raw, seed) => {
        const cands: MatchCandidate[] = raw.map((c) => ({ ...c, subjectId: 'S', responseDocId: 'R', contextId: 'p', source: 'model' }));
        const slot = [{ subjectId: 'S', responseDocId: 'R', contextId: 'p' }];
        const rotated = [...cands.slice(seed % (cands.length || 1)), ...cands.slice(0, seed % (cands.length || 1))].reverse();
        expect(resolveMatches(slot, rotated)).toEqual(resolveMatches(slot, cands));
      }),
    );
    const a = fact({ id: 'a', value: { amount: '1', currency: 'ZAR' } });
    const b = fact({ id: 'b', value: { amount: '2', currency: 'ZAR' } });
    const f1 = runRules([amountRule()], { facts: buildEffectiveFacts([a, b], []), documents: new Map(), matches: [], data: { a: 'a', b: 'b' } });
    const f2 = runRules([amountRule()], { facts: buildEffectiveFacts([b, a], []), documents: new Map(), matches: [], data: { a: 'a', b: 'b' } });
    expect(f2.map((f) => f.fingerprint)).toEqual(f1.map((f) => f.fingerprint));
  });

  it('an unknown unit never yields an exact comparison', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }), fc.constantFrom('kg', null), (x, y, unit) => {
        const r = compareQuantities({ value: String(x), unit: null }, { value: String(y), unit });
        expect(r.result).toBe('incomparable');
      }),
    );
  });

  it('a missing source block never supports a confirmed finding', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (excerpt) => {
        const f = validateClaim({ field: 'amount', kind: 'money', blockId: 'gone', excerpt, value: { amount: '1', currency: 'ZAR' } }, { docId: 'd1', blocks: [block('d1', 'b1', excerpt)] });
        expect(f.status).toBe('needs_review');
        const other = fact({ id: 'o', value: { amount: '2', currency: 'ZAR' } });
        const rule = amountRule();
        const forced = { ...rule, run: (c: Parameters<typeof rule.run>[0]) => rule.run(c).map((d) => ({ ...d, state: 'confirmed' as const })) };
        const out = runRules([forced], { facts: buildEffectiveFacts([f, other], []), documents: new Map(), matches: [], data: { a: f.id, b: 'o' } });
        expect(out.every((x) => x.state === 'needs_review')).toBe(true);
      }),
    );
  });

  it('a failed extraction never becomes a confirmed absence', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }), fc.constantFrom('verified', 'user_confirmed', 'unverified'), (oks, state) => {
        fc.pre(oks.includes(false));
        const ids = oks.map((_, i) => `b${i}`);
        const doc = { ...newExtraction('R', ids, ids.map((id, i) => ({ id: `c${i}`, blockIds: [id], status: oks[i] ? ('ok' as const) : ('failed' as const) }))), coverage: { state } };
        const out = runRules([absenceRule()], {
          facts: new Map(),
          documents: new Map([['R', doc]]),
          matches: resolveMatches([{ subjectId: 'S', responseDocId: 'R', contextId: 'pair' }], []),
          data: { subjects: ['S'], responses: ['R'] },
        });
        expect(out.every((f) => f.state === 'needs_review')).toBe(true);
      }),
    );
  });

  it('the engine accepts different adapters through one interface', () => {
    const mk = (id: string, code: string): Adapter<null> => ({
      id,
      rules: [
        {
          id: `${id}.rule`,
          version: '1',
          run: () => [{ code, severity: 'info', state: 'needs_review', basis: 'presence', contextId: id, subjectId: code, inputs: [], evidence: [], coverage: [], message: code }],
        } satisfies Rule<null>,
      ],
    });
    const ctx = { facts: new Map(), documents: new Map([['d', okDoc('d', ['b'])]]), matches: [], data: null };
    expect(runAdapter(mk('alpha', 'x.one'), ctx).map((f) => f.code)).toEqual(['x.one']);
    expect(runAdapter(mk('beta', 'y.two'), ctx).map((f) => f.code)).toEqual(['y.two']);
  });
});
