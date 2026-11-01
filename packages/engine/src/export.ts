import type { Correction, EffectiveFact } from './types';
import type { ReviewItem } from './review';

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

export type ExportModel = {
  sample: boolean;
  findings: ExportEntry[];
  unresolved: ExportEntry[];
  decisions: { findingId: string; status: string; at: number; note?: string }[];
  notes: { findingId: string; note: string }[];
  corrections: { factId: string; field: string; originalValue: unknown; correctedValue: unknown; note?: string; at: number }[];
};

export function buildExport(args: {
  items: ReviewItem[];
  corrections: Correction[];
  facts: Map<string, EffectiveFact>;
  sample: boolean;
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
