import {
  concludeAbsence,
  coverageSnapshot,
  compareQuantities,
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
import { descriptionOverlap, type ItemIdentity } from './identity';

// ScopeCheck adapter rules: RFQ-to-quotation comparison. Used by the ScopeCheck app and by the
// benchmark (tools/benchmark), so what is measured is what ships. Procurement logic stays here,
// never in the engine.

/** `f` is the first fact per field; `all` keeps every fact so duplicates are never silently ignored. */
type Line = { blockId: string; docId: string; f: Record<string, EffectiveFact>; all: Record<string, EffectiveFact[]> };

export function linesOf(facts: Map<string, EffectiveFact>, docId: string): Line[] {
  const byBlock = new Map<string, Line>();
  for (const e of facts.values()) {
    if (e.fact.docId !== docId) continue;
    const blockId = e.fact.evidence[0]?.blockId;
    if (!blockId) continue;
    const line = byBlock.get(blockId) ?? { blockId, docId, f: {}, all: {} };
    line.f[e.fact.field] ??= e;
    (line.all[e.fact.field] ??= []).push(e);
    byBlock.set(blockId, line);
  }
  return [...byBlock.values()];
}

/** Human-readable value for ledger details (shared formatter from the engine). */
export const showValue = formatValue;

export const norm = (v: unknown) => nameTokens(String(v ?? '')).join(' ');
const itemKey = (v: unknown) => (String(v ?? '').match(/[A-Za-z]{1,4}-\d+/)?.[0] ?? norm(v)).toUpperCase();
/** A value typed by the user: if it names more than one code the identity is uncertain, never the first token. */
function typedItemKey(v: unknown): string | null {
  const codes = [...new Set((String(v ?? '').match(/\b[A-Za-z]{1,4}-\d+\b/g) ?? []).map((c) => c.toUpperCase()))];
  return codes.length > 1 ? null : (codes[0] ?? norm(v).toUpperCase());
}
const usable = (e?: EffectiveFact): e is EffectiveFact => !!e && e.usable;
const sameTokens = (a: unknown, b: unknown) => {
  const x = new Set(nameTokens(String(a ?? '')));
  const y = new Set(nameTokens(String(b ?? '')));
  return x.size === y.size && [...x].every((t) => y.has(t));
};


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
  if (!id) return e.provenance === 'document' ? itemKey(e.value) : typedItemKey(e.value);
  if (id.kind === 'code') return id.code;
  if (id.kind === 'description') return id.key.toUpperCase();
  return null;
}

const OVERLAP_SUGGEST = 0.7; // same as the matcher's default threshold

