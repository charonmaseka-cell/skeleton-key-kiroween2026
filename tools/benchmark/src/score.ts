import { compareNames, nameTokens, type Block, type Fact, type Finding } from '@skeleton-key/engine';
import type { ExpectedFinding, SampleDoc } from './samples';

// Scoring against labelled fictional samples. Extraction, matching/rules and
// findings are scored separately (R10.6).

export type FactOutcome = 'correct' | 'correct_conservative' | 'held_for_review' | 'wrong_value' | 'wrongly_validated' | 'missed';

export type ExtractionScore = {
  docId: string;
  expected: number;
  /** labelled facts that should be validated (excludes facts that must stay Needs review) */
  validatable: number;
  outcomes: Record<FactOutcome, number>;
  details: { field: string; line: number; outcome: FactOutcome; reason?: string }[];
  /** validated facts that match no label (not necessarily wrong: the labels are not exhaustive) */
  unlabelledValidated: number;
  /** ids of every returned fact (any status) that matched no label: reported, never auto-scored */
  unlabelledFactIds: string[];
  /** facts the client rejected as unsupported (quote/value/block/shape) by reason */
  rejectedByReason: Record<string, number>;
  /** facts held as ambiguous / needing review by reason */
  ambiguousByReason: Record<string, number>;
  recall: number | null;
  validatedPrecision: number | null;
};

const tokens = (v: unknown) => new Set(nameTokens(String(v ?? '')));

function valueMatches(kind: string, expected: unknown, actual: unknown): boolean {
  if (actual === null || actual === undefined) return false;
  switch (kind) {
    case 'text':
      return [...tokens(expected)].every((t) => tokens(actual).has(t));
    case 'name':
      return compareNames(String(expected), String(actual)) === 'same';
    case 'date':
      return expected === actual;
    case 'money': {
      const e = expected as { amount: string; currency: string | null };
      const a = actual as { amount: string; currency: string | null };
      return Number(e.amount) === Number(a.amount) && (e.currency ?? null) === (a.currency ?? null);
    }
    case 'quantity': {
      const e = expected as { value: string; unit: string | null };
      const a = actual as { value: string; unit: string | null };
      return Number(e.value) === Number(a.value) && (e.unit ?? null)?.toLowerCase() === (a.unit ?? null)?.toLowerCase();
    }
    default:
      return false;
  }
}

const AMBIGUOUS_REASONS = new Set([
  'multiple_candidates_no_context', 'ambiguous_candidates', 'date_format_ambiguous', 'number_format_ambiguous',
  'currency_ambiguous', 'unit_not_in_excerpt', 'excerpt_ambiguous_location',
]);

export function scoreExtraction(doc: SampleDoc, blocks: Block[], facts: Fact[]): ExtractionScore {
  const outcomes: Record<FactOutcome, number> = { correct: 0, correct_conservative: 0, held_for_review: 0, wrong_value: 0, wrongly_validated: 0, missed: 0 };
  const details: ExtractionScore['details'] = [];
  const used = new Set<string>();
  for (const exp of doc.facts) {
    const block = blocks.find((b) => b.text === doc.lines[exp.line]);
    const candidates = facts.filter((f) => f.field === exp.field && !!block && f.evidence.some((e) => e.blockId === block.id));
    let outcome: FactOutcome;
    let reason: string | undefined;
    if (exp.expectStatus === 'needs_review') {
      const held = candidates.find((f) => f.status === 'needs_review');
      const validated = candidates.find((f) => f.status === 'validated');
      if (validated) {
        outcome = 'wrongly_validated';
        used.add(validated.id);
      } else if (held) {
        outcome = 'correct_conservative';
        reason = held.reason;
        used.add(held.id);
      } else outcome = 'missed';
    } else {
      const good = candidates.find((f) => f.status === 'validated' && valueMatches(exp.kind, exp.value, f.value));
      const wrong = candidates.find((f) => f.status === 'validated');
      const held = candidates.find((f) => f.status === 'needs_review');
      if (good) {
        outcome = 'correct';
        used.add(good.id);
      } else if (wrong) {
        outcome = 'wrong_value';
        used.add(wrong.id);
      } else if (held) {
        outcome = 'held_for_review';
        reason = held.reason;
        used.add(held.id);
      } else outcome = 'missed';
    }
    outcomes[outcome]++;
    details.push({ field: exp.field, line: exp.line, outcome, reason });
  }
  const docFacts = facts.filter((f) => f.docId === doc.id);
  const rejectedByReason: Record<string, number> = {};
  const ambiguousByReason: Record<string, number> = {};
  for (const f of docFacts) {
    if (f.status !== 'needs_review') continue;
    const r = f.reason ?? 'unknown';
    const bucket = AMBIGUOUS_REASONS.has(r) ? ambiguousByReason : rejectedByReason;
    bucket[r] = (bucket[r] ?? 0) + 1;
  }
  const validated = docFacts.filter((f) => f.status === 'validated');
  const validatableExpected = doc.facts.filter((f) => f.expectStatus !== 'needs_review').length;
  return {
    docId: doc.id,
    expected: doc.facts.length,
    validatable: validatableExpected,
    outcomes,
    details,
    unlabelledValidated: validated.filter((f) => !used.has(f.id)).length,
    unlabelledFactIds: docFacts.filter((f) => !used.has(f.id)).map((f) => f.id),
    rejectedByReason,
    ambiguousByReason,
    recall: validatableExpected === 0 ? null : outcomes.correct / validatableExpected,
    validatedPrecision: validated.length === 0 ? null : outcomes.correct / validated.length,
  };
}

