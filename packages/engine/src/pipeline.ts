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

export function validateClaims(claims: unknown[], ctx: ClaimContext): Fact[] {
  const seen = new Map<string, number>();
  return claims.map((c) => {
    const fact = validateClaim(c, ctx);
    const n = seen.get(fact.id) ?? 0;
    seen.set(fact.id, n + 1);
    return n === 0 ? fact : { ...fact, id: `${fact.id}~${n}` };
  });
}
