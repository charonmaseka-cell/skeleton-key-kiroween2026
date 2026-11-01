import { describe, expect, it } from 'vitest';
import {
  buildEffectiveFacts,
  buildExport,
  confirmCoverage,
  decide,
  reconcileReview,
  resolveMatches,
  runRules,
  type Correction,
  type Fact,
  type RuleContext,
} from '../src';
import { absenceRule, amountRule, fact, okDoc } from './helpers';

const absenceCtx = (coverage: 'user' | null = 'user'): RuleContext<{ subjects: string[]; responses: string[] }> => {
  const docs = ['S1', 'S2'].map((id) => {
    const d = okDoc(id, ['b']);
    return coverage ? confirmCoverage(d, 'user') : d;
  });
  return {
    facts: new Map(),
    documents: new Map(docs.map((d) => [d.docId, d])),
    matches: resolveMatches(
      ['S1', 'S2'].map((r) => ({ subjectId: 'ITEM-1', responseDocId: r, contextId: 'pair' })),
      [],
    ),
    data: { subjects: ['ITEM-1'], responses: ['S1', 'S2'] },
  };
};

describe('finding identity', () => {
  it('the same item missing from two responses yields two findings with independent reviews', () => {
    const findings = runRules([absenceRule()], absenceCtx());
    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((f) => f.id)).size).toBe(2);

    const first = reconcileReview(findings, {}, 1);
    const store = decide(first.store, findings[0]!, 'accepted', 'chased supplier', 2);
    const { items } = reconcileReview(findings, store, 3);
    expect(items.map((i) => i.review.status)).toEqual(['accepted', 'open']);
  });

  it('fingerprint changes with coverage, rule version and match state; identity does not', () => {
    const base = runRules([absenceRule('1')], absenceCtx())[0]!;
    const v2 = runRules([absenceRule('2')], absenceCtx())[0]!;
    const unverified = runRules([absenceRule('1')], absenceCtx(null))[0]!;
    expect(v2.id).toBe(base.id);
    expect(v2.fingerprint).not.toBe(base.fingerprint);
    expect(unverified.id).toBe(base.id);
    expect(unverified.fingerprint).not.toBe(base.fingerprint);
    expect(unverified.state).toBe('needs_review');
    expect(runRules([absenceRule('1')], absenceCtx())[0]!.fingerprint).toBe(base.fingerprint); // deterministic
  });

  it('a changed finding reopens; the earlier accepted decision and note stay in history', () => {
    const before = runRules([absenceRule('1')], absenceCtx(null));
    let store = reconcileReview(before, {}, 1).store;
    store = decide(store, before[0]!, 'accepted', 'ok for now', 2);
    // coverage is later confirmed, which changes the finding
    const after = runRules([absenceRule('1')], absenceCtx('user'));
    const { items } = reconcileReview(after, store, 3);
    const item = items.find((i) => i.finding.id === before[0]!.id)!;
    expect(item.review.status).toBe('open');
    expect(item.review.reopened).toBe(true);
    expect(item.review.note).toBeUndefined();
    expect(item.review.history.map((h) => `${h.event}:${h.status}`)).toEqual(['decided:accepted', 'reopened:accepted']);
    expect(item.review.history[0]!.note).toBe('ok for now');
  });

  it('an unchanged finding keeps its decision', () => {
    const fs = runRules([absenceRule()], absenceCtx());
    const store = decide({}, fs[0]!, 'dismissed', 'n/a', 1);
    expect(reconcileReview(fs, store, 2).items[0]!.review).toMatchObject({ status: 'dismissed', reopened: false });
  });
});

