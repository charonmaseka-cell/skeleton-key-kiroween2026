import type { Correction, EffectiveFact } from './types';
import type { ReviewItem } from './review';
import { notEvaluatedOf, summarizeComparisons, type PlannedComparison, type ComparisonSummary } from './comparisons';

// Format-agnostic export model (renderers come later). Unresolved items are included,
// clearly marked, next to confirmed findings, decisions, corrections and notes.

export type ExportEntry = {
  findingId: string;
  code: string;
  severity: string;
  state: 'confirmed' | 'needs_review';
  reason?: string;
  message: string;
  review: 'open' | 'accepted' | 'dismissed';
  reopened: boolean;
  note?: string;
  userSupplied: { factId: string; value: unknown; originalValue: unknown }[];
  evidence: { role: string; docId: string; blockId: string; start: number; end: number; text: string }[];
};

export type NotEvaluatedEntry = {
  id: string;
  check: string;
  field: string;
  docs: string[];
  reason: string;
  blocked?: { docId: string; field: string; reason: string };
};

export type ExportModel = {
  sample: boolean;
  findings: ExportEntry[];
  unresolved: ExportEntry[];
  /** comparisons that could not run, with the reason and the blocked input. Never "agrees". */
  notEvaluated: NotEvaluatedEntry[];
  /** how many comparisons were planned and what became of them */
  comparisons: ComparisonSummary;
  decisions: { findingId: string; status: string; at: number; note?: string }[];
  notes: { findingId: string; note: string }[];
  corrections: { factId: string; field: string; originalValue: unknown; correctedValue: unknown; note?: string; at: number }[];
};

export function buildExport(args: {
  items: ReviewItem[];
  corrections: Correction[];
  facts: Map<string, EffectiveFact>;
  sample: boolean;
  comparisons?: PlannedComparison[];
}): ExportModel {
  const entries: ExportEntry[] = args.items.map(({ finding, review }) => ({
    findingId: finding.id,
    code: finding.code,
    severity: finding.severity,
    state: finding.state,
    reason: finding.reason,
    message: finding.message,
    review: review.status,
    reopened: review.reopened,
    note: review.note,
    userSupplied: finding.inputs
      .filter((i) => i.provenance === 'user_supplied')
      .map((i) => ({ factId: i.factId, value: i.value, originalValue: i.originalValue ?? null })),
    evidence: finding.evidence.map((e) => ({
      role: e.role,
      docId: e.evidence.docId,
      blockId: e.evidence.blockId,
      start: e.evidence.start,
      end: e.evidence.end,
      text: e.evidence.text,
    })),
  }));
  return {
    sample: args.sample,
    findings: entries.filter((e) => e.state === 'confirmed'),
    unresolved: entries.filter((e) => e.state === 'needs_review'),
    notEvaluated: notEvaluatedOf(args.comparisons ?? []).map((c) => ({
      id: c.id,
      check: c.check,
      field: c.field,
      docs: c.docs,
      reason: c.reason ?? 'not evaluated',
      blocked: c.blocked ? { docId: c.blocked.docId, field: c.blocked.field, reason: c.blocked.reason } : undefined,
    })),
    comparisons: summarizeComparisons(args.comparisons ?? []),
    decisions: args.items.flatMap(({ finding, review }) =>
      review.history.map((h) => ({ findingId: finding.id, status: `${h.event}:${h.status}`, at: h.at, note: h.note })),
    ),
    notes: entries.filter((e) => e.note).map((e) => ({ findingId: e.findingId, note: e.note! })),
    corrections: args.corrections.map((c) => {
      const eff = args.facts.get(c.factId);
      return { factId: c.factId, field: eff?.fact.field ?? 'unknown', originalValue: eff?.fact.value ?? null, correctedValue: c.correctedValue, note: c.note, at: c.at };
    }),
  };
}
