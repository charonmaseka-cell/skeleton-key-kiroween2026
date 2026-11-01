import { describe, expect, it } from 'vitest';
import type { Block } from '@skeleton-key/engine';
import { ERROR_TEXT, MAX_CALLS_PER_SESSION, MAX_CHUNKS_PER_DOC, extractDocument, newClientSession, type ClientConfig } from './extraction-client';

// The browser extraction client, against a fake Worker that follows the Worker's real contract.

const block = (i: number, chars = 500): Block => ({ id: `p1-l${i}`, docId: 'd', kind: 'pdf-run', text: `line ${i} `.padEnd(chars, 'x'), page: 1, bbox: [0, 0, 1, 1] });
const blocks = (n: number, chars?: number) => Array.from({ length: n }, (_, i) => block(i + 1, chars));
const LIMITS = { maxChars: 1200, maxBlocks: 400 }; // 500-character lines: two per chunk

type Reply = { status: number; body: unknown } | 'throw';
function fakeWorker(reply: (call: number, body: { schemaId: string; blocks: { id: string; text: string }[] }) => Reply) {
  const calls: { url: string; init: RequestInit; body: { schemaId: string; blocks: { id: string; text: string }[] } }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });
    const r = reply(calls.length, body);
    if (r === 'throw') throw new TypeError('network down');
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
const ok = (body: { blocks: { id: string }[] }): Reply => ({ status: 200, body: { claims: body.blocks.map((b) => ({ field: 'item', kind: 'text', blockId: b.id, excerpt: 'x', value: 'x' })), meta: {} } });
const err = (status: number, code: string): Reply => ({ status, body: { error: { code, message: 'fixed text' } } });
const cfg = (w: { fetchImpl: typeof fetch }): ClientConfig => ({ baseUrl: 'https://worker.example/', fetchImpl: w.fetchImpl, limits: LIMITS });
const doc = (n: number, chars?: number) => ({ docId: 'd', schemaId: 'scopecheck.quote.v1', blocks: blocks(n, chars) });

describe('what is sent', () => {
  it('only the schema id and the block ids and texts: no filename, no model, no credentials, no referrer', async () => {
    const w = fakeWorker((_, b) => ok(b));
    await extractDocument(cfg(w), newClientSession(), doc(2));
    const c = w.calls[0]!;
    expect(c.url).toBe('https://worker.example/extract');
    expect(Object.keys(c.body).sort()).toEqual(['blocks', 'schemaId']);
    expect(c.body.blocks.every((b) => Object.keys(b).sort().join() === 'id,text')).toBe(true);
    expect(c.init).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
});

describe('multi-chunk extraction', () => {
  it('splits a long document, sends the chunks in order, and returns every claim', async () => {
    const w = fakeWorker((_, b) => ok(b));
    const progress: string[] = [];
    const r = await extractDocument(cfg(w), newClientSession(), doc(6), { onProgress: (d, t) => progress.push(`${d}/${t}`) });
    expect(w.calls).toHaveLength(3);
    expect(r.chunks.map((c) => c.status)).toEqual(['ok', 'ok', 'ok']);
    expect(r.claims).toHaveLength(6);
    expect(r.chunks.flatMap((c) => c.blockIds)).toEqual(blocks(6).map((b) => b.id));
    expect(progress).toEqual(['0/3', '1/3', '2/3', '3/3']);
  });

  it('a chunk that fails is marked failed with its blocks; the others still succeed, and the run goes on (no silent retry)', async () => {
    const w = fakeWorker((n, b) => (n === 2 ? err(502, 'schema_invalid') : ok(b)));
    const r = await extractDocument(cfg(w), newClientSession(), doc(6));
    expect(w.calls).toHaveLength(3); // no automatic retry
    expect(r.chunks.map((c) => c.status)).toEqual(['ok', 'failed', 'ok']);
    expect(r.chunks[1]).toMatchObject({ error: 'schema_invalid', blockIds: ['p1-l3', 'p1-l4'] });
    expect(r.claims).toHaveLength(4);
    expect(r.stoppedBy).toBeUndefined();
  });

  it('a manual retry sends only the failed chunks and keeps what already succeeded', async () => {
    const first = fakeWorker((n, b) => (n === 2 ? err(504, 'timeout') : ok(b)));
    const s = newClientSession();
    const r1 = await extractDocument(cfg(first), s, doc(6));
    const second = fakeWorker((_, b) => ok(b));
    const r2 = await extractDocument(cfg(second), s, doc(6), { previous: r1 });
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]!.body.blocks.map((b) => b.id)).toEqual(['p1-l3', 'p1-l4']);
    expect(r2.chunks.map((c) => c.status)).toEqual(['ok', 'ok', 'ok']);
    expect(r2.claims).toHaveLength(6);
  });
});

