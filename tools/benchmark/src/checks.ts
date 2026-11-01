import {
  coverageSnapshot,
  compareAmounts,
  compareNames,
  compareQuantities,
  concludeAbsence,
  describeInputs,
  nameTokens,
  resolveMatches,
  runRules,
  type DocumentExtraction,
  type EffectiveFact,
  type Finding,
  type FindingDraft,
  type MatchCandidate,
  type Rule,
  type RuleContext,
} from '@skeleton-key/engine';
import { descriptionOverlap, type ItemIdentity } from '../../../apps/scopecheck/src/adapter/identity';

// Benchmark-local checks, built only from engine primitives, so false critical findings can be
// measured now. Task 6 turns these into the real app adapters.

type Line = { blockId: string; docId: string; f: Record<string, EffectiveFact> };

function linesOf(facts: Map<string, EffectiveFact>, docId: string): Line[] {
  const byBlock = new Map<string, Line>();
  for (const e of facts.values()) {
    if (e.fact.docId !== docId) continue;
    const blockId = e.fact.evidence[0]?.blockId;
    if (!blockId) continue;
    const line = byBlock.get(blockId) ?? { blockId, docId, f: {} };
    line.f[e.fact.field] ??= e;
    byBlock.set(blockId, line);
  }
  return [...byBlock.values()];
}

const norm = (v: unknown) => nameTokens(String(v ?? '')).join(' ');
const itemKey = (v: unknown) => (String(v ?? '').match(/[A-Za-z]{1,4}-\d+/)?.[0] ?? norm(v)).toUpperCase();
const usable = (e?: EffectiveFact): e is EffectiveFact => !!e && e.usable;
const sameTokens = (a: unknown, b: unknown) => {
  const x = new Set(nameTokens(String(a ?? '')));
  const y = new Set(nameTokens(String(b ?? '')));
  return x.size === y.size && [...x].every((t) => y.has(t));
};

