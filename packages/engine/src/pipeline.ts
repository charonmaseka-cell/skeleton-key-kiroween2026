import { validateEvidence } from './evidence';
import { hashOf } from './hash';
import { checkSupport } from './support';
import { ModelClaimSchema, type Block, type Fact, type ModelClaim } from './types';

export type ClaimContext = {
  docId: string;
  blocks: Block[];
  /** Field labels per field name, supplied by the app adapter (never by the model). */
  hintsByField?: Record<string, string[]>;
};

const review = (base: Omit<Fact, 'status' | 'value' | 'evidence'>, reason: string, value: unknown = null, evidence: Fact['evidence'] = []): Fact => ({
  ...base,
  value,
  evidence,
  status: 'needs_review',
  reason,
});

/**
 * Validate one model claim: schema, then evidence (excerpt really in the block,
 * offsets from the original text), then value support. Anything that fails stays
 * Needs review; the model's own page numbers/quotes/offsets are never used.
 */
export function validateClaim(rawClaim: unknown, ctx: ClaimContext): Fact {
  const parsed = ModelClaimSchema.safeParse(rawClaim);
  if (!parsed.success) {
    const field = typeof (rawClaim as { field?: unknown })?.field === 'string' ? (rawClaim as { field: string }).field : 'unknown';
    return review({ id: `${ctx.docId}:${hashOf(rawClaim)}`, docId: ctx.docId, field, kind: 'text' }, 'claim_schema_invalid');
  }
  const claim: ModelClaim = parsed.data;
  const block = ctx.blocks.find((b) => b.id === claim.blockId && b.docId === ctx.docId);
  const ev = validateEvidence(block, claim.excerpt);
  const idBase = { docId: ctx.docId, field: claim.field, blockId: claim.blockId };
  if (!ev.ok) {
    const base = { id: `${ctx.docId}:${hashOf({ ...idBase, excerpt: claim.excerpt })}`, docId: ctx.docId, field: claim.field, kind: claim.kind };
    return review(base, ev.reason);
  }
  const { evidence } = ev;
  const base = {
    id: `${ctx.docId}:${hashOf({ ...idBase, start: evidence.start, end: evidence.end })}`,
    docId: ctx.docId,
    field: claim.field,
    kind: claim.kind,
  };
  const sup = checkSupport({ kind: claim.kind, claimed: claim.value, excerpt: evidence.text, hints: ctx.hintsByField?.[claim.field] });
  if (sup.status === 'unsupported') return review(base, sup.reason, null, [evidence]);
  if (sup.status === 'needs_review') return review(base, sup.reason, sup.resolved, [evidence]);
  if (ev.occurrences > 1) return review(base, 'excerpt_ambiguous_location', sup.resolved, [evidence]);
  return { ...base, value: sup.resolved, evidence: [evidence], status: 'validated' };
}

const sameFact = (a: Fact, b: Fact) =>
  JSON.stringify([a.field, a.kind, a.value, a.status, a.reason ?? null, a.evidence]) === JSON.stringify([b.field, b.kind, b.value, b.status, b.reason ?? null, b.evidence]);

/**
 * Validate every claim. An EXACT duplicate (same field, evidence span, value and outcome) is one fact:
 * overlapping chunks legitimately extract the same text twice. A claim about the same text with a
 * DIFFERENT value is kept as a separate fact (id suffix `~n`) so the conflict stays visible.
 */
export function validateClaims(claims: unknown[], ctx: ClaimContext): Fact[] {
  const seen = new Map<string, Fact[]>();
  const out: Fact[] = [];
  for (const c of claims) {
    const fact = validateClaim(c, ctx);
    const prior = seen.get(fact.id) ?? [];
    if (prior.some((p) => sameFact(p, fact))) continue;
    seen.set(fact.id, [...prior, fact]);
    out.push(prior.length === 0 ? fact : { ...fact, id: `${fact.id}~${prior.length}` });
  }
  return out;
}
