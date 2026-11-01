import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCorrection, confirmDocumentCoverage, decideFinding, emptySession, evaluateSession, withReconciledStore, type Fixture, type SessionState } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

// Golden tests: the ScopeCheck adapter run on the fixture inputs (source blocks + recorded claims).
// Expected outcomes come from the labelled sample manifests, not from the apps.

type Manifest = { expectedFindings: { code: string; subject: string; response: string; state: string }[]; docs: { id: string; lines: string[]; facts: { field: string; line: number }[] }[] };
const manifest = (id: string) => JSON.parse(readFileSync(new URL(`../../../samples/${id}/sample.json`, import.meta.url), 'utf8')) as Manifest;
const key = (c: string, s: string, r?: string) => `${c}|${s}|${r ?? ''}`;
const standard = FIXTURES.find((f) => f.id === 'scopecheck-standard')!;
const layout = FIXTURES.find((f) => f.id === 'scopecheck-layout')!;
const run = (f: Fixture, s: SessionState = emptySession(), at = 1) => evaluateSession(scopeCheckAdapter, f, s, at);
/**
 * A stated exclusion is identified by its own source line (`quote-a:p1-l5:exclusion`); the labels name one exclusion per
 * document (`quote-a:exclusion`). A finding is read as the labelled one only when its evidence is in the labelled line.
 */
function labelSubject(f: ReturnType<typeof run>['items'][number]['finding'], fx: Fixture, sampleId: string): string {
  if (f.code !== 'exclusion.stated') return f.subjectId;
  const m = manifest(sampleId);
  const doc = m.docs.find((d) => d.id === f.responseDocId);
  const lines = new Set((doc?.facts ?? []).filter((x) => x.field === 'exclusion').map((x) => doc!.lines[x.line]));
  const blocks = fx.docs.find((d) => d.id === f.responseDocId)?.blocks ?? [];
  const labelled = f.evidence.some((e) => lines.has(blocks.find((b) => b.id === e.evidence.blockId)?.text ?? '\u0000'));
  return labelled ? `${f.responseDocId}:exclusion` : f.subjectId;
}
const states = (v: ReturnType<typeof run>, fx: Fixture = standard, sampleId = 'scopecheck') => new Map(v.items.map((i) => [key(i.finding.code, labelSubject(i.finding, fx, sampleId), i.finding.responseDocId), i.finding.state]));
const settle = (f: Fixture, s: SessionState, at = 1): SessionState => withReconciledStore(s, run(f, s, at));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('standard sample: RFQ and two quotations', () => {
  const v = run(standard);

  it('produces exactly the expected findings, in the expected states, from the fixture inputs', () => {
    const want = new Map(manifest('scopecheck').expectedFindings.map((e) => [key(e.code, e.subject, e.response), e.state]));
    expect(states(v, standard, 'scopecheck')).toEqual(want);
  });

  it('quantity and specification differences are confirmed; the PG-6 omission stays Needs review because coverage is unverified', () => {
    const s = states(v);
    expect(s.get(key('quantity.differs', 'CP-100:quantity', 'quote-a'))).toBe('confirmed');
    expect(s.get(key('spec.differs', 'CP-100:specification', 'quote-b'))).toBe('confirmed');
    expect(s.get(key('item.absent', 'PG-6', 'quote-b'))).toBe('needs_review');
    for (const d of v.documents.values()) expect(d.coverage.state).toBe('unverified');
  });

  it('the shared identity resolver recovered the item codes the extraction left out, each with its own source span', () => {
    const ctx = v.evaluation.context as { identity: { recovered: { docId: string; code: string; codeSpan: { text: string; blockId: string; start: number; end: number } }[] } };
    expect(ctx.identity.recovered.map((r) => `${r.docId}:${r.code}`).sort()).toEqual(['quote-b:CP-100', 'quote-b:MS-20', 'rfq:CP-100', 'rfq:MS-20', 'rfq:PG-6']);
    for (const r of ctx.identity.recovered) {
      const block = v.blocksByDoc.get(r.docId)!.find((b) => b.id === r.codeSpan.blockId)!;
      expect(block.text.slice(r.codeSpan.start, r.codeSpan.end)).toBe(r.code);
    }
  });

  it('the ledger shows what ran and what did not: the PG-6 aspects of quote-b are Not evaluated with a reason', () => {
    const ne = v.evaluation.comparisons.filter((c) => c.status === 'not_evaluated');
    expect(ne.map((c) => c.id).sort()).toEqual(['quantity:PG-6~quote-b', 'specification:PG-6~quote-b']);
    expect(ne.every((c) => !!c.reason && !!c.blocked)).toBe(true);
    expect(v.exportModel.notEvaluated).toHaveLength(2);
  });
});

describe('the rules run on the fixture inputs: change the input and the result changes', () => {
  it('changing the source text and its claim removes the quantity difference', () => {
    const f = clone(standard);
    const qa = f.docs.find((d) => d.id === 'quote-a')!;
    qa.blocks.find((b) => b.text.includes('qty 8 units'))!.text = qa.blocks.find((b) => b.text.includes('qty 8 units'))!.text.replace('qty 8 units', 'qty 10 units');
    const claim = (qa.claims as { field: string; excerpt: string; value: unknown }[]).find((c) => c.field === 'quantity' && c.excerpt === 'qty 8 units')!;
    claim.excerpt = 'qty 10 units';
    claim.value = { value: '10', unit: 'units' };
    const s = states(run(f));
    expect(s.has(key('quantity.differs', 'CP-100:quantity', 'quote-a'))).toBe(false);
    expect(run(f).evaluation.comparisons.find((c) => c.id === 'quantity:CP-100~quote-a')).toMatchObject({ status: 'agree' });
  });

  it('an unsupported claim (value not in its cited text) is held, so its comparison becomes Not evaluated, not a difference', () => {
    const f = clone(standard);
    const claim = (f.docs.find((d) => d.id === 'quote-a')!.claims as { field: string; excerpt: string; value: unknown }[]).find((c) => c.field === 'quantity' && c.excerpt === 'qty 8 units')!;
    claim.value = { value: '80', unit: 'units' };
    const v = run(f);
    expect(states(v).has(key('quantity.differs', 'CP-100:quantity', 'quote-a'))).toBe(false);
    expect(v.evaluation.comparisons.find((c) => c.id === 'quantity:CP-100~quote-a')).toMatchObject({ status: 'not_evaluated' });
  });
});

