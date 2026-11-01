import {
  coverageSnapshot,
  concludeAbsence,
  compareAmounts,
  describeInputs,
  newExtraction,
  type Block,
  type DocumentExtraction,
  type Fact,
  type FindingDraft,
  type Rule,
} from '../src';

export const block = (docId: string, id: string, text: string): Block => ({ id, docId, kind: 'pdf-run', text, page: 1 });

export const fact = (over: Partial<Fact> & Pick<Fact, 'id' | 'value'>): Fact => ({
  docId: 'd1',
  field: 'amount',
  kind: 'money',
  evidence: [{ docId: 'd1', blockId: 'b1', start: 0, end: 4, text: 'abcd' }],
  status: 'validated',
  ...over,
});

export const okDoc = (docId: string, blockIds: string[]): DocumentExtraction =>
  newExtraction(docId, blockIds, [{ id: `${docId}-c1`, blockIds, status: 'ok' }]);

export type AbsenceData = { subjects: string[]; responses: string[] };

/** Neutral test rule: is a subject missing from a response? */
export const absenceRule = (version = '1'): Rule<AbsenceData> => ({
  id: 'test.absence',
  version,
  run(ctx) {
    const drafts: FindingDraft[] = [];
    for (const response of ctx.data.responses) {
      for (const subject of ctx.data.subjects) {
        const m = ctx.matches.find((x) => x.subjectId === subject && x.responseDocId === response)!;
        const doc = ctx.documents.get(response)!;
        const verdict = concludeAbsence(m, doc);
        if (verdict.kind !== 'absent') continue;
        drafts.push({
          code: 'item.absent',
          severity: 'critical',
          state: verdict.state,
          basis: 'absence',
          contextId: 'pair',
          subjectId: subject,
          responseDocId: response,
          inputs: [],
          evidence: [],
          coverage: [coverageSnapshot(doc)],
          matchStatus: m.status,
          message: `${subject} not found in ${response}`,
          reason: verdict.reason,
        });
      }
    }
    return drafts;
  },
});

/** Neutral test rule: do two amount facts differ? */
export const amountRule = (version = '1'): Rule<{ a: string; b: string }> => ({
  id: 'test.amount',
  version,
  run(ctx) {
    const a = ctx.facts.get(ctx.data.a)!;
    const b = ctx.facts.get(ctx.data.b)!;
    const cmp = compareAmounts(a.usable ? (a.value as never) : null, b.usable ? (b.value as never) : null);
    if (cmp.result === 'equal') return [];
    const { inputs, evidence } = describeInputs([a, b]);
    return [
      {
        code: 'amount.differs',
        severity: 'critical',
        state: cmp.result === 'different' ? 'confirmed' : 'needs_review',
        basis: 'presence',
        contextId: 'amounts',
        subjectId: 'amount',
        inputs,
        evidence,
        coverage: [],
        message: 'amounts differ',
        reason: cmp.result === 'incomparable' ? cmp.reason : undefined,
      },
    ];
  },
});
