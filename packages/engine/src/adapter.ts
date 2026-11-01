import { runRules, type Finding, type Rule, type RuleContext } from './findings';

/** Domain behaviour enters the engine only through this interface. */
export interface Adapter<D = unknown> {
  id: string;
  rules: Rule<D>[];
}

export const runAdapter = <D>(adapter: Adapter<D>, ctx: RuleContext<D>): Finding[] => runRules(adapter.rules, ctx);
