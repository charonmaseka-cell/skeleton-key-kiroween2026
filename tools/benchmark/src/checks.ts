// Benchmark-side access to the app adapters. The rules live in the apps (ScopeCheck and PackCheck
// adapters, apps/*/src/adapter); the benchmark runs exactly that code.
import { runRules, type Finding, type RuleContext } from '@skeleton-key/engine';
import { evaluateScope, itemIdentityKey, scopeMatches, scopeRule, type ScopeData } from '../../../apps/scopecheck/src/adapter/rules';
import { evaluatePack, packMatches, packRule, type PackData } from '../../../apps/packcheck/src/adapter/rules';

export { evaluatePack, evaluateScope, itemIdentityKey, packMatches, packRule, scopeMatches, scopeRule };
export type { PackData, ScopeData };
export type { PlannedComparison as Comparison } from '@skeleton-key/engine';

export function runChecks(family: string, ctx: RuleContext<ScopeData> | RuleContext<PackData>): Finding[] {
  return family === 'scopecheck' ? runRules([scopeRule], ctx as RuleContext<ScopeData>) : runRules([packRule], ctx as RuleContext<PackData>);
}
