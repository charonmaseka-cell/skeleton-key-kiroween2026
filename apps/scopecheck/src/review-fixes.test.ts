import { describe, expect, it } from 'vitest';
import { applyCorrection, confirmDocumentCoverage, emptySession, evaluateSession, renderCsvOf, renderTextOf, revertCorrection, type Fixture, type SessionState } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

// Regression tests for the source review of Task 6 (docs/reviews/task-6-source-review.md).
// Each one fails against the behaviour the review reported.

const standard = FIXTURES.find((f) => f.id === 'scopecheck-standard')!;
const run = (f: Fixture, s: SessionState = emptySession(), at = 1) => evaluateSession(scopeCheckAdapter, f, s, at);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type Claim = { field: string; excerpt: string; value: unknown; blockId: string };
const claims = (f: Fixture, doc: string) => f.docs.find((d) => d.id === doc)!.claims as Claim[];
const find = (v: ReturnType<typeof run>, code: string, pred: (i: ReturnType<typeof run>['items'][number]) => boolean = () => true) => v.items.find((i) => i.finding.code === code && pred(i));

describe('review #1: a held RFQ item does not vanish', () => {
  const f = clone(standard);
  claims(f, 'rfq').find((c) => c.field === 'item' && c.excerpt.includes('MS-20'))!.value = 'Gearbox'; // not in its excerpt: held
  const v = run(f);

  it('is a Needs-review finding on the RFQ', () => {
    expect(find(v, 'item.unverified', (i) => i.finding.responseDocId === 'rfq')).toMatchObject({ finding: { state: 'needs_review' } });
  });

  it('every comparison it blocks is Not evaluated, per quotation and per aspect, with the blocked input', () => {
    const held = v.evaluation.comparisons.filter((c) => c.id.includes(':held-'));
    expect(held.map((c) => `${c.field}~${c.docs[1]}`).sort()).toEqual(['quantity~quote-a', 'quantity~quote-b', 'specification~quote-a', 'specification~quote-b']);
    expect(held.every((c) => c.status === 'not_evaluated' && c.blocked?.field === 'item' && c.blocked.docId === 'rfq')).toBe(true);
  });
});

describe('review #2: correcting an item does not leave a stale identity that confirms a false omission', () => {
  it('a typed item name plus confirmed coverage never produces a confirmed absence for a line that is in the quotation', () => {
    const v0 = run(standard);
    const item = v0.facts.find((x) => x.docId === 'rfq' && x.field === 'item' && String(x.evidence[0]!.text).includes('MS-20'))!;
    let s = applyCorrection(emptySession(), item.id, 'Motor starter', undefined, 2);
    s = confirmDocumentCoverage(confirmDocumentCoverage(s, 'quote-a', 3), 'quote-b', 3);
    const v = run(standard, s, 3);
    const absent = v.items.filter((i) => i.finding.code === 'item.absent' && i.finding.state === 'confirmed' && /MOTOR|MS-20/i.test(i.finding.subjectId));
    expect(absent).toEqual([]);
  });

  it('a typed value naming two codes is uncertain, not keyed on the first code in the text', () => {
    const v0 = run(standard);
    const item = v0.facts.find((x) => x.docId === 'rfq' && x.field === 'item' && String(x.evidence[0]!.text).includes('PG-6'))!;
    const v = run(standard, applyCorrection(emptySession(), item.id, 'Pressure gauge PG-6 SANS-1200', undefined, 2), 2);
    expect(find(v, 'item.identity_uncertain', (i) => i.finding.responseDocId === 'rfq')).toBeTruthy();
    expect(find(v, 'item.absent', (i) => i.finding.subjectId === 'SANS-1200')).toBeUndefined();
  });
});

describe('review #3: an omission is not confirmed while the response holds a line that could be the item', () => {
  const f = clone(standard);
  claims(f, 'quote-b').find((c) => c.field === 'item' && c.excerpt.includes('MS-20'))!.value = 'Gearbox'; // held candidate line in quote-b
  it('PG-6 stays Needs review after coverage is confirmed, with the held-candidate reason', () => {
    const v = run(f, confirmDocumentCoverage(emptySession(), 'quote-b', 2), 2);
    expect(find(v, 'item.absent', (i) => i.finding.subjectId === 'PG-6' && i.finding.responseDocId === 'quote-b')!.finding).toMatchObject({ state: 'needs_review', reason: 'held_candidate_in_response' });
  });
  it('control: without the held line, the same confirmation does confirm it', () => {
    const v = run(standard, confirmDocumentCoverage(emptySession(), 'quote-b', 2), 2);
    expect(find(v, 'item.absent', (i) => i.finding.subjectId === 'PG-6')!.finding.state).toBe('confirmed');
  });
});

