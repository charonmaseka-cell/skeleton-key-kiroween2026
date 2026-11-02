import { describe, expect, it } from 'vitest';
import { applyCorrection, confirmDocumentCoverage, emptySession, evaluateSession, type Fixture, type SessionState } from '@skeleton-key/ui';
import { packCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

// Regression tests for the source review of Task 6 (docs/reviews/task-6-source-review.md), PackCheck side.

const pack = FIXTURES[0]!;
const run = (f: Fixture, s: SessionState = emptySession(), at = 1) => evaluateSession(packCheckAdapter, f, s, at);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type Claim = { field: string; kind?: string; excerpt: string; value: unknown; blockId: string };
const claims = (f: Fixture, doc: string) => f.docs.find((d) => d.id === doc)!.claims as Claim[];
const cmp = (v: ReturnType<typeof run>, id: string) => v.evaluation.comparisons.find((c) => c.id === id);
const missing = (v: ReturnType<typeof run>) => v.items.find((i) => i.finding.code === 'attachment.missing' && i.finding.subjectId === 'tax clearance certificate')!;

describe('review #3/#13: an attachment is not declared missing while a listed attachment could be it', () => {
  it('a listed title that differs only by plural is a suggestion, so the omission stays Needs review even after the form is confirmed', () => {
    const f = clone(pack);
    const form = f.docs.find((d) => d.id === 'application-form')!;
    form.blocks.push({ id: 'p1-l99', docId: 'application-form', kind: 'pdf-run', text: 'Attachment provided: Tax clearance certificates', page: 1, bbox: [0, 0, 1, 1] } as never);
    (form.claims as Claim[]).push({ field: 'attachment_title', kind: 'text', blockId: 'p1-l99', excerpt: 'Attachment provided: Tax clearance certificates', value: 'Tax clearance certificates' });
    const v = run(f, confirmDocumentCoverage(emptySession(), 'application-form', 2), 2);
    expect(missing(v).finding).toMatchObject({ state: 'needs_review', reason: 'match_unresolved' });
  });

  it('a listed attachment that was held keeps the omission Needs review, with the held-candidate reason', () => {
    const f = clone(pack);
    (claims(f, 'application-form').find((c) => c.field === 'attachment_title' && c.excerpt.includes('Registration'))!).value = 'Annual report'; // unsupported: held
    const v = run(f, confirmDocumentCoverage(emptySession(), 'application-form', 2), 2);
    expect(missing(v).finding).toMatchObject({ state: 'needs_review', reason: 'held_candidate_in_response' });
  });

  it('control: with nothing held, confirming the form coverage does make it a confirmed omission', () => {
    expect(missing(run(pack, confirmDocumentCoverage(emptySession(), 'application-form', 2), 2)).finding.state).toBe('confirmed');
  });
});

describe('review #8: a counterpart fact that was never extracted is Not evaluated, not silent', () => {
  it('no total budget in the budget document: funding against budget is Not evaluated (no_fact)', () => {
    const f = clone(pack);
    const b = f.docs.find((d) => d.id === 'budget')!;
    b.claims = (b.claims as Claim[]).filter((c) => c.field !== 'total_project_budget');
    expect(cmp(run(f), 'funding_within_budget:application-form~budget')).toMatchObject({ status: 'not_evaluated', blocked: { docId: 'budget', field: 'total_project_budget', reason: 'no_fact' } });
  });
  it('no organisation name in the registration document: that name comparison is Not evaluated (no_fact)', () => {
    const f = clone(pack);
    const r = f.docs.find((d) => d.id === 'registration')!;
    r.claims = [];
    expect(cmp(run(f), 'organisation_name:application-form~registration')).toMatchObject({ status: 'not_evaluated', blocked: { docId: 'registration', field: 'organisation_name', reason: 'no_fact' } });
  });
});

describe('review #4: two values for the same field in the form are never compared as "the first one"', () => {
  it('a second funding claim makes both funding comparisons Not evaluated (multiple candidates)', () => {
    const f = clone(pack);
    const fundingClaim = claims(f, 'application-form').find((c) => c.field === 'funding_requested')!;
    (f.docs.find((d) => d.id === 'application-form')!.claims as Claim[]).push({ field: 'funding_requested', kind: 'money', blockId: fundingClaim.blockId, excerpt: 'R1.6 million', value: { amount: '1600000', currency: 'ZAR' } });
    const v = run(f);
    expect(cmp(v, 'funding_requested:application-form~budget')).toMatchObject({ status: 'not_evaluated', blocked: { reason: 'multiple_candidates' } });
    expect(cmp(v, 'funding_within_budget:application-form~budget')).toMatchObject({ status: 'not_evaluated', blocked: { reason: 'multiple_candidates' } });
    expect(v.items.some((i) => i.finding.code.startsWith('funding.'))).toBe(false);
  });
});

describe('review #9: a result that rests on a typed value is marked', () => {
  it('supplying the ambiguous date marks the date comparison as using a value the user supplied', () => {
    const v0 = run(pack);
    const fact = v0.facts.find((x) => x.docId === 'budget' && x.field === 'project_start_date')!;
    const c = cmp(run(pack, applyCorrection(emptySession(), fact.id, '2026-03-01', undefined, 2), 2), 'project_start_date:application-form~budget')!;
    expect(c).toMatchObject({ status: 'agree', userSupplied: [fact.id] });
  });
});
