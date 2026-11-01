import type { Block, ChunkLimits } from '@skeleton-key/engine';
import { chunkForSchema } from './schema-fields';

// Browser client for the extraction Worker (design section on the client bounds; R5.4, R8.8, R8.10).
//
//  - Text leaves the device ONLY when `extractDocument` is called, which the UI does only after the user
//    presses Analyse. The request body is exactly {schemaId, blocks:[{id,text}]}: no filename, no model name.
//  - Bounded: at most MAX_CHUNKS_PER_DOC chunks per document and MAX_CALLS_PER_SESSION requests per session.
//    The Worker owns the single counted repair; the client never retries on its own.
//  - A chunk that fails (any error) is recorded as FAILED with its block ids. A failed or unsent chunk is never
//    treated as covered: the document is "processing incomplete" and no absence against it can be confirmed.
//  - A quota, daily-limit or rate error stops the run at once (the remaining chunks are not sent) and keeps
//    everything already extracted. The user retries manually.

export const MAX_CHUNKS_PER_DOC = 8;
export const MAX_CALLS_PER_SESSION = 30;
/** Requests in flight at once for one document. The default is 1; the ceiling is 3. */
export const MAX_CONCURRENCY = 3;

/**
 * Uploaded documents are split by EXPECTED OUTPUT (schema-fields.ts): about 14 values per request, an estimate from
 * small benchmark samples. Production limits are task 5.5 and are NOT derived yet; a document that needs more than
 * MAX_CHUNKS_PER_DOC requests, or a chunk that fails, is reported as incomplete, never guessed. Passing `limits`
 * explicitly selects the size-only chunker (tests).
 */

export type ErrorKind = 'daily_limit' | 'rate_limited' | 'quota_exhausted' | 'model_unavailable' | 'timeout' | 'schema_invalid' | 'limiter_unavailable' | 'too_large' | 'origin_denied' | 'not_configured' | 'invalid_input' | 'network' | 'unknown';

/** What the user is told, in plain words, for each failure. Never echoes the response body. */
export const ERROR_TEXT: Record<ErrorKind, { text: string; recoverable: boolean; stopsRun: boolean }> = {
  daily_limit: { text: 'The daily analysis allowance has been used (it resets at 00:00 UTC), or analysis has not been opened yet. Your documents and anything already extracted are kept. Try again later.', recoverable: true, stopsRun: true },
  rate_limited: { text: 'Too many requests just now. Wait a moment and try again.', recoverable: true, stopsRun: true },
  quota_exhausted: { text: 'The AI service quota is used up, so analysis is temporarily unavailable. Everything already extracted is kept.', recoverable: true, stopsRun: true },
  model_unavailable: { text: 'The AI service is temporarily unavailable. Try again shortly.', recoverable: true, stopsRun: true },
  limiter_unavailable: { text: 'Usage control is unavailable, so analysis is closed until it recovers.', recoverable: true, stopsRun: true },
  timeout: { text: 'The AI service did not answer in time for one part of a document. That part is marked not processed.', recoverable: true, stopsRun: false },
  schema_invalid: { text: 'The AI service returned an unusable answer for one part of a document. That part is marked not processed.', recoverable: true, stopsRun: false },
  too_large: { text: 'One part of a document was too large to send.', recoverable: false, stopsRun: false },
  origin_denied: { text: 'This site is not allowed to use the analysis service.', recoverable: false, stopsRun: true },
  not_configured: { text: 'The analysis service is not configured.', recoverable: false, stopsRun: true },
  invalid_input: { text: 'One part of a document could not be sent.', recoverable: false, stopsRun: false },
  network: { text: 'The analysis service could not be reached. Check your connection and try again.', recoverable: true, stopsRun: true },
  unknown: { text: 'Analysis failed for an unknown reason. Try again.', recoverable: true, stopsRun: false },
};

export type ChunkStatus = { index: number; blockIds: string[]; status: 'ok' | 'failed' | 'not_sent'; error?: ErrorKind; claims: number };

export type DocumentResult = {
  docId: string;
  blocks: Block[];
  claims: unknown[];
  chunks: ChunkStatus[];
  /** set when the run stopped for this reason before every chunk was sent */
  stoppedBy?: ErrorKind;
};

export type ClientConfig = {
  /** base URL of the Worker, for example https://extract.example.workers.dev (no trailing slash needed) */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  limits?: ChunkLimits;
  /** requests in flight at once, 1 to 3 (default 1: in order) */
  concurrency?: number;
};

export type ClientSession = { calls: number };
export const newClientSession = (): ClientSession => ({ calls: 0 });

const KNOWN = new Set<string>(Object.keys(ERROR_TEXT));
const kindOf = (code: unknown): ErrorKind => (typeof code === 'string' && KNOWN.has(code) ? (code as ErrorKind) : 'unknown');

/** One request. Returns claims or an error kind. */
async function send(cfg: ClientConfig, schemaId: string, blocks: Block[], signal?: AbortSignal): Promise<{ ok: true; claims: unknown[] } | { ok: false; error: ErrorKind }> {
  const doFetch = cfg.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schemaId, blocks: blocks.map((b) => ({ id: b.id, text: b.text })) }),
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  let body: { claims?: unknown; error?: { code?: unknown } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // non-JSON body
  }
  if (res.status === 200 && Array.isArray(body.claims)) return { ok: true, claims: body.claims };
  return { ok: false, error: kindOf(body.error?.code) };
}

