import {
  buildEffectiveFacts,
  chunkBlocks,
  confirmCoverage,
  issuesFromDocument,
  issuesFromFacts,
  newExtraction,
  processingComplete,
  serverDroppedIssue,
  validateClaims,
  type Block,
  type ChunkRecord,
  type DocumentExtraction,
  type ExtractionIssue,
  type Fact,
  type Finding,
} from '@skeleton-key/engine';
import { packMatches, runChecks, scopeMatches, type PackData, type ScopeData } from './checks';
import { scoreExtraction, scoreFindings, type ExtractionScore, type FindingsScore } from './score';
import { resolveItemIdentities, type IdentityReport, type RecoveredIdentifier, type UncertainReason } from './scope-identity';
import { HINTS, loadBlocks, loadSample, type Sample } from './samples';
import type { Transport } from './transport';
import { summarizeUsage, type UsageSummary } from './usage';

export type RequestRecord = {
  docId: string;
  chunk: number;
  blocks: number;
  chars: number;
  ok: boolean;
  status?: number;
  code?: string;
  ms: number;
  attemptsCharged: number;
  repaired: boolean;
  claims: number;
  dropped: number;
};

export type FactRecord = {
  id: string;
  field: string;
  kind: string;
  status: string;
  reason?: string;
  value: unknown;
  evidence: { blockId: string; start: number; end: number; text: string }[];
  /** 'labelled' = matched a hand-written label; 'unlabelled' = no label (neither correct nor incorrect) */
  label: 'labelled' | 'unlabelled';
  /** independent check of a VALIDATED value against its own evidence text; null when not validated */
  audit: 'consistent' | 'suspect' | 'manual' | null;
};

export type DocResult = {
  docId: string;
  blocks: number;
  chunks: number;
  processingComplete: boolean;
  coverage: DocumentExtraction['coverage'];
  extraction: ExtractionScore;
  issues: ExtractionIssue[];
  /** raw claims exactly as returned by the Worker (fictional documents only) */
  claimsReturned: unknown[];
  /** every claim after client-side validation, with its outcome */
  facts: FactRecord[];
  rates: { claims: number; evidenceLocated: number; valueSupported: number };
};

export type ProducedFinding = { code: string; subject: string; response?: string; severity: string; state: string; reason?: string };
export type FindingsBlock = { produced: ProducedFinding[]; score: FindingsScore };

export type SampleResult = {
  sampleId: string;
  docs: DocResult[];
  /** findings after the ScopeCheck identity step when identityRecovery is on, otherwise the original findings */
  findings: FindingsBlock;
  /** ScopeCheck only, when identityRecovery is on: findings with the original matching, for comparison */
  findingsBefore?: FindingsBlock;
  /** ScopeCheck only: identifiers recovered from the source and items left uncertain. Recorded separately; facts and extraction scores are not changed. */
  identity?: { recovered: RecoveredIdentifier[]; uncertain: { factId: string; docId: string; reason: UncertainReason; candidates: string[]; description: string }[]; counts: IdentityReport['counts'] };
};

export type BenchmarkResult = {
  mode: 'mock' | 'live' | 'replay';
  model: string;
  startedAt: string;
  label: string;
  attemptBudget: number;
  attemptsCharged: number;
  simulatedCoverageConfirmation: boolean;
  identityRecovery: boolean;
  requests: RequestRecord[];
  samples: SampleResult[];
  summary: {
    requests: number;
    requestsOk: number;
    schemaValidRate: number | null;
    repairedRequests: number;
    latencyMs: { total: number; mean: number | null; max: number | null };
    claimsReceived: number;
    evidenceValidRate: number | null;
    valueSupportedRate: number | null;
    serverDropped: number;
    recall: number | null;
    validatedPrecision: number | null;
    missedFacts: number;
    unsupportedFacts: number;
    falseCriticalFindings: number;
    overConfidentFindings: number;
    missedFindings: number;
    mustNotFlagViolations: number;
  };
  usage: UsageSummary;
};

export type RunOptions = {
  mode: 'mock' | 'live' | 'replay';
  model: string;
  label: string;
  transport: Transport;
  sampleIds: string[];
  docFilter?: string[];
  limits: { maxChars: number; maxBlocks: number };
  attemptBudget: number;
  simulateCoverageConfirmation?: boolean;
  /** ScopeCheck item-identity step (default on). Off reproduces the original matching. */
  identityRecovery?: boolean;
  measuredNeurons?: number;
};