describe('errors that stop the run keep everything already extracted', () => {
  for (const [code, status] of [['daily_limit', 429], ['quota_exhausted', 503], ['rate_limited', 429], ['model_unavailable', 503], ['limiter_unavailable', 503]] as const) {
    it(`${code}: the remaining chunks are NOT sent, are marked not processed, and the reason is recoverable text`, async () => {
      const w = fakeWorker((n, b) => (n === 2 ? err(status, code) : ok(b)));
      const r = await extractDocument(cfg(w), newClientSession(), doc(8));
      expect(w.calls).toHaveLength(2);
      expect(r.chunks.map((c) => c.status)).toEqual(['ok', 'failed', 'not_sent', 'not_sent']);
      expect(r.stoppedBy).toBe(code);
      expect(r.claims).toHaveLength(2);
      expect(ERROR_TEXT[code].recoverable).toBe(true);
    });
  }

  it('a network failure stops the run too', async () => {
    const w = fakeWorker(() => 'throw');
    const r = await extractDocument(cfg(w), newClientSession(), doc(4));
    expect(w.calls).toHaveLength(1);
    expect(r.stoppedBy).toBe('network');
  });

  it('an unknown error code, or a non-JSON body, is a failed chunk with a generic message; the body is never echoed', async () => {
    const w = fakeWorker((n, b) => (n === 1 ? { status: 500, body: { error: { code: 'something_new', message: 'SECRET document text' } } } : ok(b)));
    const r = await extractDocument(cfg(w), newClientSession(), doc(4));
    expect(r.chunks[0]).toMatchObject({ status: 'failed', error: 'unknown' });
    expect(JSON.stringify(ERROR_TEXT)).not.toContain('SECRET');
  });
});

describe('bounds', () => {
  it(`a document needing more than ${MAX_CHUNKS_PER_DOC} chunks is not sent at all, and is reported as not processed`, async () => {
    const w = fakeWorker((_, b) => ok(b));
    const r = await extractDocument(cfg(w), newClientSession(), doc(2 * (MAX_CHUNKS_PER_DOC + 1)));
    expect(w.calls).toHaveLength(0);
    expect(r.stoppedBy).toBe('too_large');
    expect(r.chunks.every((c) => c.status === 'failed')).toBe(true);
  });

  it(`the session never sends more than ${MAX_CALLS_PER_SESSION} requests`, async () => {
    const w = fakeWorker((_, b) => ok(b));
    const s = newClientSession();
    s.calls = MAX_CALLS_PER_SESSION - 1;
    const r = await extractDocument(cfg(w), s, doc(6));
    expect(w.calls).toHaveLength(1);
    expect(r.chunks.map((c) => c.status)).toEqual(['ok', 'not_sent', 'not_sent']);
    expect(s.calls).toBe(MAX_CALLS_PER_SESSION);
  });

  it('a single line longer than the chunk limit is a failed chunk of its own (never dropped); the rest is sent', async () => {
    const w = fakeWorker((_, b) => ok(b));
    const d = doc(3);
    d.blocks[1] = block(2, 5000);
    const r = await extractDocument(cfg(w), newClientSession(), d);
    expect(r.chunks.some((c) => c.status === 'failed' && c.error === 'too_large' && c.blockIds.join() === 'p1-l2')).toBe(true);
    expect(w.calls.length).toBeGreaterThan(0);
  });
});