describe('corrections', () => {
  const a: Fact = fact({ id: 'a', value: { amount: '100', currency: 'ZAR' } });
  const b: Fact = fact({ id: 'b', docId: 'd2', value: { amount: '150', currency: 'ZAR' }, evidence: [{ docId: 'd2', blockId: 'b9', start: 0, end: 3, text: 'xyz' }] });
  const run = (corrections: Correction[]) =>
    runRules([amountRule()], { facts: buildEffectiveFacts([a, b], corrections), documents: new Map(), matches: [], data: { a: 'a', b: 'b' } });

  it('labels user-supplied inputs and keeps original value and evidence without implying document support', () => {
    const [f] = run([{ factId: 'b', correctedValue: { amount: '100', currency: 'ZAR' }, at: 1 }]);
    expect(f).toBeUndefined(); // corrected value equals a: no difference remains

    const [g] = run([{ factId: 'b', correctedValue: { amount: '175', currency: 'ZAR' }, note: 'per cover letter', at: 1 }]);
    expect(g!.state).toBe('confirmed');
    expect(g!.userSuppliedFactIds).toEqual(['b']);
    const input = g!.inputs.find((i) => i.factId === 'b')!;
    expect(input).toMatchObject({ provenance: 'user_supplied', value: { amount: '175', currency: 'ZAR' }, originalValue: { amount: '150', currency: 'ZAR' } });
    const evForB = g!.evidence.filter((e) => e.factId === 'b');
    expect(evForB).toHaveLength(1);
    expect(evForB[0]!.role).toBe('superseded_original'); // original source kept, not presented as support
    expect(g!.evidence.find((e) => e.factId === 'a')!.role).toBe('document_value');
  });

  it('a correction that changes the finding reopens it', () => {
    const original = run([]);
    const store = decide(reconcileReview(original, {}, 1).store, original[0]!, 'accepted', 'seen', 2);
    const corrected = run([{ factId: 'b', correctedValue: { amount: '175', currency: 'ZAR' }, at: 3 }]);
    expect(corrected[0]!.id).toBe(original[0]!.id);
    const { items } = reconcileReview(corrected, store, 4);
    expect(items[0]!.review).toMatchObject({ status: 'open', reopened: true });
  });

  it('unknown stays unknown: correcting to null is user-supplied but not usable', () => {
    const [f] = run([{ factId: 'b', correctedValue: null, at: 1 }]);
    expect(f).toMatchObject({ state: 'needs_review', reason: 'unknown_value' });
  });

  it('export marks user-supplied values and includes unresolved items beside confirmed ones', () => {
    const fs = run([{ factId: 'b', correctedValue: { amount: '175', currency: 'ZAR' }, at: 1 }]);
    const unresolved = runRules([absenceRule()], absenceCtx(null));
    const all = [...fs, ...unresolved];
    let store = reconcileReview(all, {}, 1).store;
    store = decide(store, fs[0]!, 'accepted', 'checked', 2);
    const { items } = reconcileReview(all, store, 3);
    const corrections: Correction[] = [{ factId: 'b', correctedValue: { amount: '175', currency: 'ZAR' }, at: 1 }];
    const model = buildExport({ items, corrections, facts: buildEffectiveFacts([a, b], corrections), sample: true });
    expect(model.sample).toBe(true);
    expect(model.findings).toHaveLength(1);
    expect(model.unresolved).toHaveLength(2);
    expect(model.unresolved.every((e) => e.state === 'needs_review')).toBe(true);
    expect(model.findings[0]!.userSupplied[0]).toMatchObject({ factId: 'b', originalValue: { amount: '150', currency: 'ZAR' } });
    expect(model.corrections[0]).toMatchObject({ field: 'amount', originalValue: { amount: '150', currency: 'ZAR' }, correctedValue: { amount: '175', currency: 'ZAR' } });
    expect(model.notes).toEqual([{ findingId: fs[0]!.id, note: 'checked' }]);
  });
});

describe('confirmed findings need validated inputs', () => {
  it('an unvalidated input downgrades a confirmed finding to Needs review', () => {
    const bad: Fact = fact({ id: 'a', value: { amount: '100', currency: 'ZAR' }, status: 'needs_review', reason: 'excerpt_not_found', evidence: [] });
    const good: Fact = fact({ id: 'b', value: { amount: '150', currency: 'ZAR' } });
    const rule = amountRule();
    const forced = { ...rule, run: (c: Parameters<typeof rule.run>[0]) => rule.run(c).map((d) => ({ ...d, state: 'confirmed' as const })) };
    const [f] = runRules([forced], { facts: buildEffectiveFacts([bad, good], []), documents: new Map(), matches: [], data: { a: 'a', b: 'b' } });
    expect(f).toMatchObject({ state: 'needs_review', reason: 'unvalidated_input' });
  });
});
