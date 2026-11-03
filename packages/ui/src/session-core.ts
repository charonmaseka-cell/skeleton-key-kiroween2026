import {
  buildEffectiveFacts,
  buildExport,
  confirmCoverage,
  decide,
  newExtraction,
  processingComplete,
  reconcileReview,
  renderCsv,
  renderText,
  uncoveredBlocks,
  validateClaims,
  type Block,
  type Correction,
  type DocumentExtraction,
  type EffectiveFact,
  type ExportModel,
  type Fact,
  type Finding,
  type PlannedComparison,
  type ReviewItem,
  type ReviewStatus,
  type ReviewStore,
  type ValueKind,
  type ExportLabels,
} from '@skeleton-key/engine';
import type { DocumentResult } from './extraction-client';

// Pure session logic shared by both apps. Everything here runs in the browser from fixture inputs:
//   source blocks + recorded model claims -> validation -> facts -> (user corrections) -> adapter
//   rules -> findings + comparison ledger -> review decisions -> export.
// Nothing is uploaded and no model is called. The domain adapter is the only domain-specific part.

export type FixtureDoc = {
  id: string;
  role: string;
  title: string;
  /** optional secondary note under the title (for example the layout of a sample document); never part of the name */
  note?: string;
  profile: string;
  recordedIn: string;
  blocks: Block[];
  claims: unknown[];
  /**
   * How the document was sent for extraction. Default: one chunk covering every block, processed ok.
   * A fixture can declare a failed chunk; its blocks are then NOT processed and no absence against
   * the document can be confirmed, whatever the reviewer says.
   */
  chunks?: { blockIds: string[]; status: 'ok' | 'failed' }[];
};

export type Fixture = {
  id: string;
  title: string;
  description: string;
  /** true for fictional fixtures; false for documents the user uploaded. Drives every banner and export marker. */
  sample: boolean;
  label: string;
  extraction: { model: string; note: string };
  docs: FixtureDoc[];
};

export type Evaluation = {
  findings: Finding[];
  comparisons: PlannedComparison[];
  /** adapter-specific data for its own views (for example match resolutions) */
  context?: unknown;
};

export type EvaluateInput = {
  /** effective facts: document values with user corrections applied */
  facts: Map<string, EffectiveFact>;
  /** facts exactly as validated from the document, before any correction */
  originalFacts: Fact[];
  documents: Map<string, DocumentExtraction>;
  blocks: Block[];
  roles: Record<string, string>;
  /** document titles by ID, so rules can name documents in plain words (never by their internal ID) */
  titles?: Record<string, string>;
};

/**
 * Plain labels for everything an adapter shows a person. Internal names (field keys, document IDs, reason codes) never reach
 * the screen or an export: each is shown through these labels.
 */
/**
 * The second name of a finding in Lights off (HU-10): decoration next to the plain wording, never a verdict. `plain` is what the
 * séance summary says in Lights on and what screen readers hear. A code without an entry has no second name.
 */
export type ThemeEntry = {
  /** singular and plural noun for a CONFIRMED finding, for example "ghost" / "ghosts" */
  name: string;
  plural: string;
  /** noun for the same finding while it only Needs review, for example "possible ghost" / "possible ghosts" */
  review?: { name: string; plural: string };
  /** the plain noun phrase, singular and plural, for example "missing item" / "missing items" */
  plain: string;
  plainPlural: string;
};

export type AdapterLabels = {
  /** finding code -> second name (Lights off only). Adapter data; the engine and this package know no domain words. */
  theme?: Record<string, ThemeEntry>;
  /** field key -> label, for example organisation_name -> "Organisation name" */
  fields: Record<string, string>;
  /** document role -> label, used when a document has no title */
  roles: Record<string, string>;
  /** adapter-specific reason codes -> explanation (shared engine reasons are in REASONS below) */
  reasons?: Record<string, string>;
};

export interface DomainAdapter {
  id: string;
  /** field-label hints used by the value validators (adapter data) */
  hints: Record<string, string[]>;
  labels: AdapterLabels;
  evaluate(input: EvaluateInput): Evaluation;
}

/** Turns an internal key into words when no label exists: never shows underscores. */
export const humanise = (key: string): string => {
  const t = key.replace(/[_-]+/g, ' ').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
};

export type SessionState = {
  corrections: Correction[];
  store: ReviewStore;
  /** documents whose extraction coverage the user has confirmed, with the time */
  confirmed: Record<string, number>;
  /** corrections the user withdrew; kept for the export history */
  reverted: Correction[];
};

export const emptySession = (): SessionState => ({ corrections: [], store: {}, confirmed: {}, reverted: [] });

