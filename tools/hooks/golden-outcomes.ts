import { confirmDocumentCoverage, emptySession, evaluateSession, type DomainAdapter, type Fixture } from '../../packages/ui/src/session-core';
import { scopeCheckAdapter } from '../../apps/scopecheck/src/adapter';
import { FIXTURES as SCOPE } from '../../apps/scopecheck/src/fixtures';
import { packCheckAdapter } from '../../apps/packcheck/src/adapter';
import { FIXTURES as PACK } from '../../apps/packcheck/src/fixtures';

// The outcome of every rule on every sample fixture, as plain lines: "<app> / <fixture> / coverage <none|confirmed> / <code> | <subject> |
// <response document> = <state> <severity>". Compared with the committed snapshot (golden-outcomes.json) to report what a rule or
// adapter change moved. Computed in code from the same inputs as the golden tests; nothing here is read from a label.

export function outcomesOf(app: string, adapter: DomainAdapter, fixtures: Fixture[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fixtures) {
    for (const coverage of ['none', 'confirmed'] as const) {
      let st = emptySession();
      if (coverage === 'confirmed') for (const d of f.docs) if (d.role !== 'rfq' && d.role !== 'requirements') st = confirmDocumentCoverage(st, d.id, 1);
      const v = evaluateSession(adapter, f, st, 1);
      for (const i of v.items) out[`${app} / ${f.id} / coverage ${coverage} / ${i.finding.code} | ${i.finding.subjectId} | ${i.finding.responseDocId ?? ''}`] = `${i.finding.state} ${i.finding.severity}`;
      const c = v.exportModel.comparisons;
      out[`${app} / ${f.id} / coverage ${coverage} / comparisons`] = `planned ${c.planned}, agree ${c.agree}, not evaluated ${c.notEvaluated}`;
    }
  }
  return out;
}

export const computeOutcomes = (): Record<string, string> => ({ ...outcomesOf('scopecheck', scopeCheckAdapter, SCOPE), ...outcomesOf('packcheck', packCheckAdapter, PACK) });

export function diffOutcomes(was: Record<string, string>, now: Record<string, string>): string[] {
  const lines: string[] = [];
  for (const k of Object.keys(now).sort()) if (!(k in was)) lines.push(`ADDED    ${k} = ${now[k]}`);
  for (const k of Object.keys(was).sort()) if (!(k in now)) lines.push(`REMOVED  ${k} (was ${was[k]})`);
  for (const k of Object.keys(now).sort()) if (k in was && was[k] !== now[k]) lines.push(`CHANGED  ${k}: ${was[k]} -> ${now[k]}`);
  return lines;
}
