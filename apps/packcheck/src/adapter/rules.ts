import {
  compareAmounts,
  compareNames,
  concludeAbsence,
  coverageSnapshot,
  dedupeDrafts,
  describeInputs,
  formatValue,
  makeDraft,
  nameTokens,
  resolveMatches,
  type DocumentExtraction,
  type EffectiveFact,
  type FindingDraft,
  type MatchCandidate,
  type PlannedComparison,
  type Rule,
  type RuleContext,
} from '@skeleton-key/engine';

// PackCheck adapter rules: grant-application completeness and consistency. Used by the PackCheck
// app and by the benchmark (tools/benchmark). Grant logic stays here, never in the engine.

const norm = (v: unknown) => nameTokens(String(v ?? '')).join(' ');

// ---------------- PackCheck ----------------

export type PackData = {
  requirementsDocId: string;
  formDocId: string;
  otherDocIds: string[];
  /** document role by ID, used to plan the comparisons each supporting document is expected to support */
  roles?: Record<string, string>;
};

/** Which supporting-document roles are expected to carry each cross-checked field. */
const EXPECTED_IN: Record<string, string[]> = {
  organisation_name: ['budget', 'registration'],
  funding_requested: ['budget'],
  project_start_date: ['budget'],
  project_end_date: ['budget'],
  total_project_budget: ['budget'],
};
const isExpected = (data: PackData, docId: string, field: string) => !!data.roles && (EXPECTED_IN[field] ?? []).includes(data.roles[docId] ?? '');

/** Singular/plural and case differences are not different attachments: containment of stemmed tokens. */
const stems = (v: unknown) => new Set(nameTokens(String(v ?? '')).map((t) => t.replace(/s$/, '')));
function similar(a: unknown, b: unknown): number {
  const x = stems(a);
  const y = stems(b);
  if (x.size === 0 || y.size === 0) return 0;
  let n = 0;
  for (const t of x) if (y.has(t)) n++;
  return n / Math.min(x.size, y.size);
}

const factsOf = (facts: Map<string, EffectiveFact>, docId: string, field: string) =>
  [...facts.values()].filter((e) => e.fact.docId === docId && e.fact.field === field);

export function packMatches(facts: Map<string, EffectiveFact>, data: PackData) {
  const slots: { subjectId: string; responseDocId: string; contextId: string }[] = [];
  const candidates: MatchCandidate[] = [];
  const listed = factsOf(facts, data.formDocId, 'attachment_title').filter((e) => e.usable);
  for (const req of factsOf(facts, data.requirementsDocId, 'attachment_title').filter((e) => e.usable)) {
    const key = norm(req.value);
    slots.push({ subjectId: key, responseDocId: data.formDocId, contextId: 'required-vs-listed' });
    for (const l of listed) {
      if (norm(l.value) === key) candidates.push({ id: `${key}:${l.fact.id}`, subjectId: key, responseDocId: data.formDocId, contextId: 'required-vs-listed', targetId: l.fact.id, score: 1, source: 'key', keyAgreement: true });
      else if (similar(req.value, l.value) >= 0.7) candidates.push({ id: `${key}:${l.fact.id}:lex`, subjectId: key, responseDocId: data.formDocId, contextId: 'required-vs-listed', targetId: l.fact.id, score: similar(req.value, l.value), source: 'lexical' });
    }
  }
  return resolveMatches(slots, candidates);
}

const CRITICAL_FIELDS = new Set(['organisation_name', 'funding_requested', 'total_project_budget', 'project_start_date', 'project_end_date']);

const why = (e: EffectiveFact | undefined, doc: string, field: string) =>
  !e ? `no ${field} fact in ${doc}` : `${field} in ${doc} not validated (${e.fact.reason ?? e.fact.status})`;
const blockedBy = (e: EffectiveFact | undefined, doc: string, field: string) => ({ docId: doc, field, reason: e ? (e.fact.reason ?? e.fact.status) : 'no_fact', ...(e ? { factId: e.fact.id } : {}) });

/** Human-readable value for ledger details (shared formatter from the engine). */
export const showValue = formatValue;

