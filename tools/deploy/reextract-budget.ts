// One-off, single-attempt re-extraction of the PackCheck budget document on the throwaway, token-gated staging Worker
// (wrangler.gate.toml, deployed with DAILY_ADMISSION_CEILING=1). Purpose: after samples/packcheck/budget.pdf was changed
// (its end date is written with a month name), record the model's output for the CURRENT PDF so the app fixture is recorded
// output again, not an edited recording.
//
//   GATE_URL=https://skeleton-key-extraction-gate.<subdomain>.workers.dev npx tsx tools/deploy/reextract-budget.ts
//
// Safeguards, each with a test (reextract-budget.test.ts):
//  - exactly ONE inference attempt: one POST, never a retry, whatever the outcome; the Worker itself is deployed with ceiling 1
//    and a neuron budget just above the one reservation, so a repair or a second request is refused by the Worker as well
//  - the request is built as the browser client builds it (chunkForSchema, toRequestBlock) from the CURRENT PDF, with the
//    frozen v2 PackCheck profile; it must be exactly one chunk
//  - nothing is sent unless /health shows the gate in token mode with the credential bound, ceiling 1, counter 0 and a
//    ledger with nothing charged; and the guaranteed worst case of the attempt is within the run cap
//  - the URL must be the staging gate Worker; the bearer token is read from the git-ignored secret file and never written
//  - the result is written after the request and again after the final health check, so a failure keeps what was done
//  - the recording keeps the Worker's returned claims byte for byte: no value or excerpt is edited
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { toRequestBlock, type Block } from '@skeleton-key/engine';
import { chunkForSchema } from '../../packages/ui/src/schema-fields';
import { PROFILES, buildMessages } from '../../services/extraction-api/src/profiles';
import { BYTES_PER_TOKEN_STRICT, SAFETY_MARGIN, worstCaseNeurons } from '../benchmark/src/budget';
import { loadBlocks, loadSample } from '../benchmark/src/samples';
import { estimateNeurons } from '../benchmark/src/usage';

export const SAMPLE = 'packcheck';
export const DOC = 'budget';
export const SCHEMA_ID = 'packcheck.grant.v2';
export const TEST_ORIGIN = 'https://gate-test-client.invalid';
export const TIMEOUT_MS = 25_000;
export const MAX_ATTEMPTS = 1;
export const RUN_NEURON_CAP = 2_000;
const REPO = new URL('../../', import.meta.url).pathname;
export const SECRET_FILE = join(REPO, '.benchmark-state', 'gate', 'secret');
export const GATE_URL_RE = /^https:\/\/skeleton-key-extraction-gate\.[a-z0-9-]+\.workers\.dev$/;

export type Http = (path: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json: unknown; ms: number }>;

export type Request1 = { body: string; blocks: Block[]; bodyBytes: number; sha256: string; blocksSent: number; reservation: number; model: string };

