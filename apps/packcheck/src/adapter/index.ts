import { runRules } from '@skeleton-key/engine';
import type { DomainAdapter, EvaluateInput } from '@skeleton-key/ui';
import { evaluatePack, packMatches, packRule, type PackData } from './rules';

export * from './rules';

/** Field-label hints for the value validators (adapter data, never from the model). */
export const PACKCHECK_HINTS: Record<string, string[]> = {
  project_start_date: ['start', 'period', 'from'],
  project_end_date: ['end', 'to '],
  funding_requested: ['funding requested', 'requested'],
  total_project_budget: ['total project budget', 'total budget'],
};

/** The PackCheck adapter: attachment and field checks across the documents of a grant pack. */
export const packCheckAdapter: DomainAdapter = {
  id: 'packcheck',
  hints: PACKCHECK_HINTS,
  evaluate({ facts, documents, roles }: EvaluateInput) {
    const byRole = (r: string) => Object.keys(roles).find((d) => roles[d] === r);
    const requirementsDocId = byRole('requirements');
    const formDocId = byRole('application-form');
    if (!requirementsDocId || !formDocId) return { findings: [], comparisons: [] };
    const data: PackData = { requirementsDocId, formDocId, otherDocIds: Object.keys(roles).filter((d) => roles[d] === 'budget' || roles[d] === 'registration') };
    const ctx = { facts, documents, matches: packMatches(facts, data), data };
    return { findings: runRules([packRule], ctx), comparisons: evaluatePack(ctx).comparisons, context: { data } };
  },
};
