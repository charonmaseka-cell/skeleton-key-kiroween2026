import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCorrection, confirmDocumentCoverage, decideFinding, emptySession, evaluateSession, withReconciledStore, type Fixture, type SessionState } from '@skeleton-key/ui';
import { packCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

// Golden tests: the PackCheck adapter run on the fixture inputs (source blocks + recorded claims).
// Expected outcomes come from the labelled sample manifest, not from the app.

const manifest = JSON.parse(readFileSync(new URL('../../../samples/packcheck/sample.json', import.meta.url), 'utf8')) as { expectedFindings: { code: string; subject: string; response: string; state: string }[]; mustNotFlag: string[] };
const key = (c: string, s: string, r?: string) => `${c}|${s}|${r ?? ''}`;
const pack = FIXTURES[0]!;
const run = (f: Fixture, s: SessionState = emptySession(), at = 1) => evaluateSession(packCheckAdapter, f, s, at);
const states = (v: ReturnType<typeof run>) => new Map(v.items.map((i) => [key(i.finding.code, i.finding.subjectId, i.finding.responseDocId), i.finding.state]));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const cmp = (v: ReturnType<typeof run>, id: string) => v.evaluation.comparisons.find((c) => c.id === id)!;

describe('grant pack', () => {
  const v = run(pack);

  it('produces exactly the expected findings in the expected states, from the fixture inputs', () => {
    const want = new Map(manifest.expectedFindings.map((e) => [key(e.code, e.subject, e.response), e.state]));
    expect(states(v)).toEqual(want);
  });

  it('name inconsistency confirmed; missing attachment and ambiguous date stay Needs review', () => {
    const s = states(v);
    expect(s.get(key('org.name_differs', 'organisation_name', 'budget'))).toBe('confirmed');
    expect(s.get(key('attachment.missing', 'tax clearance certificate', 'application-form'))).toBe('needs_review');
    expect(s.get(key('value.needs_review', 'budget:project_start_date', 'budget'))).toBe('needs_review');
  });

  it('R1.6 million requested against a R2 million budget: both validated, the comparison actually ran, and no funding finding exists', () => {
    const funding = v.facts.find((f) => f.docId === 'application-form' && f.field === 'funding_requested')!;
    const budget = v.facts.find((f) => f.docId === 'budget' && f.field === 'total_project_budget')!;
    expect(funding).toMatchObject({ status: 'validated', value: { amount: '1600000', currency: 'ZAR' } });
    expect(budget).toMatchObject({ status: 'validated', value: { amount: '2000000', currency: 'ZAR' } });
    expect(cmp(v, 'funding_within_budget:application-form~budget')).toMatchObject({ status: 'agree' });
    expect(cmp(v, 'funding_requested:application-form~budget')).toMatchObject({ status: 'agree' });
    for (const code of manifest.mustNotFlag) expect([...states(v).keys()].some((k) => k.startsWith(`${code}|`))).toBe(false);
  });

  it('exactly one comparison could not run: the start date, because the budget date is ambiguous', () => {
    const ne = v.evaluation.comparisons.filter((c) => c.status === 'not_evaluated');
    expect(ne.map((c) => c.id)).toEqual(['project_start_date:application-form~budget']);
    expect(ne[0]).toMatchObject({ reason: 'project_start_date in budget not validated (date_format_ambiguous)', blocked: { docId: 'budget', field: 'project_start_date', reason: 'date_format_ambiguous' } });
    expect(v.exportModel.notEvaluated).toHaveLength(1);
  });

  it('every document stays unverified; the pack contributes no confirmed omission', () => {
    for (const d of v.documents.values()) expect(d.coverage.state).toBe('unverified');
  });
});

describe('rejected critical field (the live failure with the first profile: "R1.6 million" read as 1.6)', () => {
  const f = clone(pack);
  const claim = (f.docs.find((d) => d.id === 'application-form')!.claims as { field: string; value: unknown }[]).find((c) => c.field === 'funding_requested')!;
  claim.value = { amount: '1.6', currency: 'ZAR' };
  const v = run(f);

  it('the funding value is held, enters the Needs-review queue, and is never silently dropped', () => {
    expect(v.facts.find((x) => x.docId === 'application-form' && x.field === 'funding_requested')).toMatchObject({ status: 'needs_review', reason: 'value_not_in_excerpt' });
    expect(states(v).get(key('value.needs_review', 'application-form:funding_requested', 'application-form'))).toBe('needs_review');
  });

  it('every dependent comparison is Not evaluated with the reason and blocked input, and no funding finding appears', () => {
    for (const id of ['funding_requested:application-form~budget', 'funding_within_budget:application-form~budget']) {
      expect(cmp(v, id)).toMatchObject({ status: 'not_evaluated', blocked: { docId: 'application-form', field: 'funding_requested', reason: 'value_not_in_excerpt' } });
    }
    expect([...states(v).keys()].some((k) => k.startsWith('funding.'))).toBe(false);
    expect(v.exportModel.notEvaluated.map((n) => n.id)).toEqual(expect.arrayContaining(['funding_requested:application-form~budget', 'funding_within_budget:application-form~budget']));
  });

  it('supplying the right value as a correction lets the comparisons run (and says the value is user-supplied)', () => {
    const fact = v.facts.find((x) => x.docId === 'application-form' && x.field === 'funding_requested')!;
    const s = withReconciledStore(emptySession(), v);
    const v2 = run(f, applyCorrection(s, fact.id, { amount: '1600000', currency: 'ZAR' }, 'per the printed form', 7), 7);
    expect(cmp(v2, 'funding_within_budget:application-form~budget')).toMatchObject({ status: 'agree' });
    expect(v2.effective.get(fact.id)).toMatchObject({ provenance: 'user_supplied' });
    expect(v2.exportModel.corrections[0]).toMatchObject({ field: 'funding_requested', originalValue: null, correctedValue: { amount: '1600000', currency: 'ZAR' } });
  });
});

describe('review actions', () => {
  it('supplying the ambiguous start date removes its Needs-review item and lets the date comparison run', () => {
    const v0 = run(pack);
    const fact = v0.facts.find((x) => x.docId === 'budget' && x.field === 'project_start_date')!;
    const v = run(pack, applyCorrection(emptySession(), fact.id, '2026-03-01', 'confirmed with the applicant', 4), 4);
    expect(states(v).has(key('value.needs_review', 'budget:project_start_date', 'budget'))).toBe(false);
    expect(cmp(v, 'project_start_date:application-form~budget')).toMatchObject({ status: 'agree' });
    expect(v.evaluation.comparisons.filter((c) => c.status === 'not_evaluated')).toEqual([]);
  });

  it('a supplied date that differs from the form is a real finding, driven by the user value', () => {
    const v0 = run(pack);
    const fact = v0.facts.find((x) => x.docId === 'budget' && x.field === 'project_start_date')!;
    const v = run(pack, applyCorrection(emptySession(), fact.id, '2026-01-03', undefined, 4), 4);
    const f = v.items.find((i) => i.finding.code === 'date.differs')!;
    expect(f.finding.state).toBe('confirmed');
    expect(f.finding.userSuppliedFactIds).toEqual([fact.id]);
  });

  it('accepting a finding is recorded and exported; confirming the form coverage makes the missing attachment a confirmed finding', () => {
    const v0 = run(pack);
    const miss = v0.items.find((i) => i.finding.code === 'attachment.missing')!;
    const s = withReconciledStore(emptySession(), run(pack, decideFinding(emptySession(), miss.finding, 'accepted', 'will request it', 2), 2));
    const decided = run(pack, s, 3);
    expect(decided.exportModel.unresolved.find((e) => e.findingId === miss.finding.id)).toMatchObject({ review: 'accepted', note: 'will request it' });
    const confirmed = run(pack, confirmDocumentCoverage(emptySession(), 'application-form', 5), 5);
    expect(states(confirmed).get(key('attachment.missing', 'tax clearance certificate', 'application-form'))).toBe('confirmed');
  });
});