export type SessionView = {
  fixture: Fixture;
  facts: Fact[];
  effective: Map<string, EffectiveFact>;
  documents: Map<string, DocumentExtraction>;
  blocksByDoc: Map<string, Block[]>;
  titles: Record<string, string>;
  evaluation: Evaluation;
  items: ReviewItem[];
  store: ReviewStore;
  uncovered: Record<string, string[]>;
  exportModel: ExportModel;
  /** plain label of a field key */
  fieldLabel(field: string): string;
  /** plain name of a document (its title; else its role's label) */
  docName(docId: string): string;
  /** plain explanation of a reason code (adapter reasons first, then the shared ones); free text is returned as it is */
  reasonText(code?: string): string;
  /** the adapter's theme entries (finding code -> second name) */
  theme: Record<string, ThemeEntry>;
  /** 1-based position of a block in its document, for "line N" instead of a block ID */
  lineNumber(docId: string, blockId: string): number | null;
};

/** Label helpers for a fixture, shared by the view and the export. */
export function labelling(adapter: Pick<DomainAdapter, 'labels'>, fixture: Fixture) {
  const titles = Object.fromEntries(fixture.docs.map((d) => [d.id, d.title]));
  const roles = Object.fromEntries(fixture.docs.map((d) => [d.id, d.role]));
  // A key without a label is turned into words; text that is not a key (for example "Attachment: Letters of support") is kept.
  const fieldLabel = (f: string) => adapter.labels.fields[f] ?? (/^[a-z0-9]+(_[a-z0-9]+)*$/.test(f) ? humanise(f) : f);
  const docName = (id: string) => titles[id] || adapter.labels.roles[roles[id] ?? ''] || humanise(id);
  const reasonText = (code?: string) => (code ? (adapter.labels.reasons?.[code] ?? explainReason(code)) : '');
  return { titles, fieldLabel, docName, reasonText };
}

export function evaluateSession(adapter: DomainAdapter, fixture: Fixture, state: SessionState, at: number): SessionView {
  const blocksByDoc = new Map(fixture.docs.map((d) => [d.id, d.blocks]));
  const facts = fixture.docs.flatMap((d) => validateClaims(d.claims, { docId: d.id, blocks: d.blocks, hintsByField: adapter.hints }));
  const effective = buildEffectiveFacts(facts, state.corrections);
  const documents = new Map<string, DocumentExtraction>();
  for (const d of fixture.docs) {
    const ids = d.blocks.map((b) => b.id);
    // A successful extraction never proves complete coverage: documents stay 'unverified' until a person confirms.
    const chunks = (d.chunks ?? [{ blockIds: ids, status: 'ok' as const }]).map((c, i) => ({ id: `${d.id}#${i + 1}`, blockIds: c.blockIds, status: c.status }));
    let ext = newExtraction(d.id, ids, chunks);
    // Confirmation is only possible for a document that was fully processed. A failed chunk cannot be confirmed away.
    if (state.confirmed[d.id] !== undefined && processingComplete(ext)) ext = confirmCoverage(ext, 'user', 'Confirmed by the reviewer in this session');
    documents.set(d.id, ext);
  }
  const L = labelling(adapter, fixture);
  const evaluation = adapter.evaluate({
    facts: effective,
    originalFacts: facts,
    documents,
    blocks: fixture.docs.flatMap((d) => d.blocks),
    roles: Object.fromEntries(fixture.docs.map((d) => [d.id, d.role])),
    titles: L.titles,
  });
  const { items, store } = reconcileReview(evaluation.findings, state.store, at);
  const coverage = fixture.docs.map((d) => {
    const ext = documents.get(d.id)!;
    return { docId: d.id, state: processingComplete(ext) ? ext.coverage.state : 'processing_incomplete', confirmedByUser: ext.coverage.state === 'user_confirmed', at: state.confirmed[d.id] };
  });
  const exportModel = buildExport({ items, corrections: state.corrections, facts: effective, sample: fixture.sample, comparisons: evaluation.comparisons, coverage, reverted: state.reverted });
  const uncovered = Object.fromEntries(fixture.docs.map((d) => [d.id, uncoveredBlocks(documents.get(d.id)!, facts.filter((f) => f.docId === d.id))]));
  return {
    fixture,
    facts,
    effective,
    documents,
    blocksByDoc,
    titles: L.titles,
    evaluation,
    items,
    store,
    uncovered,
    exportModel,
    fieldLabel: L.fieldLabel,
    docName: L.docName,
    reasonText: L.reasonText,
    theme: adapter.labels.theme ?? {},
    lineNumber: (docId, blockId) => {
      const i = (blocksByDoc.get(docId) ?? []).findIndex((b) => b.id === blockId);
      return i < 0 ? null : i + 1;
    },
  };
}

