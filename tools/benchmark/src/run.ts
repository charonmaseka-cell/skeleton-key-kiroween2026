import {
  buildEffectiveFacts,
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
import { evaluatePack, evaluateScope, packMatches, runChecks, scopeMatches, type Comparison, type PackData, type ScopeData } from './checks';
import { scoreExtraction, scoreFindings, type ExtractionScore, type FindingsScore } from './score';
import { resolveItemIdentities, type IdentityReport, type RecoveredIdentifier, type UncertainReason } from '../../../apps/scopecheck/src/adapter/identity';
import { HINTS, loadBlocks, loadSample, type Sample } from './samples';
import type { Transport } from './transport';
import { sizeChunker, type Chunker } from './chunking';
import { summarizeUsage, type UsageSummary } from './usage';

export type RequestRecord = {
  docId: string;
  chunk: number;
  blocks: number;
  chars: number;
  ok: boolean;
  /** taken from an earlier result by --resume-from: no call was made now */
  reused?: boolean;
  /** start and end of the request in ms since the run began (for overlap and elapsed-time measurement) */
  t0?: number;
  t1?: number;
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

export type ProfileRecord = {
  id: string;
  /** 'recorded' = stored by the run that produced the response; 'inferred_from_manifest' = older result without a stored profile (the sample manifest id at the time) */
  source: 'recorded' | 'inferred_from_manifest';
};

export type DocResult = {
  docId: string;
  /** extraction profile (prompt) version the saved or live response was produced with */
  profile: ProfileRecord;
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
  /** PackCheck only: every planned comparison and whether it ran (agree / flagged / not_evaluated with the reason) */
  comparisons?: Comparison[];
  /**
   * ScopeCheck only, OFFLINE DIAGNOSTIC from the labels (no rule reads it): the labelled requirement rows times the
   * quotations times two aspects, against what the ledger planned. A shortfall means a comparison was hidden.
   */
  comparisonCompleteness?: { labelledRequirementRows: number; quotations: number; aspects: number; expected: number; planned: number; complete: boolean };
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
    /** requests in flight at once: requested, the most that were actually in flight, repairs allowed per request, and the service error after which sending stopped */
    concurrency: { requested: number; peakInFlight: number; maxRepairAttempts: number; stoppedAfter: string | null };
    /** wall-clock ms from the start of the run to its end (with concurrency this is less than the sum of request latencies) */
    elapsedMs: number;
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

/** Service errors after which nothing new is sent (quota, allowance, access); requests already in flight still finish. */
export const STOPPING_CODES = new Set(['daily_limit', 'rate_limited', 'quota_exhausted', 'model_unavailable', 'limiter_unavailable', 'origin_denied', 'not_configured']);
/** Hard ceiling on requests in flight. The benchmark accepts 1 to 3. */
export const MAX_CONCURRENCY = 3;

export type RunOptions = {
  mode: 'mock' | 'live' | 'replay';
  model: string;
  label: string;
  transport: Transport;
  sampleIds: string[];
  docFilter?: string[];
  limits: { maxChars: number; maxBlocks: number; overlap?: number };
  /** How a document is split into requests. Default: size-only chunking by `limits`. */
  chunker?: Chunker;
  /** Requests in flight at once for one document, 1 to 3 (default 1: sequential). */
  concurrency?: number;
  /** Repairs the Worker may make per request (default 1); in-flight requests are budgeted for them. */
  maxRepairAttempts?: number;
  /** After a stopping service error (see STOPPING_CODES) send nothing new. Default off. */
  stopOnServiceErrors?: boolean;
  /**
   * Atomic neuron claim, made synchronously just before a request is dispatched: returns why it cannot be covered, or
   * null and a release function. Replaces `gate` when given.
   */
  claim?: (schemaId: string, chunk: Block[]) => { refusal: string | null; release: () => void };
  /**
   * Resume a document from an earlier live result: chunks that succeeded there are reused (their claims are taken from the
   * saved result by the chunk's own block ids, no call is made), and only the other chunks are sent. Requires the same chunk plan.
   */
  resume?: Record<string, { okChunks: number[]; claims: unknown[] }>;
  attemptBudget: number;
  /** Called before each chunk is sent; returns a reason to NOT send it (for example, the neuron budget cannot cover one more attempt). */
  gate?: (schemaId: string, chunk: Block[]) => string | null;
  simulateCoverageConfirmation?: boolean;
  /** ScopeCheck item-identity step (default on). Off reproduces the original matching. */
  identityRecovery?: boolean;
  /** per-document profile override for live runs, for example { 'application-form': 'packcheck.grant.v2' } */
  schemaOverrides?: Record<string, string>;
  /** replay: profile ids recorded in the saved results, by document ID */
  recordedProfiles?: Record<string, string>;
  measuredNeurons?: number;
};

const digits = (t: string) => t.replace(/[\s,]/g, '');
/** Independent, deliberately crude check that a validated value is visible in its own evidence. */
/**
 * Version of the benchmark audit of validated values. 1: tokens were stripped of ALL punctuation (false alarms on "7.5" and "l/h").
 * 2 (2026-11-01): the value as written, or each word with only end punctuation ignored. Result files written before the
 * `auditVersion` field existed were scored with 1 unless a build-log entry says otherwise.
 */
export const AUDIT_VERSION = 2;

export function auditFact(f: Fact): FactRecord['audit'] {
  if (f.status !== 'validated') return null;
  const ev = f.evidence.map((e) => e.text).join(' ');
  const v = f.value as Record<string, unknown> | string | null;
  if (f.kind === 'money' && v && typeof v === 'object') return digits(ev).includes(String(v.amount ?? '').replace(/\.0+$/, '')) || /million|m\b/i.test(ev) ? 'consistent' : 'suspect';
  if (f.kind === 'quantity' && v && typeof v === 'object') return digits(ev).includes(String(v.value ?? '')) ? 'consistent' : 'suspect';
  if ((f.kind === 'text' || f.kind === 'name') && typeof v === 'string') {
    const hay = ev.toLowerCase();
    // The value as written is visible in the evidence, or every word is (only punctuation at a word's ends is
    // ignored: stripping inside a word turned "7.5" into "75" and "l/h" into "lh", a false alarm on 2026-11-01).
    if (hay.includes(v.toLowerCase().trim())) return 'consistent';
    return v.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t.replace(/^[^\w]+|[^\w]+$/g, ''))) ? 'consistent' : 'suspect';
  }
  return 'manual';
}

const rate = (n: number, d: number) => (d === 0 ? null : n / d);

export async function runBenchmark(opts: RunOptions): Promise<BenchmarkResult> {
  const requests: RequestRecord[] = [];
  const usageReports: ({ promptTokens: number | null; completionTokens: number | null } | null)[] = [];
  const samples: SampleResult[] = [];
  let charged = 0;
  const runStart = Date.now();
  let peakInFlight = 0;
  let runStopped: string | null = null;

  for (const sampleId of opts.sampleIds) {
    const sample: Sample = loadSample(sampleId);
    const family = sample.family ?? sampleId;
    const docs = sample.docs.filter((d) => !opts.docFilter || opts.docFilter.includes(d.id));
    const allFacts: Fact[] = [];
    const extractions = new Map<string, DocumentExtraction>();
    const docResults: DocResult[] = [];
    const blocksByDoc = new Map<string, Block[]>();

    for (const doc of docs) {
      const blocks = await loadBlocks(sampleId, doc);
      const schemaId = opts.schemaOverrides?.[doc.id] ?? doc.schemaId;
      const recorded = opts.recordedProfiles?.[doc.id];
      const profile: ProfileRecord = opts.mode === 'replay' ? (recorded ? { id: recorded, source: 'recorded' } : { id: doc.schemaId, source: 'inferred_from_manifest' }) : { id: schemaId, source: 'recorded' };
      blocksByDoc.set(doc.id, blocks);
      const { chunks, oversized, unaccounted, info } = (opts.chunker ?? sizeChunker(opts.limits))(doc.id, blocks, schemaId);
      if (unaccounted?.length) throw new Error(`${doc.id}: chunker left blocks unaccounted for: ${unaccounted.join(',')}`);
      const records: ChunkRecord[] = [];
      const claims: unknown[] = [];
      const dropped: Record<string, number> = {};
      // ---- dispatch: bounded concurrency, deterministic output ----
      // Chunks of one document are sent by up to `concurrency` workers. The decision to send is made synchronously, in
      // chunk order, so it is atomic: it counts the attempts already used PLUS the worst case of every request in flight
      // (each may repair), and CLAIMS the neurons of the request before it starts. A chunk that cannot be covered waits for
      // an in-flight request to finish (its actual charge replaces its reservation) and is recorded as not sent only when
      // nothing is in flight. After a service error that stops a run, nothing new is dispatched; requests already in flight
      // finish and are recorded and charged. Results are written in chunk order whatever the finishing order.
      type Outcome = { record: ChunkRecord; request: RequestRecord; claims: unknown[]; usage?: { promptTokens: number | null; completionTokens: number | null } | null; droppedReasons?: Record<string, number> };
      const outcomes: (Outcome | undefined)[] = new Array(chunks.length);
      const notSent = (i: number, chunk: Block[], code: string): Outcome => ({ record: { id: `${doc.id}#${i + 1}`, blockIds: chunk.map((b) => b.id), status: 'failed' }, request: { docId: doc.id, chunk: i + 1, blocks: chunk.length, chars: 0, ok: false, code, ms: 0, attemptsCharged: 0, repaired: false, claims: 0, dropped: 0 }, claims: [] });
      const perRequestAttempts = 1 + (opts.maxRepairAttempts ?? 1);
      const conc = Math.max(1, Math.min(opts.concurrency ?? 1, MAX_CONCURRENCY));
      const send = async (i: number, chunk: Block[], claim: { release: () => void } | undefined) => {
        const started = Date.now() - runStart;
        try {
          const res = await opts.transport.extract(schemaId, chunk);
          const t = { t0: started, t1: Date.now() - runStart };
          charged += res.attemptsCharged;
          const chars = chunk.reduce((n, b) => n + b.text.length, 0);
          const blockIds = chunk.map((b) => b.id);
          if (res.ok) {
            outcomes[i] = { record: { id: `${doc.id}#${i + 1}`, blockIds, status: 'ok' }, request: { docId: doc.id, chunk: i + 1, blocks: chunk.length, chars, ok: true, ms: res.ms, attemptsCharged: res.attemptsCharged, repaired: res.meta.repaired, claims: res.claims.length, dropped: res.meta.dropped, ...t }, claims: res.claims, usage: res.meta.usage, droppedReasons: res.meta.droppedReasons };
          } else {
            outcomes[i] = { record: { id: `${doc.id}#${i + 1}`, blockIds, status: 'failed' }, request: { docId: doc.id, chunk: i + 1, blocks: chunk.length, chars, ok: false, status: res.status, code: res.code, ms: res.ms, attemptsCharged: res.attemptsCharged, repaired: false, claims: 0, dropped: 0, ...t }, claims: [], usage: null };
            if (opts.stopOnServiceErrors && STOPPING_CODES.has(res.code)) runStopped ??= res.code;
          }
        } finally {
          claim?.release();
        }
      };
      let next = 0;
      let inflight = 0;
      await new Promise<void>((resolve, reject) => {
        const pump = () => {
          while (next < chunks.length) {
            const i = next;
            const chunk = chunks[i]!;
            const prior = opts.resume?.[doc.id];
            if (prior?.okChunks.includes(i + 1)) {
              if (!info) return reject(new Error('resume needs a chunker that reports its own block ids'));
              const own = new Set(info[i]!.blockIds);
              const reused = prior.claims.filter((c) => own.has((c as { blockId?: string }).blockId ?? ''));
              outcomes[i] = { record: { id: `${doc.id}#${i + 1}`, blockIds: chunk.map((b) => b.id), status: 'ok' }, request: { docId: doc.id, chunk: i + 1, blocks: chunk.length, chars: 0, ok: true, ms: 0, attemptsCharged: 0, repaired: false, claims: reused.length, dropped: 0, reused: true }, claims: reused };
              next++;
              continue;
            }
            if (runStopped) { outcomes[i] = notSent(i, chunk, `stopped_after_${runStopped}`); next++; continue; }
            if (inflight >= conc) break;
            // attempts: those used, plus the worst case of everything in flight, plus this request's first attempt
            if (charged + inflight * perRequestAttempts + 1 > opts.attemptBudget) {
              if (inflight > 0) break;
              outcomes[i] = notSent(i, chunk, 'attempt_budget_exhausted');
              next++;
              continue;
            }
            const claim = opts.claim ? opts.claim(schemaId, chunk) : (() => { const why = opts.gate?.(schemaId, chunk) ?? null; return { refusal: why, release: () => undefined }; })();
            if (claim.refusal) {
              if (inflight > 0) break;
              outcomes[i] = notSent(i, chunk, 'neuron_budget_exhausted');
              next++;
              continue;
            }
            next++;
            inflight++;
            peakInFlight = Math.max(peakInFlight, inflight);
            send(i, chunk, claim).then(() => { inflight--; pump(); }, (e) => reject(e));
          }
          if (next >= chunks.length && inflight === 0) resolve();
        };
        pump();
      });
      for (const o of outcomes) {
        if (!o) throw new Error('internal: a chunk has no outcome');
        records.push(o.record);
        requests.push(o.request);
        claims.push(...o.claims);
        if (o.request.reused || o.request.chars === 0) continue;
        if (o.request.ok) {
          for (const [k, n] of Object.entries(o.droppedReasons ?? {})) dropped[k] = (dropped[k] ?? 0) + n;
          usageReports.push(o.usage ?? null);
        } else usageReports.push(null);
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
        profile,
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
    const complete = family === 'scopecheck' ? extractions.has('rfq') && docs.length === sample.docs.length : docs.length === sample.docs.length;
    // Blocks carrying a labelled exclusion (scoring only; no extraction or rule reads this).
    const exclusionBlocks: Record<string, Set<string>> = {};
    for (const doc of docs) {
      const lines = new Set(doc.facts.filter((f) => f.field === 'exclusion').map((f) => doc.lines[f.line]));
      exclusionBlocks[doc.id] = new Set((blocksByDoc.get(doc.id) ?? []).filter((b) => lines.has(b.text)).map((b) => b.id));
    }
    const scoreOf = (produced: Finding[]): FindingsBlock => ({
      produced: produced.map((f) => ({ code: f.code, subject: f.subjectId, response: f.responseDocId, severity: f.severity, state: f.state, reason: f.reason })),
      // Findings are only scored when every document of the sample was processed.
      score: complete
        ? scoreFindings(produced, sample.expectedFindings, { coverageConfirmed: !!opts.simulateCoverageConfirmation, mustNotFlag: sample.mustNotFlag, exclusionBlocks })
        : { expected: 0, produced: 0, matchedExactState: 0, conservative: [], missed: [], falseCritical: [], overConfident: [], unexpectedOther: [], mustNotFlagViolations: [] },
    });
    const scopeCtx = (identities?: IdentityReport['identities']) => {
      const data: ScopeData = { rfqDocId: 'rfq', quoteDocIds: ['quote-a', 'quote-b', 'quote-c'].filter((q) => extractions.has(q)), identities };
      return { ...base, matches: scopeMatches(effective, data), data };
    };
    const scopeRun = (identities?: IdentityReport['identities']): Finding[] => (extractions.has('rfq') ? runChecks(family, scopeCtx(identities)) : []);

    let sampleResult: SampleResult;
    if (family === 'scopecheck') {
      const before = complete ? scopeRun() : [];
      if (opts.identityRecovery === false) {
        sampleResult = { sampleId, docs: docResults, findings: scoreOf(before) };
      } else {
        const report = resolveItemIdentities(allFacts, [...blocksByDoc.values()].flat());
        const after = complete ? scopeRun(report.identities) : [];
        const planned = complete ? evaluateScope(scopeCtx(report.identities)).comparisons : undefined;
        const rfqLabelled = docs.find((d) => d.id === 'rfq');
        const quotations = docs.filter((d) => d.id !== 'rfq').length;
        const rows = rfqLabelled ? rfqLabelled.facts.filter((f) => f.field === 'item').length : 0;
        sampleResult = {
          comparisonCompleteness: planned && rfqLabelled ? { labelledRequirementRows: rows, quotations, aspects: 2, expected: rows * quotations * 2, planned: planned.length, complete: planned.length === rows * quotations * 2 } : undefined,
          sampleId,
          docs: docResults,
          findings: scoreOf(after),
          findingsBefore: scoreOf(before),
          comparisons: planned,
          identity: { recovered: report.recovered, uncertain: report.uncertain, counts: report.counts },
        };
      }
    } else {
      const data: PackData = { requirementsDocId: 'requirements', formDocId: 'application-form', otherDocIds: ['budget', 'registration'].filter((d) => extractions.has(d)) };
      const packCtx = { ...base, matches: packMatches(effective, data), data };
      const produced = complete ? runChecks(family, packCtx) : [];
      sampleResult = { sampleId, docs: docResults, findings: scoreOf(produced), comparisons: complete ? evaluatePack(packCtx).comparisons : undefined };
    }
    samples.push(sampleResult);
  }

  const docRes = samples.flatMap((s) => s.docs);
  const sum = (f: (d: DocResult) => number) => docRes.reduce((n, d) => n + f(d), 0);
  const okReqs = requests.filter((r) => r.ok && !r.reused);
  const sent = requests.filter((r) => r.code !== 'attempt_budget_exhausted' && r.code !== 'neuron_budget_exhausted' && !r.reused);
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
      concurrency: { requested: Math.max(1, Math.min(opts.concurrency ?? 1, MAX_CONCURRENCY)), peakInFlight, maxRepairAttempts: opts.maxRepairAttempts ?? 1, stoppedAfter: runStopped },
      elapsedMs: Date.now() - runStart,
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
    usage: summarizeUsage(usageReports, { mock: opts.mode === 'mock', measuredNeurons: opts.measuredNeurons, model: opts.mode === 'live' ? opts.model : undefined }),
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
    lines.push(`  ${sm.sampleId}/${d.docId} [${d.profile.id}${d.profile.source === 'recorded' ? '' : ' inferred'}]: coverage=${d.coverage.state} processing-complete=${d.processingComplete} issues=${d.issues.length} outcomes=${JSON.stringify(d.extraction.outcomes)}`);
  }
  for (const sm of r.samples) {
    if (sm.comparisons) {
      const c = sm.comparisons;
      if (sm.comparisonCompleteness) lines.push(`  ${sm.sampleId} comparison completeness (label diagnostic): ${sm.comparisonCompleteness.labelledRequirementRows} rows x ${sm.comparisonCompleteness.quotations} quotations x ${sm.comparisonCompleteness.aspects} aspects = ${sm.comparisonCompleteness.expected} expected, ${sm.comparisonCompleteness.planned} planned: ${sm.comparisonCompleteness.complete ? 'complete' : 'INCOMPLETE (a comparison is missing from the ledger)'}`);
      lines.push(`  ${sm.sampleId} comparisons: ${c.length} planned, agree=${c.filter((x) => x.status === 'agree').length} flagged=${c.filter((x) => x.status === 'flagged').length} NOT EVALUATED=${c.filter((x) => x.status === 'not_evaluated').length}`);
      for (const x of c.filter((y) => y.status === 'not_evaluated')) lines.push(`    not evaluated: ${x.id} (${x.reason})`);
    }
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
