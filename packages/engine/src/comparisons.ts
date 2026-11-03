// Comparison ledger (R4.9, R7.6). Every comparison a rule set plans is recorded with what happened
// to it, so that "no finding" can never be mistaken for "checked and fine".
//
//   agree         the comparison ran on validated inputs and found nothing to report
//   flagged       it ran and produced a finding (confirmed or Needs review)
//   not_evaluated it could not run: an input was missing, held, rejected or its identity unresolved
//
// Domain-neutral: adapters decide which comparisons exist and fill in the text.

export type ComparisonStatus = 'agree' | 'flagged' | 'not_evaluated';

/** The input that stopped a comparison from running. */
export type BlockedInput = {
  docId: string;
  field: string;
  /** engine or adapter reason code, e.g. 'date_format_ambiguous' or 'no_fact' */
  reason: string;
  factId?: string;
};

export type PlannedComparison = {
  id: string;
  /** adapter-defined kind of comparison */
  check: string;
  field: string;
  docs: string[];
  status: ComparisonStatus;
  /** human-readable reason (always present for not_evaluated) */
  reason?: string;
  /** what was compared, for display, e.g. "10 units → 8 units" */
  detail?: string;
  blocked?: BlockedInput;
  /** fact IDs whose value in this comparison was typed by the user, not read from a document */
  userSupplied?: string[];
};

export type ComparisonSummary = { planned: number; agree: number; flagged: number; notEvaluated: number };

export function summarizeComparisons(cs: PlannedComparison[]): ComparisonSummary {
  return {
    planned: cs.length,
    agree: cs.filter((c) => c.status === 'agree').length,
    flagged: cs.filter((c) => c.status === 'flagged').length,
    notEvaluated: cs.filter((c) => c.status === 'not_evaluated').length,
  };
}

export const notEvaluatedOf = (cs: PlannedComparison[]): PlannedComparison[] => cs.filter((c) => c.status === 'not_evaluated');