describe('review: corrections, decisions and reopening', () => {
  it('a correction keeps the original, is labelled user-supplied, and the difference disappears when the corrected value agrees', () => {
    const qa = standard.docs.find((d) => d.id === 'quote-a')!;
    const v0 = run(standard);
    const fact = v0.facts.find((x) => x.docId === 'quote-a' && x.field === 'quantity' && qa.blocks.find((b) => b.id === x.evidence[0]!.blockId)!.text.includes('CP-100'))!;
    const s = settle(standard, applyCorrection(emptySession(), fact.id, { value: '10', unit: 'units' }, 'checked with supplier', 5), 5);
    const v = run(standard, s, 5);
    expect(states(v).has(key('quantity.differs', 'CP-100:quantity', 'quote-a'))).toBe(false);
    expect(v.effective.get(fact.id)).toMatchObject({ provenance: 'user_supplied', value: { value: '10', unit: 'units' } });
    expect(v.effective.get(fact.id)!.fact.value).toEqual({ value: '8', unit: 'units' }); // original preserved
    expect(v.exportModel.corrections).toEqual([{ factId: fact.id, field: 'quantity', originalValue: { value: '8', unit: 'units' }, correctedValue: { value: '10', unit: 'units' }, note: 'checked with supplier', at: 5 }]);
  });

  it('a decision on a finding is reopened when its inputs change, and the earlier decision stays in the history', () => {
    const v0 = run(standard);
    const q = v0.items.find((i) => i.finding.code === 'quantity.differs')!;
    let s = settle(standard, decideFinding(emptySession(), q.finding, 'accepted', 'agreed with buyer', 2), 2);
    expect(run(standard, s, 3).items.find((i) => i.finding.id === q.finding.id)!.review.status).toBe('accepted');
    // change the quote's quantity to another value that still differs: the finding's inputs change
    const qa = standard.docs.find((d) => d.id === 'quote-a')!;
    const fact = v0.facts.find((x) => x.docId === 'quote-a' && x.field === 'quantity' && qa.blocks.find((b) => b.id === x.evidence[0]!.blockId)!.text.includes('CP-100'))!;
    s = settle(standard, applyCorrection(s, fact.id, { value: '9', unit: 'units' }, undefined, 4), 4);
    const after = run(standard, s, 4).items.find((i) => i.finding.id === q.finding.id)!;
    expect(after.review).toMatchObject({ status: 'open', reopened: true });
    expect(after.review.history.map((h) => `${h.event}:${h.status}`)).toEqual(['decided:accepted', 'reopened:accepted']);
  });

  it('confirming coverage is the only way the PG-6 omission becomes a confirmed finding', () => {
    const before = states(run(standard)).get(key('item.absent', 'PG-6', 'quote-b'));
    const after = states(run(standard, confirmDocumentCoverage(emptySession(), 'quote-b', 9), 9)).get(key('item.absent', 'PG-6', 'quote-b'));
    expect([before, after]).toEqual(['needs_review', 'confirmed']);
  });
});

describe('layout sample: free-text quotation (known limitation kept visible)', () => {
  const v = run(layout);

  it('4 of the 5 expected findings; the CP-100 specification difference is a known MISS (the extraction never found that specification)', () => {
    const want = new Map(manifest('scopecheck-layout').expectedFindings.map((e) => [key(e.code, e.subject, e.response), e.state]));
    const got = states(v, layout, 'scopecheck-layout');
    const missing = [...want.keys()].filter((k) => !got.has(k));
    expect(missing).toEqual([key('spec.differs', 'CP-100:specification', 'quote-c')]);
    for (const [k, st] of got) expect(want.get(k), k).toBe(st); // nothing extra, every state as expected
  });

  it('the miss is visible: the comparison is Not evaluated with the reason, and appears in the export', () => {
    const c = v.evaluation.comparisons.find((x) => x.id === 'specification:CP-100~quote-c')!;
    expect(c).toMatchObject({ status: 'not_evaluated', reason: 'no specification fact in quote-c' });
    expect(v.exportModel.notEvaluated.map((n) => n.id)).toContain('specification:CP-100~quote-c');
  });

  it('the PG-6 line has two code-like tokens: identity is uncertain, and it stays Needs review even after coverage is confirmed', () => {
    const confirmed = run(layout, confirmDocumentCoverage(confirmDocumentCoverage(emptySession(), 'quote-c', 3), 'rfq', 3), 3);
    const s = states(confirmed);
    expect(s.get(key('item.identity_uncertain', 'quote-c:p1-l4:item', 'quote-c'))).toBe('needs_review');
    expect(s.get(key('item.absent', 'PG-6', 'quote-c'))).toBe('needs_review');
    expect([...confirmed.items].some((i) => i.finding.state === 'confirmed' && i.finding.code === 'item.absent')).toBe(false);
  });
});
