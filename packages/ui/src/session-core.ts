import {
  buildEffectiveFacts,
  buildExport,
  confirmCoverage,
  decide,
  newExtraction,
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
} from '@skeleton-key/engine';

// Pure session logic shared by both apps. Everything here runs in the browser from fixture inputs:
//   source blocks + recorded model claims -> validation -> facts -> (user corrections) -> adapter
//   rules -> findings + comparison ledger -> review decisions -> export.
// Nothing is uploaded and no model is called. The domain adapter is the only domain-specific part.

export type FixtureDoc = {
  id: string;
  role: string;
  title: string;
  profile: string;
  recordedIn: string;
  blocks: Block[];
  claims: unknown[];
};

export type Fixture = {
  id: string;
  title: string;
  description: string;
  sample: true;
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
};

export interface DomainAdapter {
  id: string;
  /** field-label hints used by the value validators (adapter data) */
  hints: Record<string, string[]>;
  evaluate(input: EvaluateInput): Evaluation;
}

export type SessionState = {
  corrections: Correction[];
  store: ReviewStore;
  /** documents whose extraction coverage the user has confirmed, with the time */
  confirmed: Record<string, number>;
};

export const emptySession = (): SessionState => ({ corrections: [], store: {}, confirmed: {} });

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
};

export function evaluateSession(adapter: DomainAdapter, fixture: Fixture, state: SessionState, at: number): SessionView {
  const blocksByDoc = new Map(fixture.docs.map((d) => [d.id, d.blocks]));
  const facts = fixture.docs.flatMap((d) => validateClaims(d.claims, { docId: d.id, blocks: d.blocks, hintsByField: adapter.hints }));
  const effective = buildEffectiveFacts(facts, state.corrections);
  const documents = new Map<string, DocumentExtraction>();
  for (const d of fixture.docs) {
    const ids = d.blocks.map((b) => b.id);
    // A successful extraction never proves complete coverage: documents stay 'unverified' until a person confirms.
    let ext = newExtraction(d.id, ids, [{ id: `${d.id}#1`, blockIds: ids, status: 'ok' }]);
    if (state.confirmed[d.id] !== undefined) ext = confirmCoverage(ext, 'user', 'Confirmed by the reviewer in this session');
    documents.set(d.id, ext);
  }
  const evaluation = adapter.evaluate({
    facts: effective,
    originalFacts: facts,
    documents,
    blocks: fixture.docs.flatMap((d) => d.blocks),
    roles: Object.fromEntries(fixture.docs.map((d) => [d.id, d.role])),
  });
  const { items, store } = reconcileReview(evaluation.findings, state.store, at);
  const exportModel = buildExport({ items, corrections: state.corrections, facts: effective, sample: true, comparisons: evaluation.comparisons });
  const uncovered = Object.fromEntries(fixture.docs.map((d) => [d.id, uncoveredBlocks(documents.get(d.id)!, facts.filter((f) => f.docId === d.id))]));
  return {
    fixture,
    facts,
    effective,
    documents,
    blocksByDoc,
    titles: Object.fromEntries(fixture.docs.map((d) => [d.id, d.title])),
    evaluation,
    items,
    store,
    uncovered,
    exportModel,
  };
}

// ---- actions (pure) ----

export function applyCorrection(state: SessionState, factId: string, correctedValue: unknown, note: string | undefined, at: number): SessionState {
  return { ...state, corrections: [...state.corrections, { factId, correctedValue, note: note || undefined, at }] };
}

export const revertCorrection = (state: SessionState, factId: string): SessionState => ({ ...state, corrections: state.corrections.filter((c) => c.factId !== factId) });

export const decideFinding = (state: SessionState, finding: Finding, status: ReviewStatus, note: string | undefined, at: number): SessionState => ({
  ...state,
  store: decide(state.store, finding, status, note || undefined, at),
});

export const confirmDocumentCoverage = (state: SessionState, docId: string, at: number): SessionState => ({ ...state, confirmed: { ...state.confirmed, [docId]: at } });

export const withReconciledStore = (state: SessionState, view: SessionView): SessionState => ({ ...state, store: view.store });

// ---- correction input parsing ----

export type CorrectionInput = { text?: string; amount?: string; currency?: string; value?: string; unit?: string };
export type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Turn editor fields into a typed value, rejecting anything the engine's value shapes would not accept. */
export function parseCorrection(kind: ValueKind, input: CorrectionInput): Parsed {
  switch (kind) {
    case 'money': {
      const amount = (input.amount ?? '').replace(/[\s,]/g, '');
      const currency = (input.currency ?? '').trim().toUpperCase();
      if (!DECIMAL.test(amount)) return { ok: false, error: 'Enter the amount as a number, for example 1600000.' };
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

export const exportCsv = (view: SessionView): string => renderCsv(view.exportModel);
export const exportText = (view: SessionView): string => renderText(view.exportModel);

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
  value_not_in_excerpt: 'The extracted value is not supported by the cited text.',
  multiple_candidates_no_context: 'The cited text holds several possible values and no label identifies the right one.',
  legal_form_differs: 'The names differ only in their legal form (for example Trust or Foundation).',
  incomparable: 'The two values cannot be compared (different units or currencies).',
  no_fact: 'No value was extracted for this field.',
  currency_not_comparable: 'The amounts are in different or unknown currencies.',
  not_found_in_verified_response: 'Not found in a document confirmed as fully extracted.',
};
export const explainReason = (code?: string): string => (code ? (REASONS[code] ?? code.replace(/_/g, ' ')) : '');
