import { runRules, type EffectiveFact, type Fact } from '@skeleton-key/engine';
import type { DomainAdapter, EvaluateInput } from '@skeleton-key/ui';
import { resolveItemIdentities } from './identity';
import { evaluateScope, quoteTotal, scopeMatches, scopeRule, type ScopeData } from './rules';

import { SCOPE_FIELD_LABELS, SCOPE_REASONS, SCOPE_ROLE_LABELS } from './labels';

export * from './identity';
export * from './rules';
export * from './labels';

/** Field-label hints for the value validators (adapter data, never from the model). */
export const SCOPECHECK_HINTS: Record<string, string[]> = { quantity: ['qty'] };

export type ScopeContext = { data: ScopeData; matches: ReturnType<typeof scopeMatches>; identity: ReturnType<typeof resolveItemIdentities>; /** per quotation, its total as quoted (no ranking) */ totals: Record<string, ReturnType<typeof quoteTotal>> };

/** The ScopeCheck adapter: runs identity resolution, matching and the comparison rules on validated facts. */
export const scopeCheckAdapter: DomainAdapter = {
  id: 'scopecheck',
  hints: SCOPECHECK_HINTS,
  labels: { fields: SCOPE_FIELD_LABELS, roles: SCOPE_ROLE_LABELS, reasons: SCOPE_REASONS },
  evaluate({ facts, originalFacts, documents, blocks, roles, titles }: EvaluateInput) {
    const rfqDocId = Object.keys(roles).find((d) => roles[d] === 'rfq');
    if (!rfqDocId) return { findings: [], comparisons: [] };
    const quoteDocIds = Object.keys(roles).filter((d) => roles[d] === 'quote');
    // Identity is resolved on the facts exactly as validated from the documents (corrections are handled by the matcher's provenance rule).
    const identity = resolveItemIdentities(originalFacts as Fact[], blocks);
    const data: ScopeData = { rfqDocId, quoteDocIds, identities: identity.identities, titles, roles };
    const matches = scopeMatches(facts as Map<string, EffectiveFact>, data);
    const ctx = { facts, documents, matches, data };
    return { findings: runRules([scopeRule], ctx), comparisons: evaluateScope(ctx).comparisons, context: { data, matches, identity, totals: Object.fromEntries(quoteDocIds.map((q) => [q, quoteTotal(facts as Map<string, EffectiveFact>, q)])) } satisfies ScopeContext };
  },
};