// ---- actions (pure) ----

export function applyCorrection(state: SessionState, factId: string, correctedValue: unknown, note: string | undefined, at: number): SessionState {
  return { ...state, corrections: [...state.corrections, { factId, correctedValue, note: note || undefined, at }] };
}

export const revertCorrection = (state: SessionState, factId: string): SessionState => ({
  ...state,
  corrections: state.corrections.filter((c) => c.factId !== factId),
  reverted: [...state.reverted, ...state.corrections.filter((c) => c.factId === factId)],
});

export const decideFinding = (state: SessionState, finding: Finding, status: ReviewStatus, note: string | undefined, at: number): SessionState => ({
  ...state,
  store: decide(state.store, finding, status, note || undefined, at),
});

export const confirmDocumentCoverage = (state: SessionState, docId: string, at: number): SessionState => ({ ...state, confirmed: { ...state.confirmed, [docId]: at } });

export const withdrawDocumentCoverage = (state: SessionState, docId: string): SessionState => {
  const { [docId]: _removed, ...rest } = state.confirmed;
  void _removed;
  return { ...state, confirmed: rest };
};

export const withReconciledStore = (state: SessionState, view: SessionView): SessionState => ({ ...state, store: view.store });

// ---- correction input parsing ----

export type CorrectionInput = { text?: string; amount?: string; currency?: string; value?: string; unit?: string };
export type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Turn editor fields into a typed value, rejecting anything the engine's value shapes would not accept. */
export function parseCorrection(kind: ValueKind, input: CorrectionInput): Parsed {
  switch (kind) {
    case 'money': {
      // Never guess the author's separators: a comma could be a thousands separator or a decimal comma.
      const raw = (input.amount ?? '').trim();
      const plain = /^\d+(\.\d+)?$/.test(raw) || /^\d{1,3}( \d{3})+(\.\d+)?$/.test(raw);
      if (!plain) return { ok: false, error: 'Enter the amount as a plain number such as 1600000 or 1 600 000. Use a dot for decimals; commas are not accepted because they can mean different things.' };
      const amount = raw.replace(/ /g, '');
      const currency = (input.currency ?? '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'Enter the three-letter currency code, for example ZAR.' };
      return { ok: true, value: { amount, currency } };
    }
    case 'quantity': {
      const value = (input.value ?? '').replace(/\s/g, '');
      if (!DECIMAL.test(value)) return { ok: false, error: 'Enter the quantity as a number.' };
      const unit = (input.unit ?? '').trim();
      return { ok: true, value: { value, unit: unit === '' ? null : unit } };
    }
    case 'date': {
      const t = (input.text ?? '').trim();
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
      const d = m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
      if (!m || !d || d.getUTCFullYear() !== +m[1]! || d.getUTCMonth() !== +m[2]! - 1 || d.getUTCDate() !== +m[3]!) return { ok: false, error: 'Enter a real date as YYYY-MM-DD.' };
      return { ok: true, value: t };
    }
    default: {
      const t = (input.text ?? '').trim();
      return t === '' ? { ok: false, error: 'Enter a value.' } : { ok: true, value: t };
    }
  }
}

// ---- export ----

const exportLabels = (view: SessionView): ExportLabels => {
  const messages = new Map(view.items.map((i) => [i.finding.id, i.finding.message]));
  return {
    field: view.fieldLabel,
    doc: view.docName,
    reason: view.reasonText,
    finding: (id) => messages.get(id) ?? 'an item no longer in the review',
    line: view.lineNumber,
  };
};
export const exportCsv = (view: SessionView): string => renderCsv(view.exportModel, exportLabels(view));
export const exportText = (view: SessionView): string => renderText(view.exportModel, exportLabels(view));
export const renderCsvOf = exportCsv;
export const renderTextOf = exportText;

/** Plain-language explanation of engine and adapter reason codes. */
const REASONS: Record<string, string> = {
  coverage_unverified: 'The document has not been confirmed as fully extracted, so "not found" cannot be stated as fact.',
  absence_requires_verified_coverage: 'An absence can only be confirmed once the document\'s extraction is verified or you confirm it.',
  match_unresolved: 'The item could not be matched with certainty, so no omission or difference is asserted.',
  multiple_codes: 'More than one item code is tied to this line, so the item cannot be identified with certainty.',
  evidence_missing: 'The value has no source evidence.',
  evidence_invalid: 'The cited evidence does not match the source text.',
  description_not_located: 'The item description could not be located in its cited text.',
  code_not_in_source: 'The code in the extracted value does not appear in the cited text.',
  unvalidated_input: 'An input value was not validated against its source.',
  date_format_ambiguous: 'The date could be read more than one way (for example day/month or month/day).',
  number_format_ambiguous: 'The number could be read more than one way.',
  currency_ambiguous: 'The currency could not be determined from the text.',
  ambiguous_allocation: 'More than one requirement line names this item, or the quotation has several matching lines, so it is not clear which answers which.',
  multiple_items_in_block: 'Several items were extracted from one line, so no quantity or specification can be tied to one of them.',
  held_candidate_in_response: 'A line in this document was held or could not be identified and could be this item, so the omission is not stated as fact.',
  multiple_candidates: 'More than one value was extracted for this field in the same place, so it is not clear which to compare.',
  processing_incomplete: 'Part of the document was not processed, so nothing can be concluded about what it does not contain.',
  value_not_in_excerpt: 'The extracted value is not supported by the cited text.',
  multiple_candidates_no_context: 'The cited text holds several possible values and no label identifies the right one.',
  legal_form_differs: 'The names differ only in their legal form (for example Trust or Foundation).',
  incomparable: 'The two values cannot be compared (different units or currencies).',
  no_fact: 'No value was extracted for this field.',
  currency_not_comparable: 'The amounts are in different or unknown currencies.',
  not_found_in_verified_response: 'Not found in a document confirmed as fully extracted.',
  // engine: evidence and claim checks
  claim_schema_invalid: 'The extracted value did not have the expected form, so it was not used.',
  claim_shape_invalid: 'The extracted value did not have the expected form, so it was not used.',
  block_missing: 'The cited place is not in the document.',
  excerpt_not_found: 'The cited text was not found in the document.',
  excerpt_ambiguous_location: 'The cited text appears more than once, so it is not clear which place it comes from.',
  ambiguous_candidates: 'More than one value in the cited text matches, so it is not clear which one is meant.',
  currency_mismatch: 'The currency of the extracted value is not the one in the cited text.',
  unit_not_in_excerpt: 'The unit of the extracted value is not in the cited text.',
  not_in_successful_chunk: 'This part of the document was not processed successfully.',
  needs_review: 'The value was held for review.',
  // adapters (shared wording; an adapter can add its own)
  no_item_fact: 'No item was extracted for this line.',
  identity_uncertain: 'The item could not be identified with certainty.',
  contaminated_value: 'The specification includes the item\'s own code, so it is not a clean specification to compare.',
  item_code_in_specification: 'The specification includes the item\'s own code, so it is not a clean specification to compare.',
  currency_differs: 'The amounts are in different currencies.',
  unit_differs: 'The quantities are in different units.',
  unknown_currency: 'The currency is not known.',
  unknown_unit: 'The unit is not known.',
  unknown_value: 'The value is not known.',
};
/**
 * A reason code in plain words. Free text (a sentence) is returned as it is; an unknown code is turned into words, never shown
 * with underscores.
 */
export const explainReason = (code?: string): string => {
  if (!code) return '';
  if (REASONS[code]) return REASONS[code]!;
  return /^[a-z0-9]+(_[a-z0-9]+)+$/.test(code) ? humanise(code) + '.' : code;
};
/** Every reason code with an explanation (for tests). */
export const KNOWN_REASONS = (): string[] => Object.keys(REASONS);


// ---- live (uploaded) documents ----


/**
 * Turn extraction results for uploaded documents into the same Fixture shape the sample sets use, so the
 * validation, rules, review and export code is identical for both. Chunk statuses carry over: a failed or unsent
 * chunk makes the document "processing incomplete".
 */
export function buildLiveFixture(docs: { id: string; role: string; title: string; profile: string; result: DocumentResult }[], id = 'live-upload'): Fixture {
  return {
    id,
    title: 'Your uploaded documents',
    description: 'Documents you selected. They were read on your device; only their extracted text was sent for analysis.',
    sample: false,
    label: 'Live (your documents)',
    extraction: { model: 'server-selected', note: 'Extracted text from your documents was sent to an AI service after you pressed Analyse. Everything else (validation, matching, rules, review, export) runs on your device.' },
    docs: docs.map((d) => ({
      id: d.id,
      role: d.role,
      title: d.title,
      profile: d.profile,
      recordedIn: 'live extraction',
      blocks: d.result.blocks,
      claims: d.result.claims,
      chunks: d.result.chunks.map((c) => ({ blockIds: c.blockIds, status: c.status === 'ok' ? ('ok' as const) : ('failed' as const) })),
    })),
  };
}