/** The request the browser client would send for the current budget PDF: one chunk, v2 profile, request blocks only. */
export async function buildRequest(): Promise<Request1> {
  const doc = loadSample(SAMPLE).docs.find((d) => d.id === DOC)!;
  const blocks = await loadBlocks(SAMPLE, doc);
  const { chunks, oversized } = chunkForSchema(SCHEMA_ID, blocks);
  if (chunks.length !== 1 || oversized.length > 0) throw new Error(`expected exactly one chunk and nothing oversized, got ${chunks.length} chunk(s) and ${oversized.length} oversized`);
  const sent = chunks[0]!.map((b) => toRequestBlock(b));
  const body = JSON.stringify({ schemaId: SCHEMA_ID, blocks: sent });
  const profile = PROFILES[SCHEMA_ID]!;
  // The guaranteed (1 byte per token) worst case of the one attempt; a repair is never allowed to happen.
  const reservation = Math.ceil(worstCaseNeurons({ messages: buildMessages(profile, sent, false), max_tokens: profile.maxOutputTokens }, profile.model, BYTES_PER_TOKEN_STRICT).neurons * 1000) / 1000;
  return { body, blocks, bodyBytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex'), blocksSent: sent.length, reservation, model: profile.model };
}

export type ReextractResult = {
  gateUrl: string;
  startedAt: string;
  endedAt: string | null;
  verdict: 'pass' | 'fail';
  stop: string | null;
  attemptsSent: number;
  maxAttempts: number;
  request: { sha256: string; bodyBytes: number; blocksSent: number; schemaId: string; model: string; guaranteedWorstCaseNeurons: number } | null;
  healthBefore: unknown;
  healthAfter: unknown;
  response: { status: number; ms: number; code: string; claims: unknown[] | null; meta: unknown } | null;
  usage: { promptTokens: number; completionTokens: number } | null;
  neurons: { estimateBeforeMargin: number | null; chargeWithMargin: number | null; basis: string };
  counterEnd: number | null;
};

type Health = { ok?: boolean; checks?: { configuration?: string; accessGate?: { mode?: string; valid?: boolean; credentialBound?: boolean }; admission?: { dailyCeiling?: number; open?: boolean }; durableObject?: { usedToday?: number | null; budgetToday?: { attempts?: number; charged?: number } } } };

export function healthProblem(h: Health, status: number): string | null {
  const c = h.checks;
  if (status !== 200 || !h.ok) return `health ${status}`;
  if (c?.accessGate?.mode !== 'token' || !c.accessGate.valid || !c.accessGate.credentialBound) return 'the gate is not in token mode with the credential bound';
  if (c.admission?.dailyCeiling !== 1) return `ceiling is ${c.admission?.dailyCeiling}, not 1`;
  if ((c.durableObject?.usedToday ?? 1) !== 0) return `counter is ${c.durableObject?.usedToday}, not 0`;
  if ((c.durableObject?.budgetToday?.charged ?? 1) !== 0) return 'the ledger already has charges';
  return null;
}

export async function runReextract(o: { http: Http; token: string; request: Request1; persist?: (r: ReextractResult) => void; now?: () => number; gateUrl?: string }): Promise<ReextractResult> {
  const now = o.now ?? Date.now;
  const r: ReextractResult = {
    gateUrl: o.gateUrl ?? '', startedAt: new Date(now()).toISOString(), endedAt: null, verdict: 'fail', stop: null, attemptsSent: 0, maxAttempts: MAX_ATTEMPTS,
    request: { sha256: o.request.sha256, bodyBytes: o.request.bodyBytes, blocksSent: o.request.blocksSent, schemaId: SCHEMA_ID, model: o.request.model, guaranteedWorstCaseNeurons: o.request.reservation },
    healthBefore: null, healthAfter: null, response: null, usage: null, counterEnd: null,
    neurons: { estimateBeforeMargin: null, chargeWithMargin: null, basis: 'ESTIMATE from the reported tokens at the repo rates; not dashboard-confirmed' },
  };
  const save = () => o.persist?.(r);
  const finish = (stop: string | null) => {
    r.stop = stop;
    r.endedAt = new Date(now()).toISOString();
    save();
    return r;
  };
  if (o.request.reservation > RUN_NEURON_CAP) return finish(`the guaranteed worst case ${o.request.reservation} exceeds the run cap ${RUN_NEURON_CAP}`);
  const h0 = await o.http('/health', { method: 'GET', headers: {} });
  r.healthBefore = h0.json;
  const problem = healthProblem(h0.json as Health, h0.status);
  if (problem) return finish(`precheck: ${problem}`);
  save();

  // The one attempt. No retry on any outcome.
  r.attemptsSent = 1;
  let res: Awaited<ReturnType<Http>>;
  try {
    res = await o.http('/extract', { method: 'POST', headers: { 'content-type': 'application/json', origin: TEST_ORIGIN, authorization: `Bearer ${o.token}` }, body: o.request.body });
  } catch (e) {
    return finish(`request failed: ${(e as Error).name}`);
  }
  const body = (res.json ?? {}) as { claims?: unknown; meta?: { usage?: { promptTokens?: unknown; completionTokens?: unknown } }; error?: { code?: string } };
  const claims = Array.isArray(body.claims) ? body.claims : null;
  r.response = { status: res.status, ms: res.ms, code: body.error?.code ?? (res.status === 200 ? 'ok' : 'unknown'), claims, meta: body.meta ?? null };
  const u = body.meta?.usage;
  if (typeof u?.promptTokens === 'number' && typeof u.completionTokens === 'number') {
    r.usage = { promptTokens: u.promptTokens, completionTokens: u.completionTokens };
    const est = estimateNeurons(u.promptTokens, u.completionTokens, o.request.model);
    r.neurons = { ...r.neurons, estimateBeforeMargin: est, chargeWithMargin: est * SAFETY_MARGIN };
  }
  save();
  const h1 = await o.http('/health', { method: 'GET', headers: {} }).catch(() => null);
  r.healthAfter = h1?.json ?? null;
  r.counterEnd = (h1?.json as Health | undefined)?.checks?.durableObject?.usedToday ?? null;
  if (res.status !== 200 || !claims) return finish(`extraction failed: HTTP ${res.status} ${r.response.code}`);
  if (!r.usage) return finish('no token usage reported');
  if (res.ms >= TIMEOUT_MS) return finish(`latency ${res.ms} ms at or above the ${TIMEOUT_MS} ms timeout`);
  if (r.counterEnd !== 1) return finish(`counter ended at ${r.counterEnd}, not 1`);
  r.verdict = 'pass';
  return finish(null);
}

/** A recording the fixture builder can read (samples[].docs[]: docId, profile.id, claimsReturned), with its provenance. */
export function toRecording(r: ReextractResult, ctx: { workerCommit: string; budgetPdfSha256: string }) {
  if (r.verdict !== 'pass' || !r.response?.claims) throw new Error('only a passed run is recorded');
  return {
    kind: 'staging-worker-recording',
    mode: 'live',
    label: 'packcheck-budget-v2-staging-worker',
    model: r.request!.model,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    provenance: {
      note: 'One extraction request of the CURRENT samples/packcheck/budget.pdf through the token-gated staging Worker (ceiling 1, no repair, no retry). claimsReturned is the Worker response byte for byte; nothing was edited.',
      workerCommit: ctx.workerCommit,
      budgetPdfSha256: ctx.budgetPdfSha256,
      request: r.request,
      attemptsSent: r.attemptsSent,
      latencyMs: r.response.ms,
      usage: r.usage,
      neurons: r.neurons,
      workerMeta: r.response.meta,
      replaces: 'samples/benchmark-results/live-packcheck-budget-v2-2026-11-01T03-00-38-750Z.json (kept unchanged)',
    },
    settings: { inferenceTimeoutMs: TIMEOUT_MS, maxRepairAttempts: 0, note: 'The staging Worker was deployed with DAILY_ADMISSION_CEILING=1, so no repair or second request could be admitted.' },
    samples: [{ sampleId: SAMPLE, docs: [{ docId: DOC, profile: { id: SCHEMA_ID, source: 'recorded' }, claimsReturned: r.response.claims }] }],
  };
}

export const readToken = (file = SECRET_FILE): string => {
  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) throw new Error(`refusing to use ${file}: permissions ${mode.toString(8)} are wider than 600`);
  const v = readFileSync(file, 'utf8');
  if (!/^[A-Za-z0-9_-]{43}$/.test(v)) throw new Error(`${file} does not hold a generated secret`);
  return v;
};

