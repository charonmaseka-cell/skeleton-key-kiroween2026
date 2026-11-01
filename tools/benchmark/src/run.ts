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
  type RuleContext,
} from '@skeleton-key/engine';
import { packMatches, runChecks, scopeMatches, type PackData, type ScopeData } from './checks';
import { scoreExtraction, scoreFindings, type ExtractionScore, type FindingsScore } from './score';
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

export type DocResult = {
  docId: string;
  blocks: number;
  chunks: number;
  processingComplete: boolean;
  coverage: DocumentExtraction['coverage'];
  extraction: ExtractionScore;
  issues: ExtractionIssue[];
  rates: { claims: number; evidenceLocated: number; valueSupported: number };
};

export type SampleResult = {
  sampleId: string;
  docs: DocResult[];
  findings: { produced: { code: string; subject: string; response?: string; severity: string; state: string; reason?: string }[]; score: FindingsScore };
};

export type BenchmarkResult = {
  mode: 'mock' | 'live';
  model: string;
  startedAt: string;
  label: string;
  attemptBudget: number;
  attemptsCharged: number;
  simulatedCoverageConfirmation: boolean;
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
  mode: 'mock' | 'live';
  model: string;
  label: string;
  transport: Transport;
  sampleIds: string[];
  docFilter?: string[];
  limits: { maxChars: number; maxBlocks: number };
  attemptBudget: number;
  simulateCoverageConfirmation?: boolean;
  measuredNeurons?: number;
};

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
      docResults.push({
        docId: doc.id,
        blocks: blocks.length,
        chunks: chunks.length,
        processingComplete: processingComplete(extraction),
        coverage: extraction.coverage,
        extraction: scoreExtraction(doc, blocks, facts),
        issues,
        rates: { claims: facts.length, evidenceLocated: located, valueSupported: facts.filter((f) => f.status === 'validated').length },
      });
    }

    // Checks and findings (rules are deterministic; the model only supplied facts).
    const effective = buildEffectiveFacts(allFacts, []);
    const base = { facts: effective, documents: extractions };
    let ctx: RuleContext<ScopeData> | RuleContext<PackData>;
    if (sampleId === 'scopecheck') {
      const data: ScopeData = { rfqDocId: 'rfq', quoteDocIds: ['quote-a', 'quote-b'].filter((q) => extractions.has(q)) };
      ctx = extractions.has('rfq') ? { ...base, matches: scopeMatches(effective, data), data } : { ...base, matches: [], data };
    } else {
      const data: PackData = { requirementsDocId: 'requirements', formDocId: 'application-form', otherDocIds: ['budget', 'registration'].filter((d) => extractions.has(d)) };
      ctx = { ...base, matches: packMatches(effective, data), data };
    }
    const complete = sampleId === 'scopecheck' ? extractions.has('rfq') && docs.length === sample.docs.length : docs.length === sample.docs.length;
    const produced = complete ? runChecks(sampleId, ctx) : [];
    samples.push({
      sampleId,
      docs: docResults,
      findings: {
        produced: produced.map((f) => ({ code: f.code, subject: f.subjectId, response: f.responseDocId, severity: f.severity, state: f.state, reason: f.reason })),
        // Findings are only scored when every document of the sample was processed.
        score: complete
          ? scoreFindings(produced, sample.expectedFindings, { coverageConfirmed: !!opts.simulateCoverageConfirmation, mustNotFlag: sample.mustNotFlag })
          : { expected: 0, produced: 0, matchedExactState: 0, conservative: [], missed: [], falseCritical: [], overConfident: [], unexpectedOther: [], mustNotFlagViolations: [] },
      },
    });
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
  const banner = r.mode === 'mock' ? '*** MOCK RUN: no real model was called; usage is synthetic ***' : `*** LIVE RUN: ${r.model} ***`;
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
  return lines.join('\n');
}