const digits = (t: string) => t.replace(/[\s,]/g, '');
/** Independent, deliberately crude check that a validated value is visible in its own evidence. */
function auditFact(f: Fact): FactRecord['audit'] {
  if (f.status !== 'validated') return null;
  const ev = f.evidence.map((e) => e.text).join(' ');
  const v = f.value as Record<string, unknown> | string | null;
  if (f.kind === 'money' && v && typeof v === 'object') return digits(ev).includes(String(v.amount ?? '').replace(/\.0+$/, '')) || /million|m\b/i.test(ev) ? 'consistent' : 'suspect';
  if (f.kind === 'quantity' && v && typeof v === 'object') return digits(ev).includes(String(v.value ?? '')) ? 'consistent' : 'suspect';
  if ((f.kind === 'text' || f.kind === 'name') && typeof v === 'string') {
    const hay = ev.toLowerCase();
    return v.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t.replace(/[^\w-]/g, ''))) ? 'consistent' : 'suspect';
  }
  return 'manual';
}

const rate = (n: number, d: number) => (d === 0 ? null : n / d);

export async function runBenchmark(opts: RunOptions): Promise<BenchmarkResult> {
  const requests: RequestRecord[] = [];
  const usageReports: ({ promptTokens: number | null; completionTokens: number | null } | null)[] = [];
  const samples: SampleResult[] = [];
  let charged = 0;

  for (const sampleId of opts.sampleIds) {
    const sample: Sample = loadSample(sampleId);
    const docs = sample.docs.filter((d) => !opts.docFilter || opts.docFilter.includes(d.id));
    const allFacts: Fact[] = [];
    const extractions = new Map<string, DocumentExtraction>();
    const docResults: DocResult[] = [];
    const blocksByDoc = new Map<string, Block[]>();

    for (const doc of docs) {
      const blocks = await loadBlocks(sampleId, doc);
      blocksByDoc.set(doc.id, blocks);
      const { chunks, oversized } = chunkBlocks(blocks, opts.limits);
      const records: ChunkRecord[] = [];
      const claims: unknown[] = [];
      const dropped: Record<string, number> = {};
      for (const [i, chunk] of chunks.entries()) {
        const blockIds = chunk.map((b) => b.id);
        if (charged >= opts.attemptBudget) {
          // Not sent: the budget is a hard stop. The chunk is recorded as not processed.
          records.push({ id: `${doc.id}#${i + 1}`, blockIds, status: 'failed' });
          requests.push({ docId: doc.id, chunk: i + 1, blocks: chunk.length, chars: 0, ok: false, code: 'attempt_budget_exhausted', ms: 0, attemptsCharged: 0, repaired: false, claims: 0, dropped: 0 });
          continue;
        }
        const res = await opts.transport.extract(doc.schemaId, chunk);
        charged += res.attemptsCharged;
        const chars = chunk.reduce((n, b) => n + b.text.length, 0);
        if (res.ok) {
          records.push({ id: `${doc.id}#${i + 1}`, blockIds, status: 'ok' });
          claims.push(...res.claims);
          for (const [k, n] of Object.entries(res.meta.droppedReasons)) dropped[k] = (dropped[k] ?? 0) + n;
          usageReports.push(res.meta.usage);
          requests.push({ docId: doc.id, chunk: i + 1, blocks: chunk.length, chars, ok: true, ms: res.ms, attemptsCharged: res.attemptsCharged, repaired: res.meta.repaired, claims: res.claims.length, dropped: res.meta.dropped });
        } else {
          records.push({ id: `${doc.id}#${i + 1}`, blockIds, status: 'failed' });
          usageReports.push(null);
          requests.push({ docId: doc.id, chunk: i + 1, blocks: chunk.length, chars, ok: false, status: res.status, code: res.code, ms: res.ms, attemptsCharged: res.attemptsCharged, repaired: false, claims: 0, dropped: 0 });
        }
      }
      const facts = validateClaims(claims, { docId: doc.id, blocks, hintsByField: HINTS });
      allFacts.push(...facts);

      // A successful request never establishes coverage. It stays 'unverified' unless a person
      // confirms it; the optional simulation below is a labelled benchmark option, not inference.
      let extraction = newExtraction(doc.id, blocks.map((b) => b.id), records);
      if (opts.simulateCoverageConfirmation && processingComplete(extraction)) {
        extraction = confirmCoverage(extraction, 'user', 'SIMULATED by benchmark option; not a measurement');
      }
      extractions.set(doc.id, extraction);

      const issues: ExtractionIssue[] = [
        ...issuesFromFacts(facts),
        ...issuesFromDocument(extraction),
        ...serverDroppedIssue(doc.id, dropped),
        ...oversized.map((b) => ({ docId: doc.id, kind: 'block_oversized' as const, reason: b.id, count: 1 })),
      ];
      const located = facts.filter((f) => f.evidence.length > 0).length;
      const extractionScore = scoreExtraction(doc, blocks, facts);
      const unlabelled = new Set(extractionScore.unlabelledFactIds);
      docResults.push({
        docId: doc.id,
        claimsReturned: claims,
        facts: facts.map((f) => ({
          id: f.id, field: f.field, kind: f.kind, status: f.status, reason: f.reason, value: f.value,
          evidence: f.evidence.map((e) => ({ blockId: e.blockId, start: e.start, end: e.end, text: e.text })),
          label: unlabelled.has(f.id) ? 'unlabelled' : 'labelled',
          audit: auditFact(f),
        })),
        blocks: blocks.length,
        chunks: chunks.length,
        processingComplete: processingComplete(extraction),
        coverage: extraction.coverage,
        extraction: extractionScore,
        issues,
        rates: { claims: facts.length, evidenceLocated: located, valueSupported: facts.filter((f) => f.status === 'validated').length },
      });
    }

    // Checks and findings (rules are deterministic; the model only supplied facts).
    const effective = buildEffectiveFacts(allFacts, []);
    const base = { facts: effective, documents: extractions };
    const complete = sampleId === 'scopecheck' ? extractions.has('rfq') && docs.length === sample.docs.length : docs.length === sample.docs.length;
    const scoreOf = (produced: Finding[]): FindingsBlock => ({
      produced: produced.map((f) => ({ code: f.code, subject: f.subjectId, response: f.responseDocId, severity: f.severity, state: f.state, reason: f.reason })),
      // Findings are only scored when every document of the sample was processed.
      score: complete
        ? scoreFindings(produced, sample.expectedFindings, { coverageConfirmed: !!opts.simulateCoverageConfirmation, mustNotFlag: sample.mustNotFlag })
        : { expected: 0, produced: 0, matchedExactState: 0, conservative: [], missed: [], falseCritical: [], overConfident: [], unexpectedOther: [], mustNotFlagViolations: [] },
    });
    const scopeRun = (identities?: IdentityReport['identities']): Finding[] => {
      const data: ScopeData = { rfqDocId: 'rfq', quoteDocIds: ['quote-a', 'quote-b'].filter((q) => extractions.has(q)), identities };
      return extractions.has('rfq') ? runChecks(sampleId, { ...base, matches: scopeMatches(effective, data), data }) : [];
    };

    let sampleResult: SampleResult;
    if (sampleId === 'scopecheck') {
      const before = complete ? scopeRun() : [];
      if (opts.identityRecovery === false) {
        sampleResult = { sampleId, docs: docResults, findings: scoreOf(before) };
      } else {
        const report = resolveItemIdentities(allFacts, [...blocksByDoc.values()].flat());
        const after = complete ? scopeRun(report.identities) : [];
        sampleResult = {
          sampleId,
          docs: docResults,
          findings: scoreOf(after),
          findingsBefore: scoreOf(before),
          identity: { recovered: report.recovered, uncertain: report.uncertain, counts: report.counts },
        };
      }
    } else {
      const data: PackData = { requirementsDocId: 'requirements', formDocId: 'application-form', otherDocIds: ['budget', 'registration'].filter((d) => extractions.has(d)) };
      const produced = complete ? runChecks(sampleId, { ...base, matches: packMatches(effective, data), data }) : [];
      sampleResult = { sampleId, docs: docResults, findings: scoreOf(produced) };
    }
    samples.push(sampleResult);
  }

  const docRes = samples.flatMap((s) => s.docs);
  const sum = (f: (d: DocResult) => number) => docRes.reduce((n, d) => n + f(d), 0);
  const okReqs = requests.filter((r) => r.ok);
  const sent = requests.filter((r) => r.code !== 'attempt_budget_exhausted');
  const claims = sum((d) => d.rates.claims);
  const located = sum((d) => d.rates.evidenceLocated);
  const findings = samples.map((s) => s.findings.score);
  return {
    mode: opts.mode,
    model: opts.model,
    startedAt: new Date().toISOString(),
    label: opts.label,
    attemptBudget: opts.attemptBudget,
    attemptsCharged: charged,
    simulatedCoverageConfirmation: !!opts.simulateCoverageConfirmation,
    identityRecovery: opts.identityRecovery !== false,
    requests,
    samples,
    summary: {
      requests: sent.length,
      requestsOk: okReqs.length,
      schemaValidRate: rate(okReqs.length, sent.length),
      repairedRequests: requests.filter((r) => r.repaired).length,
      latencyMs: { total: sent.reduce((n, r) => n + r.ms, 0), mean: sent.length ? Math.round(sent.reduce((n, r) => n + r.ms, 0) / sent.length) : null, max: sent.length ? Math.max(...sent.map((r) => r.ms)) : null },
      claimsReceived: claims,
      evidenceValidRate: rate(located, claims),
      valueSupportedRate: rate(sum((d) => d.rates.valueSupported), located),
      serverDropped: requests.reduce((n, r) => n + r.dropped, 0),
      recall: rate(sum((d) => d.extraction.outcomes.correct), sum((d) => d.extraction.validatable)),
      validatedPrecision: rate(sum((d) => d.extraction.outcomes.correct), sum((d) => d.rates.valueSupported)),
      missedFacts: sum((d) => d.extraction.outcomes.missed),
      unsupportedFacts: sum((d) => Object.values(d.extraction.rejectedByReason).reduce((a, b) => a + b, 0)),
      falseCriticalFindings: findings.reduce((n, s) => n + s.falseCritical.length, 0),
      overConfidentFindings: findings.reduce((n, s) => n + s.overConfident.length, 0),
      missedFindings: findings.reduce((n, s) => n + s.missed.length, 0),
      mustNotFlagViolations: findings.reduce((n, s) => n + s.mustNotFlagViolations.length, 0),
    },
    usage: summarizeUsage(usageReports, { mock: opts.mode === 'mock', measuredNeurons: opts.measuredNeurons }),
  };
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(0)}%`);

export function formatSummary(r: BenchmarkResult): string {
  const s = r.summary;
  const banner = r.mode === 'mock' ? '*** MOCK RUN: no real model was called; usage is synthetic ***' : r.mode === 'replay' ? '*** REPLAY: saved claims re-validated offline; no model call, no usage ***' : `*** LIVE RUN: ${r.model} ***`;
  const lines = [
    banner,
    `label=${r.label} attempts charged=${r.attemptsCharged}/${r.attemptBudget} simulated coverage confirmation=${r.simulatedCoverageConfirmation}`,
    `requests ${s.requestsOk}/${s.requests} ok (schema-valid ${pct(s.schemaValidRate)}), repaired=${s.repairedRequests}, latency mean=${s.latencyMs.mean ?? 'n/a'}ms max=${s.latencyMs.max ?? 'n/a'}ms`,
    `claims=${s.claimsReceived} evidence-located=${pct(s.evidenceValidRate)} value-supported=${pct(s.valueSupportedRate)} server-dropped=${s.serverDropped}`,
    `facts: recall=${pct(s.recall)} validated-precision=${pct(s.validatedPrecision)} missed=${s.missedFacts} unsupported/rejected=${s.unsupportedFacts}`,
    `findings: false-critical=${s.falseCriticalFindings} over-confident=${s.overConfidentFindings} missed=${s.missedFindings} must-not-flag violations=${s.mustNotFlagViolations}`,
    `usage: tokens ${r.usage.tokenSource} (prompt=${r.usage.promptTokens ?? 'n/a'}, completion=${r.usage.completionTokens ?? 'n/a'}); neurons ${r.usage.neurons.basis}=${r.usage.neurons.value ?? 'n/a'}`,
  ];
  for (const sm of r.samples) for (const d of sm.docs) {
    lines.push(`  ${sm.sampleId}/${d.docId}: coverage=${d.coverage.state} processing-complete=${d.processingComplete} issues=${d.issues.length} outcomes=${JSON.stringify(d.extraction.outcomes)}`);
  }
  for (const sm of r.samples) {
    if (sm.identity) {
      const c = sm.identity.counts;
      lines.push(`  ${sm.sampleId} identity: code-from-model=${c.codeFromModel} recovered=${c.recovered} description-only=${c.descriptionOnly} uncertain=${c.uncertain}`);
      for (const rec of sm.identity.recovered) lines.push(`    recovered ${rec.code} for "${rec.description}" (${rec.docId}) span ${rec.codeSpan.start}-${rec.codeSpan.end}`);
    }
    if (sm.findingsBefore) {
      const f = (b: FindingsBlock) => `exact=${b.score.matchedExactState}/${b.score.expected} missed=${b.score.missed.length} false-critical=${b.score.falseCritical.length} over-confident=${b.score.overConfident.length} other(needs-review)=${b.score.unexpectedOther.length}`;
      lines.push(`  ${sm.sampleId} findings BEFORE identity step: ${f(sm.findingsBefore)}`);
      lines.push(`  ${sm.sampleId} findings AFTER  identity step: ${f(sm.findings)}`);
    }
  }
  return lines.join('\n');
}
