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
export type Line = { blockId: string; docId: string; f: Record<string, EffectiveFact>; all: Record<string, EffectiveFact[]>; /** the fact has no source evidence (its excerpt was not found); it is shown, never given invented evidence */ unplaced?: boolean };

export function linesOf(facts: Map<string, EffectiveFact>, docId: string): Line[] {
  const byBlock = new Map<string, Line>();
  for (const e of facts.values()) {
    if (e.fact.docId !== docId) continue;
    const placed = e.fact.evidence[0]?.blockId;
    const blockId = placed ?? `no-evidence:${e.fact.id}`;
    const line = byBlock.get(blockId) ?? { blockId, docId, f: {}, all: {}, ...(placed ? {} : { unplaced: true }) };
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
/**
 * Leading procurement connectors that introduce a specification without being part of it: "with", "c/w",
 * "complete with" and "incl." (also "incl"). Only a PREFIX is removed, only whole words, and the longest first, so
 * "without", "withstand", "with no ..." (negation kept), numbers, units, standards and qualifiers are never touched.
 */
const LEADING_CONNECTORS = [/^complete\s+with(?=\s|$)/i, /^c\/w(?=\s|$)/i, /^incl\.?(?=\s|$)/i, /^with(?=\s|$)/i];
export function stripLeadingConnectors(text: string): { text: string; removed: string[] } {
  let rest = text.trim();
  const removed: string[] = [];
  for (let guard = 0; guard < 3; guard++) {
    const re = LEADING_CONNECTORS.find((r) => r.test(rest));
    if (!re) break;
    const m = rest.match(re)![0];
    const next = rest.slice(m.length).trim();
    if (next.length === 0) break; // a connector with nothing after it is left alone
    removed.push(m.toLowerCase());
    rest = next;
  }
  return { text: rest, removed };
}
export const sameSpec = (a: unknown, b: unknown): { same: boolean; removed: string[] } => {
  const sa = stripLeadingConnectors(String(a ?? ''));
  const sb = stripLeadingConnectors(String(b ?? ''));
  const x = new Set(nameTokens(sa.text));
  const y = new Set(nameTokens(sb.text));
  return { same: x.size === y.size && [...x].every((t) => y.has(t)), removed: [...sa.removed, ...sb.removed] };
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

export const isMulti = (l: Line) => (l.all.item?.length ?? 0) > 1;

/** One requirement line of the RFQ. `reqId` is unique per line even when two lines name the same item. */
export type Req = { reqId: string; key: string | null; line: Line; sharedBy: number };

/** The RFQ split into requirement lines, lines with several item facts, and lines whose item failed validation. */
export function requirementsOf(facts: Map<string, EffectiveFact>, data: ScopeData): { reqs: Req[]; multi: Line[]; held: Line[]; noItem: Line[] } {
  const lines = linesOf(facts, data.rfqDocId);
  const multi = lines.filter(isMulti);
  const held = lines.filter((l) => !isMulti(l) && l.f.item && !l.f.item.usable);
  // A requirement line that has a quantity or a specification but no item value: its item was never extracted.
  const noItem = lines.filter((l) => !l.unplaced && !l.f.item && (l.f.quantity || l.f.specification));
  const keyed = lines.filter((l) => !isMulti(l) && usable(l.f.item)).map((line) => ({ line, key: itemIdentityKey(line.f.item!, data.identities) }));
  const count = new Map<string, number>();
  for (const { key } of keyed) if (key !== null) count.set(key, (count.get(key) ?? 0) + 1);
  const reqs = keyed.map(({ line, key }): Req => {
    const sharedBy = key === null ? 1 : count.get(key)!;
    return { key, line, sharedBy, reqId: key === null ? `${data.rfqDocId}:${line.blockId}:item` : sharedBy > 1 ? `${key}@${line.blockId}` : key };
  });
  return { reqs, multi, held, noItem };
}

/** A quotation split into lines that can be matched and lines that cannot be (and so may hide the item). */
export function offersOf(facts: Map<string, EffectiveFact>, docId: string, identities?: Map<string, ItemIdentity>) {
  const lines = linesOf(facts, docId);
  const multi = lines.filter(isMulti);
  const matchable = lines.filter((l) => !isMulti(l) && usable(l.f.item) && itemIdentityKey(l.f.item!, identities) !== null);
  // A line with a quantity, specification or price but no item value could be the item: it counts as unresolved.
  const unresolved = lines.filter((l) => isMulti(l) || (!!l.f.item && (!l.f.item.usable || itemIdentityKey(l.f.item, identities) === null)) || (!l.unplaced && !l.f.item && !!(l.f.quantity || l.f.specification || l.f.unit_price)));
  return { lines, multi, matchable, unresolved };
}

/** True when it is not clear which quotation line answers which requirement line. */
export const allocationAmbiguous = (r: Req, sameKeyOffers: number) => (r.sharedBy > 1 && sameKeyOffers >= 1) || (r.sharedBy === 1 && sameKeyOffers > 1);

export function scopeMatches(facts: Map<string, EffectiveFact>, data: ScopeData) {
  const { reqs } = requirementsOf(facts, data);
  const slots: { subjectId: string; responseDocId: string; contextId: string }[] = [];
  const candidates: MatchCandidate[] = [];
  for (const q of data.quoteDocIds) {
    const offers = offersOf(facts, q, data.identities);
    for (const r of reqs) {
      if (r.key === null) continue; // uncertain RFQ item: surfaced as item.identity_uncertain, never matched
      slots.push({ subjectId: r.reqId, responseDocId: q, contextId: 'rfq-vs-quote' });
      // Two requirement lines naming the same item cannot be told apart by key: no candidate is made for them
      // (the allocation is reported as ambiguous, or, with no counterpart, as an absence for each line).
      if (r.sharedBy > 1) continue;
      // Lines of uncertain identity still feed lexical SUGGESTIONS (never a key agreement), so the reason stays "unresolved".
      for (const l of offers.lines.filter((x) => !isMulti(x) && usable(x.f.item))) {
        const lk = itemIdentityKey(l.f.item!, data.identities);
        if (lk !== null && lk === r.key) {
          candidates.push({ id: `${r.reqId}:${l.blockId}`, subjectId: r.reqId, responseDocId: q, contextId: 'rfq-vs-quote', targetId: l.blockId, score: 1, source: 'key', keyAgreement: true });
        } else {
          const lex = lexicalCandidate(r.reqId, q, l.blockId, r.line.f.item!, l.f.item!, data);
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
  const { data } = ctx;
  const ASPECTS = ['quantity', 'specification'] as const;
  const { reqs, multi: rfqMulti, held: rfqHeld, noItem: rfqNoItem } = requirementsOf(ctx.facts, data);

  // An RFQ line whose item failed validation, or that carries several item facts, never vanishes: it is a
  // Needs-review finding (with only the evidence that really exists) and every comparison it blocks is Not evaluated.
  const blockRfq = (line: Line, code: 'item.unverified' | 'item.multiple_items', message: string, reason: string, tag: string) => {
    const facts = code === 'item.multiple_items' ? line.all.item! : [line.f.item!];
    const d = describeInputs(facts);
    out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: data.rfqDocId, code, severity: 'warning', state: 'needs_review', subjectId: `${data.rfqDocId}:${line.blockId}:${code === 'item.multiple_items' ? 'items' : 'item'}`, message, reason, inputs: d.inputs, evidence: d.evidence }));
    for (const q of data.quoteDocIds) {
      for (const field of ASPECTS) {
        comparisons.push({ id: `${field}:${tag}~${q}`, check: 'quote_aspect', field, docs: [data.rfqDocId, q], status: 'not_evaluated', reason: `requested item in ${data.rfqDocId} ${code === 'item.multiple_items' ? 'has several item values in one place' : 'not validated'} (${reason})`, blocked: { docId: data.rfqDocId, field: 'item', reason, ...(facts[0] ? { factId: facts[0].fact.id } : {}) } });
      }
    }
  };
  // A requirement line with a quantity or specification but no item value: visible as Needs review, and its comparisons are
  // Not evaluated with the missing item as the blocked input.
  for (const l of rfqNoItem) {
    const present = Object.values(l.f);
    const d = describeInputs(present);
    out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: data.rfqDocId, code: 'item.missing', severity: 'warning', state: 'needs_review', subjectId: `${data.rfqDocId}:${l.blockId}:item`, message: 'A requirement line has no item value', reason: 'no_item_fact', inputs: d.inputs, evidence: d.evidence }));
    for (const q of data.quoteDocIds) {
      for (const field of ASPECTS) {
        comparisons.push({ id: `${field}:${data.rfqDocId}:${l.blockId}:item~${q}`, check: 'quote_aspect', field, docs: [data.rfqDocId, q], status: 'not_evaluated', reason: `no item value was extracted for this requirement line in ${data.rfqDocId}; it cannot be matched to ${q}`, blocked: { docId: data.rfqDocId, field: 'item', reason: 'no_fact' } });
      }
    }
  }
  for (const l of rfqHeld) blockRfq(l, 'item.unverified', 'Requested item could not be validated', l.f.item!.fact.reason ?? 'unvalidated_input', `held-${l.f.item!.fact.id}`);
  for (const l of rfqMulti) blockRfq(l, 'item.multiple_items', 'Several items were extracted from one requested line', 'multiple_items_in_block', `multi-${l.blockId}`);
  for (const r of reqs) {
    if (r.key !== null) continue;
    const d = describeInputs([r.line.f.item!]);
    const why = reasonOf(r.line.f.item!, data.identities) ?? 'identity_uncertain';
    out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: data.rfqDocId, code: 'item.identity_uncertain', severity: 'warning', state: 'needs_review', subjectId: r.reqId, message: 'Item identity is uncertain', reason: reasonOf(r.line.f.item!, data.identities), inputs: d.inputs, evidence: d.evidence }));
    // Nothing is hidden: every quantity and specification comparison this requirement line would have had is listed as
    // Not evaluated against every quotation, with the input that blocks it (the requirement's own identity).
    for (const q of data.quoteDocIds) {
      for (const field of ASPECTS) {
        comparisons.push({ id: `${field}:${r.reqId}~${q}`, check: 'quote_aspect', field, docs: [data.rfqDocId, q], status: 'not_evaluated', reason: `requested item in ${data.rfqDocId} has an uncertain identity (${why}); it cannot be matched to ${q}`, blocked: { docId: data.rfqDocId, field: 'item', reason: why, factId: r.line.f.item!.fact.id } });
      }
    }
  }

  for (const q of data.quoteDocIds) {
    const doc = ctx.documents.get(q) as DocumentExtraction;
    const offers = offersOf(ctx.facts, q, data.identities);
    const qLines = offers.lines;
    for (const r of reqs) {
      if (r.key === null) continue; // reported once above as item.identity_uncertain
      const sameKey = offers.matchable.filter((l) => itemIdentityKey(l.f.item!, data.identities) === r.key);
      const base = { contextId: 'rfq-vs-quote', responseDocId: q };
      const notEvaluated = (reason: string, why: string) => {
        for (const field of ASPECTS) comparisons.push({ id: `${field}:${r.reqId}~${q}`, check: 'quote_aspect', field, docs: [data.rfqDocId, q], status: 'not_evaluated', reason: why, blocked: { docId: q, field: 'item', reason } });
      };

      if (allocationAmbiguous(r, sameKey.length)) {
        notEvaluated('ambiguous_allocation', `${r.sharedBy} requirement line(s) for ${r.key} and ${sameKey.length} line(s) in ${q}: it is not clear which answers which`);
        const d = describeInputs([r.line.f.item!, ...sameKey.map((l) => l.f.item!)]);
        out.push(makeDraft({ ...base, code: 'item.allocation_ambiguous', severity: 'warning', state: 'needs_review', subjectId: r.reqId, message: `Cannot tell which ${r.key} line in ${q} answers this requirement`, reason: 'ambiguous_allocation', inputs: d.inputs, evidence: d.evidence }));
        continue;
      }

      const m = ctx.matches.find((x) => x.subjectId === r.reqId && x.responseDocId === q)!;
      const verdict = concludeAbsence(m, doc);
      if (verdict.kind === 'absent') {
        notEvaluated(verdict.reason, `item not matched in ${q} (${verdict.reason})`);
        const d = describeInputs([r.line.f.item!]);
        // A line in this quotation that is held, has no evidence, carries several items or has an uncertain identity
        // could be this item: the omission stays Needs review and the reason says why.
        const hidden = offers.multi.some((l) => (l.all.item ?? []).some((e) => itemKey(e.value) === r.key));
        const candidate = offers.unresolved.length > 0;
        const state = verdict.state === 'confirmed' && candidate ? 'needs_review' : verdict.state;
        const reason = verdict.state === 'confirmed' && candidate ? (hidden ? 'multiple_items_in_block' : 'held_candidate_in_response') : verdict.reason;
        out.push(makeDraft({ ...base, code: 'item.absent', severity: 'critical', state, basis: 'absence', subjectId: r.reqId, message: `${r.key} not found in ${q}`, reason, matchStatus: m.status, inputs: d.inputs, evidence: d.evidence, coverage: [coverageSnapshot(doc)] }));
        continue;
      }
      const offer = qLines.find((l) => l.blockId === m.verifiedTargetId)!;
      const aspect = (field: string, code: string, equal: (a: EffectiveFact, b: EffectiveFact) => 'equal' | 'different' | 'incomparable', why?: string, note?: (a: EffectiveFact, b: EffectiveFact) => string) => {
        const a = r.line.f[field];
        const b = offer.f[field];
        const cmp = { id: `${field}:${r.reqId}~${q}`, check: 'quote_aspect' as const, field, docs: [data.rfqDocId, q] };
        // More than one fact for this field in the same line: never compare "the first one" and report agreement.
        const many = (r.line.all[field]?.length ?? 0) > 1 ? r.line : (offer.all[field]?.length ?? 0) > 1 ? offer : undefined;
        if (many) {
          const doc2 = many === r.line ? data.rfqDocId : q;
          comparisons.push({ ...cmp, status: 'not_evaluated', reason: `more than one ${field} in the same line of ${doc2}; it is not clear which to compare`, blocked: { docId: doc2, field, reason: 'multiple_candidates' } });
          return;
        }
        if (!a || !b) {
          // not silently skipped: the comparison could not run because a side was never extracted
          comparisons.push({ ...cmp, status: 'not_evaluated', reason: `no ${field} fact in ${!a ? data.rfqDocId : q}`, blocked: { docId: !a ? data.rfqDocId : q, field, reason: 'no_fact' } });
          return;
        }
        if (!usable(a) || !usable(b)) {
          const held = !usable(a) ? a : b;
          comparisons.push({ ...cmp, status: 'not_evaluated', reason: `${field} in ${held.fact.docId} not validated (${held.fact.reason ?? 'needs_review'})`, blocked: { docId: held.fact.docId, field, reason: held.fact.reason ?? 'needs_review', factId: held.fact.id } });
          const d = describeInputs([a, b]);
          out.push(makeDraft({ ...base, matchStatus: m.status, code: `${field}.unverified`, severity: 'warning', state: 'needs_review', subjectId: `${r.reqId}:${field}`, message: `${field === 'quantity' ? 'Quantity' : 'Specification'} for ${r.key} in ${q} needs review`, reason: 'unvalidated_input', inputs: d.inputs, evidence: d.evidence }));
          return;
        }
        const verdict2 = equal(a, b);
        comparisons.push({ ...cmp, status: verdict2 === 'equal' ? 'agree' : 'flagged', reason: verdict2 === 'incomparable' ? 'incomparable' : undefined, userSupplied: [a, b].filter((x) => x.provenance === 'user_supplied').map((x) => x.fact.id), detail: `${showValue(a.value)} <-> ${showValue(b.value)}${note?.(a, b) ?? ''}` });
        if (verdict2 === 'equal') return;
        const d = describeInputs([a, b]);
        out.push(makeDraft({ ...base, matchStatus: m.status, code, severity: 'critical', state: verdict2 === 'different' ? 'confirmed' : 'needs_review', subjectId: `${r.reqId}:${field}`, message: why ?? `${field === 'quantity' ? 'Quantity' : 'Specification text'} ${verdict2 === 'different' ? 'differs' : 'cannot be compared'} for ${r.key} in ${q}`, reason: verdict2 === 'incomparable' ? 'incomparable' : undefined, inputs: d.inputs, evidence: d.evidence }));
      };
      aspect('quantity', 'quantity.differs', (a, b) => compareQuantities(a.value as never, b.value as never).result);
      aspect('specification', 'spec.differs', (a, b) => (sameSpec(a.value, b.value).same ? 'equal' : 'different'), undefined, (a, b) => {
        const r = sameSpec(a.value, b.value);
        return r.removed.length ? ` (leading ${r.removed.map((x) => `"${x}"`).join(', ')} not counted as a difference)` : '';
      });
    }
    // Every stated exclusion is its own finding, identified by its source line (and its position within the line), so
    // one exclusion (for example VAT) can never hide another (for example freight).
    for (const l of qLines) {
      (l.all.exclusion ?? []).filter(usable).forEach((ex, i) => {
        const d = describeInputs([ex]);
        out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: q, code: 'exclusion.stated', severity: 'info', state: 'confirmed', subjectId: `${q}:${l.blockId}:exclusion${i > 0 ? `#${i + 1}` : ''}`, message: `Exclusion stated in ${q} (unpriced): ${showValue(ex.value)}`, inputs: d.inputs, evidence: d.evidence }));
      });
    }
    // Several item facts in one quotation block: which one a quantity or specification belongs to is not known.
    for (const l of offers.multi) {
      const d = describeInputs(l.all.item!);
      out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: q, code: 'item.multiple_items', severity: 'warning', state: 'needs_review', subjectId: `${q}:${l.blockId}:items`, message: 'Several items were extracted from one quotation line', reason: 'multiple_items_in_block', inputs: d.inputs, evidence: d.evidence }));
    }
    // Uncertain identity (several possible codes, or evidence that does not check out) is never guessed.
    for (const l of qLines) {
      const item = l.f.item;
      if (!isMulti(l) && item?.usable && itemIdentityKey(item, data.identities) === null) {
        const d = describeInputs([item]);
        out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: q, code: 'item.identity_uncertain', severity: 'warning', state: 'needs_review', subjectId: `${q}:${l.blockId}:item`, message: 'Item identity is uncertain', reason: reasonOf(item, data.identities), inputs: d.inputs, evidence: d.evidence }));
      }
    }
    // Items the quote lists whose item fact is not usable (including facts with no evidence): keep visible rather than silent.
    for (const l of qLines) {
      const item = l.f.item;
      if (!isMulti(l) && item && !item.usable) {
        const d = describeInputs([item]);
        out.push(makeDraft({ contextId: 'rfq-vs-quote', responseDocId: q, code: 'item.unverified', severity: 'warning', state: 'needs_review', subjectId: `${q}:${l.blockId}:item`, message: 'Item could not be validated', reason: item.fact.reason, inputs: d.inputs, evidence: d.evidence }));
      }
    }
  }
  return { drafts: dedupeDrafts(out), comparisons };
}

export const scopeRule: Rule<ScopeData> = {
  id: 'bench.scope',
  // 3 (2026-11-02): leading connectors are not a specification difference; unresolved requirement lines list their
  // comparisons as Not evaluated; each stated exclusion is its own finding (identified by its source line).
  version: '3',
  run(ctx: RuleContext<ScopeData>) {
    return evaluateScope(ctx).drafts;
  },
};