// Models can emit duplicate claims; keep one finding per identity instead of failing the run.
const uniq = (drafts: FindingDraft[]): FindingDraft[] => {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const k = `${d.code}|${d.contextId}|${d.subjectId}|${d.responseDocId ?? ''}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
};

const draft = (d: Omit<FindingDraft, 'basis' | 'inputs' | 'evidence' | 'coverage'> & Partial<FindingDraft>): FindingDraft => ({
  basis: 'presence',
  inputs: [],
  evidence: [],
  coverage: [],
  ...d,
});

// ---------------- ScopeCheck ----------------

export type ScopeData = {
  rfqDocId: string;
  quoteDocIds: string[];
  /**
   * Item identities from the ScopeCheck identity step (recovered codes, description-only,
   * uncertain), keyed by fact ID. When absent, the original behaviour applies (key from the value).
   */
  identities?: Map<string, ItemIdentity>;
};

/** The key an item is matched on, or null when its identity is uncertain. */
export function itemIdentityKey(e: EffectiveFact, identities?: Map<string, ItemIdentity>): string | null {
  const id = identities && e.provenance === 'document' ? identities.get(e.fact.id) : undefined;
  if (!id) return itemKey(e.value);
  if (id.kind === 'code') return id.code;
  if (id.kind === 'description') return id.key.toUpperCase();
  return null;
}

const OVERLAP_SUGGEST = 0.7; // same as the matcher's default threshold

/** Heuristic only (never 'verified'): an item without a firm code may be the same as a nearby line. */
function lexicalCandidate(subjectId: string, q: string, blockId: string, rfqItem: EffectiveFact, offerItem: EffectiveFact, data: ScopeData): MatchCandidate | null {
  const ids = data.identities;
  if (!ids) return null;
  const a = ids.get(rfqItem.fact.id);
  const b = ids.get(offerItem.fact.id);
  // Two different firm codes are two different items: never suggest across them.
  if (a?.kind === 'code' && b?.kind === 'code') return null;
  const score = descriptionOverlap(String(rfqItem.value), String(offerItem.value));
  if (score < OVERLAP_SUGGEST) return null;
  return { id: `${subjectId}:${blockId}:lex`, subjectId, responseDocId: q, contextId: 'rfq-vs-quote', targetId: blockId, score, source: 'lexical' };
}

export function scopeMatches(facts: Map<string, EffectiveFact>, data: ScopeData) {
  const rfq = linesOf(facts, data.rfqDocId).filter((l) => usable(l.f.item));
  const slots: { subjectId: string; responseDocId: string; contextId: string }[] = [];
  const candidates: MatchCandidate[] = [];
  for (const q of data.quoteDocIds) {
    const lines = linesOf(facts, q).filter((l) => usable(l.f.item));
    for (const r of rfq) {
      const key = itemIdentityKey(r.f.item!, data.identities);
      if (key === null) continue; // uncertain RFQ item: surfaced as item.identity_uncertain, never matched
      slots.push({ subjectId: key, responseDocId: q, contextId: 'rfq-vs-quote' });
      for (const l of lines) {
        const lk = itemIdentityKey(l.f.item!, data.identities);
        if (lk === key) {
          candidates.push({ id: `${key}:${l.blockId}`, subjectId: key, responseDocId: q, contextId: 'rfq-vs-quote', targetId: l.blockId, score: 1, source: 'key', keyAgreement: true });
        } else {
          const lex = lexicalCandidate(key, q, l.blockId, r.f.item!, l.f.item!, data);
          if (lex) candidates.push(lex);
        }
      }
    }
  }
  return resolveMatches(slots, candidates);
}

const reasonOf = (e: EffectiveFact, ids?: Map<string, ItemIdentity>) => {
  const id = ids?.get(e.fact.id);
  return id?.kind === 'uncertain' ? id.reason : undefined;
};

export const scopeRule: Rule<ScopeData> = {
  id: 'bench.scope',
  version: '1',
  run(ctx: RuleContext<ScopeData>) {
    const out: FindingDraft[] = [];
    const rfq = linesOf(ctx.facts, ctx.data.rfqDocId).filter((l) => usable(l.f.item));
    for (const l of rfq) {
      if (itemIdentityKey(l.f.item!, ctx.data.identities) !== null) continue;
      const d = describeInputs([l.f.item!]);
      out.push(draft({ contextId: 'rfq-vs-quote', responseDocId: ctx.data.rfqDocId, code: 'item.identity_uncertain', severity: 'warning', state: 'needs_review', subjectId: `${ctx.data.rfqDocId}:${l.blockId}:item`, message: 'Item identity is uncertain', reason: reasonOf(l.f.item!, ctx.data.identities), inputs: d.inputs, evidence: d.evidence }));
    }
    for (const q of ctx.data.quoteDocIds) {
      const doc = ctx.documents.get(q) as DocumentExtraction;
      const qLines = linesOf(ctx.facts, q);
      for (const r of rfq) {
        const key = itemIdentityKey(r.f.item!, ctx.data.identities);
        if (key === null) continue; // reported once below as item.identity_uncertain
        const m = ctx.matches.find((x) => x.subjectId === key && x.responseDocId === q)!;
        const verdict = concludeAbsence(m, doc);
        const base = { contextId: 'rfq-vs-quote', responseDocId: q, matchStatus: m.status };
        if (verdict.kind === 'absent') {
          const d = describeInputs([r.f.item!]);
          out.push(draft({ ...base, code: 'item.absent', severity: 'critical', state: verdict.state, basis: 'absence', subjectId: key, message: `${key} not found in ${q}`, reason: verdict.reason, inputs: d.inputs, evidence: d.evidence, coverage: [coverageSnapshot(doc)] }));
          continue;
        }
        const offer = qLines.find((l) => l.blockId === m.verifiedTargetId)!;
        const aspect = (field: string, code: string, equal: (a: EffectiveFact, b: EffectiveFact) => 'equal' | 'different' | 'incomparable', why?: string) => {
          const a = r.f[field];
          const b = offer.f[field];
          if (!a || !b) return;
          if (!usable(a) || !usable(b)) {
            const d = describeInputs([a, b]);
            out.push(draft({ ...base, code: `${field}.unverified`, severity: 'warning', state: 'needs_review', subjectId: `${key}:${field}`, message: `${field} for ${key} needs review`, reason: 'unvalidated_input', inputs: d.inputs, evidence: d.evidence }));
            return;
          }
          const verdict2 = equal(a, b);
          if (verdict2 === 'equal') return;
          const d = describeInputs([a, b]);
          out.push(draft({ ...base, code, severity: 'critical', state: verdict2 === 'different' ? 'confirmed' : 'needs_review', subjectId: `${key}:${field}`, message: why ?? `${field} ${verdict2}`, reason: verdict2 === 'incomparable' ? 'incomparable' : undefined, inputs: d.inputs, evidence: d.evidence }));
        };
        aspect('quantity', 'quantity.differs', (a, b) => compareQuantities(a.value as never, b.value as never).result);
        aspect('specification', 'spec.differs', (a, b) => (sameTokens(a.value, b.value) ? 'equal' : 'different'));
      }
      for (const l of qLines) {
        const ex = l.f.exclusion;
        if (usable(ex)) {
          const d = describeInputs([ex]);
          out.push(draft({ contextId: 'rfq-vs-quote', responseDocId: q, code: 'exclusion.stated', severity: 'info', state: 'confirmed', subjectId: `${q}:exclusion`, message: 'Exclusion stated (unpriced)', inputs: d.inputs, evidence: d.evidence }));
        }
      }
      // Uncertain identity (several possible codes, or evidence that does not check out) is never guessed.
      for (const l of qLines) {
        const item = l.f.item;
        if (item?.usable && itemIdentityKey(item, ctx.data.identities) === null) {
          const d = describeInputs([item]);
          out.push(draft({ contextId: 'rfq-vs-quote', responseDocId: q, code: 'item.identity_uncertain', severity: 'warning', state: 'needs_review', subjectId: `${q}:${l.blockId}:item`, message: 'Item identity is uncertain', reason: reasonOf(item, ctx.data.identities), inputs: d.inputs, evidence: d.evidence }));
        }
      }
      // Items the quote lists whose item fact is not usable: keep visible rather than silent.
      for (const l of qLines) {
        const item = l.f.item;
        if (item && !item.usable) {
          const d = describeInputs([item]);
          out.push(draft({ contextId: 'rfq-vs-quote', responseDocId: q, code: 'item.unverified', severity: 'warning', state: 'needs_review', subjectId: `${q}:${l.blockId}:item`, message: 'Item could not be validated', reason: item.fact.reason, inputs: d.inputs, evidence: d.evidence }));
        }
      }
    }
    return uniq(out);
  },
};

// ---------------- PackCheck ----------------

export type PackData = { requirementsDocId: string; formDocId: string; otherDocIds: string[] };

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
    }
  }
  return resolveMatches(slots, candidates);
}

const CRITICAL_FIELDS = new Set(['organisation_name', 'funding_requested', 'total_project_budget', 'project_start_date', 'project_end_date']);

/**
 * One planned comparison and what happened to it. A comparison whose input is not validated is NOT
 * silently skipped: it is recorded as not_evaluated with the reason, so "no finding" can never be
 * mistaken for "checked and fine". (Requirement carried into the review interface and exports.)
 */
export type Comparison = {
  id: string;
  check: 'field_equivalence' | 'funding_within_budget' | 'attachment_listed';
  field: string;
  docs: string[];
  /** agree = evaluated, nothing to report; flagged = evaluated and produced a finding (confirmed or Needs review); not_evaluated = an input was not validated */
  status: 'agree' | 'flagged' | 'not_evaluated';
  reason?: string;
};

const why = (e: EffectiveFact | undefined, doc: string, field: string) =>
  !e ? `no ${field} fact in ${doc}` : `${field} in ${doc} not validated (${e.fact.reason ?? e.fact.status})`;

export function evaluatePack(ctx: RuleContext<PackData>): { drafts: FindingDraft[]; comparisons: Comparison[] } {
  const out: FindingDraft[] = [];
  const comparisons: Comparison[] = [];
  const { formDocId, requirementsDocId, otherDocIds } = ctx.data;
  const formDoc = ctx.documents.get(formDocId) as DocumentExtraction;

  // Required attachments vs those the form lists (absence needs verified coverage of the form).
  for (const req of factsOf(ctx.facts, requirementsDocId, 'attachment_title')) {
    const key = norm(req.value);
    const base = { check: 'attachment_listed' as const, field: 'attachment_title', docs: [requirementsDocId, formDocId] };
    if (!req.usable) {
      comparisons.push({ ...base, id: `attachment_listed:${req.fact.id}`, status: 'not_evaluated', reason: why(req, requirementsDocId, 'attachment_title') });
      continue;
    }
    const m = ctx.matches.find((x) => x.subjectId === key && x.responseDocId === formDocId);
    if (!m) continue;
    const verdict = concludeAbsence(m, formDoc);
    if (verdict.kind === 'absent') {
      const d = describeInputs([req]);
      out.push(draft({ contextId: 'required-vs-listed', responseDocId: formDocId, code: 'attachment.missing', severity: 'critical', state: verdict.state, basis: 'absence', subjectId: key, message: `Required attachment not listed in form: ${key}`, reason: verdict.reason, matchStatus: m.status, inputs: d.inputs, evidence: d.evidence, coverage: [coverageSnapshot(formDoc)] }));
    }
    comparisons.push({ ...base, id: `attachment_listed:${key}`, status: verdict.kind === 'absent' ? 'flagged' : 'agree', reason: verdict.kind === 'absent' ? verdict.reason : undefined });
  }

  // Equivalent fields compared across documents, anchored on the application form.
  const compare = (field: string, code: string, kind: 'name' | 'amount' | 'date') => {
    const anchor = factsOf(ctx.facts, formDocId, field)[0];
    for (const docId of otherDocIds) {
      for (const other of factsOf(ctx.facts, docId, field)) {
        const cmp = { check: 'field_equivalence' as const, field, docs: [formDocId, docId], id: `${field}:${formDocId}~${docId}` };
        if (!anchor?.usable || !other.usable) {
          // surfaced in the Needs-review pass below; the comparison itself did not run
          comparisons.push({ ...cmp, status: 'not_evaluated', reason: !anchor?.usable ? why(anchor, formDocId, field) : why(other, docId, field) });
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
        comparisons.push({ ...cmp, status: state ? 'flagged' : 'agree', reason });
        if (!state) continue;
        const d = describeInputs([anchor, other]);
        out.push(draft({ contextId: 'form-vs-supporting', responseDocId: docId, code, severity: 'critical', state, subjectId: field, message: `${field} differs between ${formDocId} and ${docId}`, reason, inputs: d.inputs, evidence: d.evidence }));
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
      out.push(draft({ contextId: 'values', responseDocId: e.fact.docId, code: 'value.needs_review', severity: 'warning', state: 'needs_review', subjectId: `${e.fact.docId}:${e.fact.field}`, message: `${e.fact.field} needs review`, reason: e.fact.reason, inputs: d.inputs, evidence: d.evidence }));
    }
  }

  // Additional rule only: funding must not exceed the total budget (same currency, both validated).
  const funding = factsOf(ctx.facts, formDocId, 'funding_requested')[0];
  for (const docId of otherDocIds) {
    const budget = factsOf(ctx.facts, docId, 'total_project_budget')[0];
    if (!budget) continue;
    const cmp = { check: 'funding_within_budget' as const, field: 'funding_requested<=total_project_budget', docs: [formDocId, docId], id: `funding_within_budget:${formDocId}~${docId}` };
    if (!funding?.usable || !budget.usable) {
      comparisons.push({ ...cmp, status: 'not_evaluated', reason: !funding?.usable ? why(funding, formDocId, 'funding_requested') : why(budget, docId, 'total_project_budget') });
      continue;
    }
    const f = funding.value as { amount: string; currency: string | null };
    const b = budget.value as { amount: string; currency: string | null };
    if (!f.currency || !b.currency || f.currency !== b.currency) {
      comparisons.push({ ...cmp, status: 'not_evaluated', reason: 'currency_not_comparable' });
      continue;
    }
    const exceeds = Number(f.amount) > Number(b.amount);
    comparisons.push({ ...cmp, status: exceeds ? 'flagged' : 'agree' });
    if (exceeds) {
      const d = describeInputs([funding, budget]);
      out.push(draft({ contextId: 'budget', responseDocId: docId, code: 'funding.exceeds_budget', severity: 'critical', state: 'confirmed', subjectId: 'funding_vs_budget', message: 'Funding requested exceeds the total project budget', inputs: d.inputs, evidence: d.evidence }));
    }
  }
  return { drafts: uniq(out), comparisons };
}

export const packRule: Rule<PackData> = {
  id: 'bench.pack',
  version: '2',
  run(ctx: RuleContext<PackData>) {
    return evaluatePack(ctx).drafts;
  },
};

export function runChecks(sampleId: string, ctx: RuleContext<ScopeData> | RuleContext<PackData>): Finding[] {
  return sampleId === 'scopecheck' ? runRules([scopeRule], ctx as RuleContext<ScopeData>) : runRules([packRule], ctx as RuleContext<PackData>);
}