if (process.argv[1]?.endsWith('reextract-budget.ts')) {
  const baseUrl = (process.env.GATE_URL ?? '').replace(/\/$/, '');
  if (!GATE_URL_RE.test(baseUrl)) {
    console.error('GATE_URL must be the staging gate Worker (https://skeleton-key-extraction-gate.<subdomain>.workers.dev), never the production Worker');
    process.exit(2);
  }
  const http: Http = async (path, init) => {
    const t = performance.now();
    const res = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS + 10_000) });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, ms: Math.round(performance.now() - t) };
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const partial = join(REPO, 'docs', 'results', 'budget-reextract-run.json');
  mkdirSync(dirname(partial), { recursive: true });
  const request = await buildRequest();
  const result = await runReextract({ http, token: readToken(process.env.GATE_SECRET_FILE ?? SECRET_FILE), request, gateUrl: baseUrl, persist: (r) => writeFileSync(partial, JSON.stringify(r, null, 2) + '\n') });
  let recorded: string | null = null;
  if (result.verdict === 'pass') {
    const workerCommit = process.env.WORKER_COMMIT ?? 'unknown';
    const pdf = join(REPO, 'samples', 'packcheck', 'budget.pdf');
    const rec = toRecording(result, { workerCommit, budgetPdfSha256: createHash('sha256').update(readFileSync(pdf)).digest('hex') });
    recorded = join('samples', 'benchmark-results', `live-packcheck-budget-v2-staging-worker-${stamp}.json`);
    if (existsSync(join(REPO, recorded))) throw new Error('refusing to overwrite a recording');
    writeFileSync(join(REPO, recorded), JSON.stringify(rec, null, 2) + '\n');
  }
  console.log(JSON.stringify({ verdict: result.verdict, stop: result.stop, attemptsSent: result.attemptsSent, counterEnd: result.counterEnd, status: result.response?.status ?? null, ms: result.response?.ms ?? null, claims: result.response?.claims?.length ?? null, usage: result.usage, estimateBeforeMargin: result.neurons.estimateBeforeMargin, chargeWithMargin: result.neurons.chargeWithMargin, recording: recorded, result: 'docs/results/budget-reextract-run.json' }, null, 2));
  process.exit(result.verdict === 'pass' ? 0 : 1);
}