export function evaluatePack(ctx: RuleContext<PackData>): { drafts: FindingDraft[]; comparisons: PlannedComparison[] } {
  const out: FindingDraft[] = [];
  const comparisons: PlannedComparison[] = [];
  const { formDocId, requirementsDocId, otherDocIds } = ctx.data;
  const formDoc = ctx.documents.get(formDocId) as DocumentExtraction;

  // Required attachments vs those the form lists (absence needs verified coverage of the form).
  for (const req of factsOf(ctx.facts, requirementsDocId, 'attachment_title')) {
    const key = norm(req.value);
    const base = { check: 'attachment_listed' as const, field: `attachment: ${showValue(req.value)}`, docs: [requirementsDocId, formDocId] };
    if (!req.usable) {
      comparisons.push({ ...base, id: `attachment_listed:${req.fact.id}`, status: 'not_evaluated', reason: why(req, requirementsDocId, 'attachment_title'), blocked: blockedBy(req, requirementsDocId, 'attachment_title') });
      continue;
    }
    const m = ctx.matches.find((x) => x.subjectId === key && x.responseDocId === formDocId);
    if (!m) continue;
    const verdict = concludeAbsence(m, formDoc);
    if (verdict.kind === 'absent') {
      const d = describeInputs([req]);
      // A listed attachment that was held could be this one: keep the omission Needs review.
      const heldCandidate = factsOf(ctx.facts, formDocId, 'attachment_title').some((e) => !e.usable);
      const state = verdict.state === 'confirmed' && heldCandidate ? 'needs_review' : verdict.state;
      const reason = verdict.state === 'confirmed' && heldCandidate ? 'held_candidate_in_response' : verdict.reason;
      out.push(makeDraft({ contextId: 'required-vs-listed', responseDocId: formDocId, code: 'attachment.missing', severity: 'critical', state, basis: 'absence', subjectId: key, message: `Required attachment not listed in form: ${key}`, reason, matchStatus: m.status, inputs: d.inputs, evidence: d.evidence, coverage: [coverageSnapshot(formDoc)] }));
    }
    comparisons.push({ ...base, id: `attachment_listed:${key}`, status: verdict.kind === 'absent' ? 'flagged' : 'agree', reason: verdict.kind === 'absent' ? verdict.reason : undefined, detail: `${showValue(req.value)} ${verdict.kind === 'absent' ? 'not listed in' : 'listed in'} ${formDocId}` });
  }

  // Equivalent fields compared across documents, anchored on the application form.
  const compare = (field: string, code: string, kind: 'name' | 'amount' | 'date') => {
    const anchors = factsOf(ctx.facts, formDocId, field);
    const anchor = anchors.length === 1 ? anchors[0] : undefined;
    for (const docId of otherDocIds) {
      const others = factsOf(ctx.facts, docId, field);
      if (anchors.length > 1) {
        // Two values for the same field in the form: never compare "the first one".
        comparisons.push({ check: 'field_equivalence', field, docs: [formDocId, docId], id: `${field}:${formDocId}~${docId}`, status: 'not_evaluated', reason: `more than one ${field} in ${formDocId}; it is not clear which to compare`, blocked: { docId: formDocId, field, reason: 'multiple_candidates' } });
        continue;
      }
      if (others.length === 0 && isExpected(ctx.data, docId, field)) {
        comparisons.push({ check: 'field_equivalence', field, docs: [formDocId, docId], id: `${field}:${formDocId}~${docId}`, status: 'not_evaluated', reason: `no ${field} fact in ${docId}`, blocked: { docId, field, reason: 'no_fact' } });
        continue;
      }
      for (const other of others) {
        const cmp = { check: 'field_equivalence' as const, field, docs: [formDocId, docId], id: others.length > 1 ? `${field}:${formDocId}~${docId}#${other.fact.id}` : `${field}:${formDocId}~${docId}` };
        if (!anchor?.usable || !other.usable) {
          // surfaced in the Needs-review pass below; the comparison itself did not run
          comparisons.push({ ...cmp, status: 'not_evaluated', reason: !anchor?.usable ? why(anchor, formDocId, field) : why(other, docId, field), blocked: !anchor?.usable ? blockedBy(anchor, formDocId, field) : blockedBy(other, docId, field) });
          continue;
        }
        let state: 'confirmed' | 'needs_review' | null = null;
        let reason: string | undefined;
        if (kind === 'name') {
          const c = compareNames(String(anchor.value), String(other.value));
          if (c === 'different') state = 'confirmed';
          else if (c === 'legal_form_differs') {
            state = 'needs_review';
            reason = 'legal_form_differs';
          }
        } else if (kind === 'amount') {
          const c = compareAmounts(anchor.value as never, other.value as never);
          if (c.result === 'different') state = 'confirmed';
          else if (c.result === 'incomparable') {
            state = 'needs_review';
            reason = c.reason;
          }
        } else if (anchor.value !== other.value) state = 'confirmed';
        comparisons.push({ ...cmp, status: state ? 'flagged' : 'agree', reason, userSupplied: [anchor, other].filter((x) => x.provenance === 'user_supplied').map((x) => x.fact.id), detail: `${showValue(anchor.value)} <-> ${showValue(other.value)}` });
        if (!state) continue;
        const d = describeInputs([anchor, other]);
        out.push(makeDraft({ contextId: 'form-vs-supporting', responseDocId: docId, code, severity: 'critical', state, subjectId: field, message: `${field} differs between ${formDocId} and ${docId}`, reason, inputs: d.inputs, evidence: d.evidence }));
      }
    }
  };
  compare('organisation_name', 'org.name_differs', 'name');
  compare('funding_requested', 'funding.differs', 'amount');
  compare('project_start_date', 'date.differs', 'date');
  compare('project_end_date', 'date.differs', 'date');

  // Every critical-field value that was held (ambiguous, unsupported, rejected) enters the Needs-review
  // queue as a finding. Comparisons that depend on it are recorded above as not_evaluated.
  for (const e of ctx.facts.values()) {
    if (e.fact.status === 'needs_review' && e.provenance === 'document' && CRITICAL_FIELDS.has(e.fact.field)) {
      const d = describeInputs([e]);
      out.push(makeDraft({ contextId: 'values', responseDocId: e.fact.docId, code: 'value.needs_review', severity: 'warning', state: 'needs_review', subjectId: `${e.fact.docId}:${e.fact.field}`, message: `${e.fact.field} needs review`, reason: e.fact.reason, inputs: d.inputs, evidence: d.evidence }));
    }
  }

  // Additional rule only: funding must not exceed the total budget (same currency, both validated).
  const fundings = factsOf(ctx.facts, formDocId, 'funding_requested');
  const funding = fundings.length === 1 ? fundings[0] : undefined;
  for (const docId of otherDocIds) {
    const budgets = factsOf(ctx.facts, docId, 'total_project_budget');
    const budget = budgets.length === 1 ? budgets[0] : undefined;
    const cmp = { check: 'funding_within_budget' as const, field: 'funding_requested<=total_project_budget', docs: [formDocId, docId], id: `funding_within_budget:${formDocId}~${docId}` };
    if (budgets.length === 0 && !isExpected(ctx.data, docId, 'total_project_budget')) continue;
    if (budgets.length === 0) {
      comparisons.push({ ...cmp, status: 'not_evaluated', reason: `no total_project_budget fact in ${docId}`, blocked: { docId, field: 'total_project_budget', reason: 'no_fact' } });
      continue;
    }
    if (fundings.length > 1 || budgets.length > 1) {
      const doc2 = fundings.length > 1 ? formDocId : docId;
      comparisons.push({ ...cmp, status: 'not_evaluated', reason: `more than one value in ${doc2}; it is not clear which to compare`, blocked: { docId: doc2, field: fundings.length > 1 ? 'funding_requested' : 'total_project_budget', reason: 'multiple_candidates' } });
      continue;
    }
    if (!funding?.usable || !budget?.usable) {
      comparisons.push({ ...cmp, status: 'not_evaluated', reason: !funding?.usable ? why(funding, formDocId, 'funding_requested') : why(budget, docId, 'total_project_budget'), blocked: !funding?.usable ? blockedBy(funding, formDocId, 'funding_requested') : blockedBy(budget, docId, 'total_project_budget') });
      continue;
    }
    const f = funding.value as { amount: string; currency: string | null };
    const b = budget.value as { amount: string; currency: string | null };
    if (!f.currency || !b.currency || f.currency !== b.currency) {
      comparisons.push({ ...cmp, status: 'not_evaluated', reason: 'currency_not_comparable', blocked: { docId, field: 'total_project_budget', reason: 'currency_not_comparable' } });
      continue;
    }
    const exceeds = Number(f.amount) > Number(b.amount);
    comparisons.push({ ...cmp, status: exceeds ? 'flagged' : 'agree', userSupplied: [funding, budget].filter((x) => x.provenance === 'user_supplied').map((x) => x.fact.id), detail: `requested ${showValue(f)} <= budget ${showValue(b)}` });
    if (exceeds) {
      const d = describeInputs([funding, budget]);
      out.push(makeDraft({ contextId: 'budget', responseDocId: docId, code: 'funding.exceeds_budget', severity: 'critical', state: 'confirmed', subjectId: 'funding_vs_budget', message: 'Funding requested exceeds the total project budget', inputs: d.inputs, evidence: d.evidence }));
    }
  }
  return { drafts: dedupeDrafts(out), comparisons };
}

export const packRule: Rule<PackData> = {
  id: 'bench.pack',
  version: '2',
  run(ctx: RuleContext<PackData>) {
    return evaluatePack(ctx).drafts;
  },
};