describe('review #4: a second fact for the same field in one line is never ignored', () => {
  it('two specifications on the CP-100 line: that comparison is Not evaluated (multiple candidates), not "agrees"', () => {
    const f = clone(standard);
    const blk = f.docs.find((d) => d.id === 'quote-a')!.blocks.find((b) => b.text.includes('CP-100'))!;
    (claims(f, 'quote-a') as unknown[]).push({ field: 'specification', kind: 'text', blockId: blk.id, excerpt: 'Centrifugal pump', value: 'Centrifugal pump' });
    const c = run(f).evaluation.comparisons.find((x) => x.id === 'specification:CP-100~quote-a')!;
    expect(c).toMatchObject({ status: 'not_evaluated', blocked: { docId: 'quote-a', field: 'specification', reason: 'multiple_candidates' } });
  });
});

describe('review #6, #9, #17: exports and views keep what supports a result', () => {
  it('a coverage confirmation is exported as asserted by the reviewer, next to the absence it supports', () => {
    const v = run(standard, confirmDocumentCoverage(emptySession(), 'quote-b', 2), 2);
    expect(v.exportModel.coverage.find((c) => c.docId === 'quote-b')).toMatchObject({ confirmedByUser: true, state: 'user_confirmed' });
    expect(v.exportModel.coverage.find((c) => c.docId === 'quote-a')).toMatchObject({ confirmedByUser: false, state: 'unverified' });
    expect(renderTextOf(v)).toMatch(/Quotation QB-04, Birch Industrial Trading: confirmed by the reviewer \(asserted by the reviewer, not checked by the tool\)/);
    expect(renderCsvOf(v)).toMatch(/\ncoverage,/);
  });

  it('a comparison that rests on a typed value says so', () => {
    const v0 = run(standard);
    const fact = v0.facts.find((x) => x.docId === 'quote-a' && x.field === 'quantity' && String(x.evidence[0]!.text).includes('8'))!;
    const v = run(standard, applyCorrection(emptySession(), fact.id, { value: '10', unit: 'units' }, undefined, 2), 2);
    const c = v.evaluation.comparisons.find((x) => x.id === 'quantity:CP-100~quote-a')!;
    expect(c).toMatchObject({ status: 'agree', userSupplied: [fact.id] });
  });

  it('a reverted correction stays in the export history, marked REVERTED', () => {
    const v0 = run(standard);
    const fact = v0.facts.find((x) => x.docId === 'quote-a' && x.field === 'quantity')!;
    let s = applyCorrection(emptySession(), fact.id, { value: '10', unit: 'units' }, 'typo', 2);
    s = revertCorrection(s, fact.id);
    const v = run(standard, s, 3);
    expect(v.effective.get(fact.id)!.provenance).toBe('document');
    expect(v.exportModel.corrections).toEqual([expect.objectContaining({ factId: fact.id, reverted: true, note: 'typo' })]);
    expect(renderTextOf(v)).toMatch(/\(REVERTED\)/);
  });
});

describe('failed or missed chunks can never produce a confirmed absence', () => {
  const failed = clone(standard);
  const q = failed.docs.find((d) => d.id === 'quote-b')!;
  const ids = q.blocks.map((b) => b.id);
  q.chunks = [{ blockIds: ids.slice(0, 2), status: 'ok' }, { blockIds: ids.slice(2), status: 'failed' }];

  it('the document is reported as incompletely processed and a confirmation request does nothing', () => {
    const v = run(failed, confirmDocumentCoverage(emptySession(), 'quote-b', 2), 2);
    expect(v.documents.get('quote-b')!.coverage.state).toBe('unverified');
    expect(v.exportModel.coverage.find((c) => c.docId === 'quote-b')).toMatchObject({ state: 'processing_incomplete', confirmedByUser: false });
  });

  it('the PG-6 omission stays Needs review for the processing reason, however the reviewer acts', () => {
    const v = run(failed, confirmDocumentCoverage(emptySession(), 'quote-b', 2), 2);
    expect(find(v, 'item.absent', (i) => i.finding.subjectId === 'PG-6')!.finding).toMatchObject({ state: 'needs_review' });
    expect(v.items.some((i) => i.finding.code === 'item.absent' && i.finding.state === 'confirmed' && i.finding.responseDocId === 'quote-b')).toBe(false);
  });
});
