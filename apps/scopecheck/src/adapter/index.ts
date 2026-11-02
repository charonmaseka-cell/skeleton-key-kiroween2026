import { runRules, type EffectiveFact, type Fact } from '@skeleton-key/engine';
import type { DomainAdapter, EvaluateInput } from '@skeleton-key/ui';
import { resolveItemIdentities } from './identity';
import { evaluateScope, scopeMatches, scopeRule, type ScopeData } from './rules';

export * from './identity';
export * from './rules';

/** Field-label hints for the value validators (adapter data, never from the model). */
export const SCOPECHECK_HINTS: Record<string, string[]> = { quantity: ['qty'] };

export type ScopeContext = { data: ScopeData; matches: ReturnType<typeof scopeMatches>; identity: ReturnType<typeof resolveItemIdentities> };

/** The ScopeCheck adapter: runs identity resolution, matching and the comparison rules on validated facts. */
export const scopeCheckAdapter: DomainAdapter = {
  id: 'scopecheck',
  hints: SCOPECHECK_HINTS,
  evaluate({ facts, originalFacts, documents, blocks, roles }: EvaluateInput) {
    const rfqDocId = Object.keys(roles).find((d) => roles[d] === 'rfq');
    if (!rfqDocId) return { findings: [], comparisons: [] };
    const quoteDocIds = Object.keys(roles).filter((d) => roles[d] === 'quote');
    // Identity is resolved on the facts exactly as validated from the documents (corrections are handled by the matcher's provenance rule).
    const identity = resolveItemIdentities(originalFacts as Fact[], blocks);
    const data: ScopeData = { rfqDocId, quoteDocIds, identities: identity.identities };
    const matches = scopeMatches(facts as Map<string, EffectiveFact>, data);
    const ctx = { facts, documents, matches, data };
    return { findings: runRules([scopeRule], ctx), comparisons: evaluateScope(ctx).comparisons, context: { data, matches, identity } satisfies ScopeContext };
  },
};