/**
 * Extract one document in chunks, in order. `only` re-sends just those chunk indexes (a manual retry of failed
 * chunks); earlier results are passed in `previous` and kept.
 */
export async function extractDocument(
  cfg: ClientConfig,
  session: ClientSession,
  doc: { docId: string; schemaId: string; blocks: Block[] },
  opts: { previous?: DocumentResult; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<DocumentResult> {
  const { chunks, oversized } = chunkForSchema(doc.schemaId, doc.blocks, cfg.limits);
  const result: DocumentResult = {
    docId: doc.docId,
    blocks: doc.blocks,
    claims: [],
    chunks: chunks.map((c, index) => ({ index, blockIds: c.map((b) => b.id), status: 'not_sent' as const, claims: 0 })),
  };
  // Blocks that cannot be sent at all are a failed chunk of their own: they are never silently dropped.
  for (const b of oversized) result.chunks.push({ index: result.chunks.length, blockIds: [b.id], status: 'failed', error: 'too_large', claims: 0 });
  if (chunks.length > MAX_CHUNKS_PER_DOC) {
    // Too long for this version: nothing is sent, and the document is reported as not processed.
    for (const c of result.chunks) if (c.status === 'not_sent') c.status = 'failed';
    result.stoppedBy = 'too_large';
    return result;
  }
  const perChunkClaims: unknown[][] = chunks.map(() => []);
  const prev = opts.previous;
  if (prev) {
    // carry over what already succeeded
    chunks.forEach((c, i) => {
      const old = prev.chunks[i];
      if (old && old.status === 'ok' && old.blockIds.join() === c.map((b) => b.id).join()) {
        result.chunks[i] = old;
        const ids = new Set(old.blockIds);
        perChunkClaims[i] = (prev.claims as { blockId?: string }[]).filter((cl) => ids.has(cl.blockId ?? ''));
      }
    });
  }
  const todo = chunks.map((_, i) => i).filter((i) => result.chunks[i]!.status !== 'ok');
  let done = chunks.length - todo.length;
  opts.onProgress?.(done, chunks.length);
  // Bounded concurrency (default 1 = in order). The decision to send is made synchronously, so the call counter and the
  // stop flag are checked and updated in one step: two chunks can never both take the last allowed call. After a stopping
  // error nothing new is sent; requests already in flight finish and are recorded (they cannot be cancelled in the Worker).
  const width = Math.max(1, Math.min(Math.floor(cfg.concurrency ?? 1), MAX_CONCURRENCY));
  const queue = [...todo];
  const one = async (i: number) => {
    const r = await send(cfg, doc.schemaId, chunks[i]!, opts.signal);
    if (r.ok) {
      result.chunks[i] = { index: i, blockIds: chunks[i]!.map((b) => b.id), status: 'ok', claims: r.claims.length };
      perChunkClaims[i] = r.claims;
    } else {
      result.chunks[i] = { index: i, blockIds: chunks[i]!.map((b) => b.id), status: 'failed', error: r.error, claims: 0 };
      if (ERROR_TEXT[r.error].stopsRun) result.stoppedBy ??= r.error;
    }
    done++;
    opts.onProgress?.(done, chunks.length);
  };
  const worker = async () => {
    for (;;) {
      if (result.stoppedBy || opts.signal?.aborted) return; // a stopping error: do not send the rest
      const i = queue.shift();
      if (i === undefined) return;
      if (session.calls >= MAX_CALLS_PER_SESSION) {
        result.stoppedBy ??= 'rate_limited';
        return;
      }
      session.calls++;
      await one(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, worker));
  result.claims = perChunkClaims.flat();
  return result;
}

/**
 * Extract several documents in order. A stopping error (daily allowance, quota, network and the like) ends the whole
 * run at once: documents not yet started are returned as NOT SENT (never as empty-but-complete), and everything
 * already extracted is kept. `previous` (results of an earlier run) turns this into a manual retry that re-sends
 * only the failed or unsent chunks.
 */
export async function analyseAll(
  cfg: ClientConfig,
  session: ClientSession,
  docs: { docId: string; schemaId: string; blocks: Block[] }[],
  opts: { previous?: Record<string, DocumentResult>; signal?: AbortSignal; onProgress?: (docId: string, done: number, total: number) => void } = {},
): Promise<{ results: DocumentResult[]; stoppedBy: ErrorKind | null }> {
  const results: DocumentResult[] = [];
  let stoppedBy: ErrorKind | null = null;
  for (const doc of docs) {
    const previous = opts.previous?.[doc.docId];
    if (stoppedBy) {
      const { chunks } = chunkForSchema(doc.schemaId, doc.blocks, cfg.limits);
      results.push(previous ?? { docId: doc.docId, blocks: doc.blocks, claims: [], chunks: chunks.map((c, index) => ({ index, blockIds: c.map((b) => b.id), status: 'not_sent' as const, claims: 0 })), stoppedBy });
      continue;
    }
    const r = await extractDocument(cfg, session, doc, { previous, signal: opts.signal, onProgress: (d, t) => opts.onProgress?.(doc.docId, d, t) });
    results.push(r);
    if (r.stoppedBy && ERROR_TEXT[r.stoppedBy].stopsRun) stoppedBy = r.stoppedBy;
  }
  return { results, stoppedBy: stoppedBy ?? results.find((r) => r.stoppedBy)?.stoppedBy ?? null };
}
