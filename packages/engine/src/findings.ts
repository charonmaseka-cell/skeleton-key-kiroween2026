import { processingComplete, type CoverageState, type DocumentExtraction } from './coverage';
import { hashOf } from './hash';
import type { MatchResolution, MatchStatus } from './matcher';
import type { EffectiveFact, Evidence, FactStatus } from './types';

export type Severity = 'critical' | 'warning' | 'info';
export type FindingState = 'confirmed' | 'needs_review';

export type FindingInput = {
  factId: string;
  field: string;
  value: unknown | null;
  /** Present only for user-supplied values: what the document-derived fact held. */
  originalValue?: unknown | null;
  provenance: 'document' | 'user_supplied';
  status: FactStatus | 'user_supplied';
  reason?: string;
  evidence: { docId: string; blockId: string; start: number; end: number }[];
};

/**
 * `document_value`: the excerpt supports the value used.
 * `superseded_original`: source of the ORIGINAL value that a user replaced; it does
 * not support the corrected value and must not be shown as if it did.
 */
export type FindingEvidence = { factId: string; evidence: Evidence; role: 'document_value' | 'superseded_original' };

export type CoverageSnapshot = { docId: string; processingComplete: boolean; coverage: CoverageState };

export type FindingDraft = {
  code: string;
  severity: Severity;
  state: FindingState;
  /** presence = conclusion drawn from found values; absence = conclusion that something is not there */
  basis: 'presence' | 'absence';
  /** The comparison being made, e.g. a pairing of documents. Part of the finding identity. */
  contextId: string;
  /** The item under examination. Part of the finding identity. */
  subjectId: string;
  /** The response document examined, if any. Part of the finding identity. */
  responseDocId?: string;
  inputs: FindingInput[];
  evidence: FindingEvidence[];
  coverage: CoverageSnapshot[];
  matchStatus?: MatchStatus;
  message: string;
  reason?: string;
};

export type Finding = FindingDraft & {
  id: string;
  ruleId: string;
  ruleVersion: string;
  fingerprint: string;
  userSuppliedFactIds: string[];
};

export type RuleContext<D = unknown> = {
  facts: Map<string, EffectiveFact>;
  documents: Map<string, DocumentExtraction>;
  matches: MatchResolution[];
  data: D;
};

export type Rule<D = unknown> = { id: string; version: string; run(ctx: RuleContext<D>): FindingDraft[] };

export function coverageSnapshot(doc: DocumentExtraction): CoverageSnapshot {
  return { docId: doc.docId, processingComplete: processingComplete(doc), coverage: doc.coverage.state };
}

/** Fill the structural defaults of a finding draft (presence basis, no inputs yet). */
export const makeDraft = (d: Omit<FindingDraft, 'basis' | 'inputs' | 'evidence' | 'coverage'> & Partial<FindingDraft>): FindingDraft => ({
  basis: 'presence',
  inputs: [],
  evidence: [],
  coverage: [],
  ...d,
});

/** Keep one draft per identity (context, subject, response); models can emit duplicate claims. */
export function dedupeDrafts(drafts: FindingDraft[]): FindingDraft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const k = `${d.code}|${d.contextId}|${d.subjectId}|${d.responseDocId ?? ''}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/** Build finding inputs/evidence from effective facts, keeping provenance explicit. */
export function describeInputs(facts: EffectiveFact[]): { inputs: FindingInput[]; evidence: FindingEvidence[] } {
  const inputs: FindingInput[] = [];
  const evidence: FindingEvidence[] = [];
  for (const e of facts) {
    const user = e.provenance === 'user_supplied';
    inputs.push({
      factId: e.fact.id,
      field: e.fact.field,
      value: e.value,
      ...(user ? { originalValue: e.fact.value } : {}),
      provenance: e.provenance,
      status: e.status,
      reason: e.fact.reason,
      evidence: e.fact.evidence.map(({ docId, blockId, start, end }) => ({ docId, blockId, start, end })),
    });
    for (const ev of e.fact.evidence) {
      evidence.push({ factId: e.fact.id, evidence: ev, role: user ? 'superseded_original' : 'document_value' });
    }
  }
  return { inputs, evidence };
}

const validInput = (i: FindingInput) => (i.status === 'validated' || i.status === 'user_supplied') && i.value !== null;

function finalize(rule: Rule<never>, draft: FindingDraft): Finding {
  let { state, reason } = draft;
  if (state === 'confirmed') {
    if (!draft.inputs.every(validInput)) {
      state = 'needs_review';
      reason = 'unvalidated_input';
    } else if (draft.basis === 'absence' && !(draft.coverage.length > 0 && draft.coverage.every((c) => c.processingComplete && c.coverage !== 'unverified'))) {
      state = 'needs_review';
      reason = 'absence_requires_verified_coverage';
    }
  }
  const final = { ...draft, state, reason };
  const id = hashOf({ rule: rule.id, context: draft.contextId, subject: draft.subjectId, response: draft.responseDocId ?? null });
  const inputs = [...final.inputs].sort((a, b) => a.factId.localeCompare(b.factId));
  const fingerprint = hashOf({
    rule: rule.id,
    version: rule.version,
    code: final.code,
    state: final.state,
    basis: final.basis,
    reason: final.reason ?? null,
    match: final.matchStatus ?? null,
    inputs,
    evidence: final.evidence
      .map((e) => ({ f: e.factId, r: e.role, d: e.evidence.docId, b: e.evidence.blockId, s: e.evidence.start, e: e.evidence.end, t: e.evidence.text }))
      .sort((a, b) => (a.f + a.b + a.s).localeCompare(b.f + b.b + b.s)),
    coverage: [...final.coverage].sort((a, b) => a.docId.localeCompare(b.docId)),
  });
  return {
    ...final,
    id,
    ruleId: rule.id,
    ruleVersion: rule.version,
    fingerprint,
    userSuppliedFactIds: inputs.filter((i) => i.provenance === 'user_supplied').map((i) => i.factId),
  };
}

export function runRules<D>(rules: Rule<D>[], ctx: RuleContext<D>): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    for (const draft of rule.run(ctx)) {
      const f = finalize(rule as Rule<never>, draft);
      if (seen.has(f.id)) throw new Error(`Duplicate finding identity from rule ${rule.id}`);
      seen.add(f.id);
      out.push(f);
    }
  }
  return out;
}