/** Heuristic only (never 'verified'): an item without a firm code may be the same as a nearby line. */
function lexicalCandidate(subjectId: string, q: string, blockId: string, rfqItem: EffectiveFact, offerItem: EffectiveFact, data: ScopeData): MatchCandidate | null {
  const ids = data.identities;
  if (!ids) return null;
  // An identity belongs to the document value. A value the user typed has none (it must not inherit the old code).
  const a = rfqItem.provenance === 'document' ? ids.get(rfqItem.fact.id) : undefined;
  const b = offerItem.provenance === 'document' ? ids.get(offerItem.fact.id) : undefined;
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

export function evaluateScope(ctx: RuleContext<ScopeData>): { drafts: FindingDraft[]; comparisons: PlannedComparison[] } {
    const out: FindingDraft[] = [];
    const comparisons: PlannedComparison[] = [];
    const rfq = linesOf(ctx.facts, ctx.data.rfqDocId).filter((l) => usable(l.f.item));
    // An RFQ item whose extraction was held must not vanish: it is a Needs-review item and every comparison it blocks is Not evaluated.
    for (const l of linesOf(ctx.facts, ctx.data.rfqDocId)) {
      const item = l.f.item;
      if (!item || item.usable) continue;
      const d = describeInputs([item]);
      out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: ctx.data.rfqDocId, code: 'item.unverified', severity: 'warning', state: 'needs_review', subjectId: `${ctx.data.rfqDocId}:${l.blockId}:item`, message: 'Requested item could not be validated', reason: item.fact.reason ?? 'unvalidated_input', inputs: d.inputs, evidence: d.evidence }));
      for (const q of ctx.data.quoteDocIds) {
        for (const field of ['quantity', 'specification']) {
          comparisons.push({ id: `${field}:held-${item.fact.id}~${q}`, check: 'quote_aspect', field, docs: [ctx.data.rfqDocId, q], status: 'not_evaluated', reason: `requested item in ${ctx.data.rfqDocId} not validated (${item.fact.reason ?? 'needs_review'})`, blocked: { docId: ctx.data.rfqDocId, field: 'item', reason: item.fact.reason ?? 'needs_review', factId: item.fact.id } });
        }
      }
    }
    for (const l of rfq) {
      if (itemIdentityKey(l.f.item!, ctx.data.identities) !== null) continue;
      const d = describeInputs([l.f.item!]);
      out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: ctx.data.rfqDocId, code: 'item.identity_uncertain', severity: 'warning', state: 'needs_review', subjectId: `${ctx.data.rfqDocId}:${l.blockId}:item`, message: 'Item identity is uncertain', reason: reasonOf(l.f.item!, ctx.data.identities), inputs: d.inputs, evidence: d.evidence }));
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
          for (const field of ['quantity', 'specification']) {
            comparisons.push({ id: `${field}:${key}~${q}`, check: 'quote_aspect', field, docs: [ctx.data.rfqDocId, q], status: 'not_evaluated', reason: `item not matched in ${q} (${verdict.reason})`, blocked: { docId: q, field: 'item', reason: verdict.reason } });
          }
          const d = describeInputs([r.f.item!]);
          // A line in this quotation that is held, or whose identity is uncertain, could be this item: keep the omission Needs review.
          const candidate = qLines.some((l) => !!l.f.item && (!l.f.item.usable || itemIdentityKey(l.f.item, ctx.data.identities) === null));
          const state = verdict.state === 'confirmed' && candidate ? 'needs_review' : verdict.state;
          const reason = verdict.state === 'confirmed' && candidate ? 'held_candidate_in_response' : verdict.reason;
          out.push(makeDraft({ ...base, code: 'item.absent', severity: 'critical', state, basis: 'absence', subjectId: key, message: `${key} not found in ${q}`, reason, inputs: d.inputs, evidence: d.evidence, coverage: [coverageSnapshot(doc)] }));
          continue;
        }
        const offer = qLines.find((l) => l.blockId === m.verifiedTargetId)!;
        const aspect = (field: string, code: string, equal: (a: EffectiveFact, b: EffectiveFact) => 'equal' | 'different' | 'incomparable', why?: string) => {
          const a = r.f[field];
          const b = offer.f[field];
          const cmp = { id: `${field}:${key}~${q}`, check: 'quote_aspect' as const, field, docs: [ctx.data.rfqDocId, q] };
          // More than one fact for this field in the same line: never compare "the first one" and report agreement.
          const many = (r.all[field]?.length ?? 0) > 1 ? r : (offer.all[field]?.length ?? 0) > 1 ? offer : undefined;
          if (many) {
            const doc2 = many === r ? ctx.data.rfqDocId : q;
            comparisons.push({ ...cmp, status: 'not_evaluated', reason: `more than one ${field} in the same line of ${doc2}; it is not clear which to compare`, blocked: { docId: doc2, field, reason: 'multiple_candidates' } });
            return;
          }
          if (!a || !b) {
            // not silently skipped: the comparison could not run because a side was never extracted
            comparisons.push({ ...cmp, status: 'not_evaluated', reason: `no ${field} fact in ${!a ? ctx.data.rfqDocId : q}`, blocked: { docId: !a ? ctx.data.rfqDocId : q, field, reason: 'no_fact' } });
            return;
          }
          if (!usable(a) || !usable(b)) {
            const held = !usable(a) ? a : b;
            comparisons.push({ ...cmp, status: 'not_evaluated', reason: `${field} in ${held.fact.docId} not validated (${held.fact.reason ?? 'needs_review'})`, blocked: { docId: held.fact.docId, field, reason: held.fact.reason ?? 'needs_review', factId: held.fact.id } });
            const d = describeInputs([a, b]);
            out.push(makeDraft({ ...base, code: `${field}.unverified`, severity: 'warning', state: 'needs_review', subjectId: `${key}:${field}`, message: `${field === 'quantity' ? 'Quantity' : 'Specification'} for ${key} in ${q} needs review`, reason: 'unvalidated_input', inputs: d.inputs, evidence: d.evidence }));
            return;
          }
          const verdict2 = equal(a, b);
          comparisons.push({ ...cmp, status: verdict2 === 'equal' ? 'agree' : 'flagged', reason: verdict2 === 'incomparable' ? 'incomparable' : undefined, userSupplied: [a, b].filter((x) => x.provenance === 'user_supplied').map((x) => x.fact.id), detail: `${showValue(a.value)} <-> ${showValue(b.value)}` });
          if (verdict2 === 'equal') return;
          const d = describeInputs([a, b]);
          out.push(makeDraft({ ...base, code, severity: 'critical', state: verdict2 === 'different' ? 'confirmed' : 'needs_review', subjectId: `${key}:${field}`, message: why ?? `${field === 'quantity' ? 'Quantity' : 'Specification text'} ${verdict2 === 'different' ? 'differs' : 'cannot be compared'} for ${key} in ${q}`, reason: verdict2 === 'incomparable' ? 'incomparable' : undefined, inputs: d.inputs, evidence: d.evidence }));
        };
        aspect('quantity', 'quantity.differs', (a, b) => compareQuantities(a.value as never, b.value as never).result);
        aspect('specification', 'spec.differs', (a, b) => (sameTokens(a.value, b.value) ? 'equal' : 'different'));
      }
      for (const l of qLines) {
        const ex = l.f.exclusion;
        if (usable(ex)) {
          const d = describeInputs([ex]);
          out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: q, code: 'exclusion.stated', severity: 'info', state: 'confirmed', subjectId: `${q}:exclusion`, message: `Exclusion stated in ${q} (unpriced)`, inputs: d.inputs, evidence: d.evidence }));
        }
      }
      // Uncertain identity (several possible codes, or evidence that does not check out) is never guessed.
      for (const l of qLines) {
        const item = l.f.item;
        if (item?.usable && itemIdentityKey(item, ctx.data.identities) === null) {
          const d = describeInputs([item]);
          out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: q, code: 'item.identity_uncertain', severity: 'warning', state: 'needs_review', subjectId: `${q}:${l.blockId}:item`, message: 'Item identity is uncertain', reason: reasonOf(item, ctx.data.identities), inputs: d.inputs, evidence: d.evidence }));
        }
      }
      // Items the quote lists whose item fact is not usable: keep visible rather than silent.
      for (const l of qLines) {
        const item = l.f.item;
        if (item && !item.usable) {
          const d = describeInputs([item]);
          out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: q, code: 'item.unverified', severity: 'warning', state: 'needs_review', subjectId: `${q}:${l.blockId}:item`, message: 'Item could not be validated', reason: item.fact.reason, inputs: d.inputs, evidence: d.evidence }));
        }
      }
    }
    return { drafts: dedupeDrafts(out), comparisons };
}

export const scopeRule: Rule<ScopeData> = {
  id: 'bench.scope',
  version: '2',
  run(ctx: RuleContext<ScopeData>) {
    return evaluateScope(ctx).drafts;
  },
};