// ---------------- findings ----------------

export type FindingsScore = {
  expected: number;
  produced: number;
  matchedExactState: number;
  /** expected confirmed but only reported as Needs review (conservative) */
  conservative: string[];
  /** expected but not produced at all */
  missed: string[];
  /**
   * confirmed findings at Critical OR High severity that the labels do not expect: the number that must be zero. High was split
   * from Critical on 2026-11-03 (quantity differences); counting both keeps the gate exactly as strict as before.
   */
  falseCritical: string[];
  /** produced as confirmed although the label says Needs review */
  overConfident: string[];
  /** Needs-review or non-critical findings with no label (noise, reported, not an error) */
  unexpectedOther: string[];
  mustNotFlagViolations: string[];
};

const key = (c: string, s: string, r?: string) => `${c}|${s}|${r ?? ''}`;

export function scoreFindings(produced: Finding[], expected: ExpectedFinding[], opts: { coverageConfirmed: boolean; mustNotFlag?: string[]; /** per document: ids of the blocks that carry a LABELLED exclusion; a stated exclusion counts as detecting the labelled one only if its evidence is in one of them */ exclusionBlocks?: Record<string, Set<string>> }): FindingsScore {
  const want = new Map(expected.map((e) => [key(e.code, e.subject, e.response), opts.coverageConfirmed && e.stateIfCoverageConfirmed ? e.stateIfCoverageConfirmed : e.state]));
  // A stated exclusion is identified by its own source line (see the ScopeCheck rules). The labels name one exclusion per
  // document ("quote-b:exclusion"). A produced exclusion detects it only when its evidence is in the labelled line, so a
  // different exclusion (VAT) can never count as detection of the labelled one (freight).
  const exclusionLabel = (f: Finding) => {
    if (f.code !== 'exclusion.stated' || !opts.exclusionBlocks) return null;
    const labelled = opts.exclusionBlocks[f.responseDocId ?? ''];
    if (!labelled || !f.evidence.some((e) => labelled.has(e.evidence.blockId))) return null;
    const names = expected.filter((e) => e.code === f.code && e.response === f.responseDocId);
    return names.length === 1 ? key(f.code, names[0]!.subject, f.responseDocId) : null;
  };
  const got = new Map(produced.map((f) => [exclusionLabel(f) ?? key(f.code, f.subjectId, f.responseDocId), f]));
  const score: FindingsScore = { expected: expected.length, produced: produced.length, matchedExactState: 0, conservative: [], missed: [], falseCritical: [], overConfident: [], unexpectedOther: [], mustNotFlagViolations: [] };
  for (const [k, state] of want) {
    const f = got.get(k);
    if (!f) score.missed.push(k);
    else if (f.state === state) score.matchedExactState++;
    else if (state === 'confirmed' && f.state === 'needs_review') score.conservative.push(k);
    else score.overConfident.push(k);
  }
  for (const [k, f] of got) {
    if (want.has(k)) continue;
    if (f.state === 'confirmed' && (f.severity === 'critical' || f.severity === 'high')) score.falseCritical.push(k);
    else score.unexpectedOther.push(`${k}(${f.state})`);
  }
  for (const f of produced) if (opts.mustNotFlag?.includes(f.code)) score.mustNotFlagViolations.push(key(f.code, f.subjectId, f.responseDocId));
  return score;
}
