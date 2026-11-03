import { describe, expect, it } from 'vitest';
import type { Block } from '@skeleton-key/engine';
import { analyseAll, newClientSession, planEntry, refusalText, type ClientConfig } from './extraction-client';

// Whole-run admission on the client: the run is priced and held (or refused) before any document text is sent.

const block = (i: number, chars = 500): Block => ({ id: `p1-l${i}`, docId: 'd', kind: 'pdf-run', text: `secret line ${i} `.padEnd(chars, 'x'), page: 1, bbox: [0, 0, 1, 1] });
const blocks = (n: number) => Array.from({ length: n }, (_, i) => block(i + 1));
const LIMITS = { maxChars: 1200, maxBlocks: 400 }; // two 500-character lines per chunk
const docs = [{ docId: 'a', schemaId: 'scopecheck.quote.v1', blocks: blocks(4) }, { docId: 'b', schemaId: 'scopecheck.quote.v1', blocks: blocks(2) }];

type Seen = { path: string; body: Record<string, unknown> };
function worker(opts: { run?: { status: number; body: unknown }; failExtract?: (n: number) => boolean } = {}) {
  const seen: Seen[] = [];
  let extracts = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    seen.push({ path, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
    if (path === '/run') return opts.run ? json(opts.run.status, opts.run.body) : json(200, { runId: 7, token: 'k'.repeat(32), holdNeurons: 900, attempts: 3, budget: 4000, remaining: 3100 });
    if (path === '/run/close') return json(200, { closed: true });
    extracts++;
    if (opts.failExtract?.(extracts)) return json(502, { error: { code: 'schema_invalid' } });
    return json(200, { claims: (body.blocks as { id: string }[]).map((b) => ({ field: 'item', blockId: b.id, excerpt: 'x', value: 'x' })), meta: {} });
  }) as unknown as typeof fetch;
  const cfg: ClientConfig = { baseUrl: 'https://w.example', fetchImpl, limits: LIMITS };
  return { cfg, seen, get extracts() { return extracts; } };
}

describe('the run is priced before anything is sent', () => {
  it('the first request is the plan: sizes and counts only, no document text, and the sizes are exact', async () => {
    const w = worker();
    await analyseAll(w.cfg, newClientSession(), docs);
    expect(w.seen[0]!.path).toBe('/run');
    expect(Object.keys(w.seen[0]!.body)).toEqual(['plan']);
    const plan = w.seen[0]!.body.plan as Record<string, unknown>[];
    expect(plan).toHaveLength(3); // two chunks of document a, one of b
    for (const e of plan) expect(Object.keys(e).sort()).toEqual(['bodyBytes', 'schemaId', 'values']);
    expect(JSON.stringify(w.seen[0]!.body)).not.toMatch(/secret line|xxxx/);
    // the planned size is the size of the request body that is then sent (without the run reference)
    const sent = w.seen.filter((s) => s.path === '/extract');
    sent.forEach((s, i) => {
      const { run: _run, ...rest } = s.body;
      void _run;
      expect(new TextEncoder().encode(JSON.stringify(rest)).byteLength).toBe(plan[i]!.bodyBytes);
    });
  });

  it('planEntry is the same for the same chunk and carries the expected value count', () => {
    const e = planEntry('scopecheck.quote.v1', blocks(2));
    expect(e).toMatchObject({ schemaId: 'scopecheck.quote.v1' });
    expect(e.bodyBytes).toBeGreaterThan(1000);
    expect(e).toEqual(planEntry('scopecheck.quote.v1', blocks(2)));
  });

  it('every request names the run and its place in the plan, in order across documents; the run is closed at the end', async () => {
    const w = worker();
    const r = await analyseAll(w.cfg, newClientSession(), docs);
    const sent = w.seen.filter((s) => s.path === '/extract').map((s) => s.body.run);
    expect(sent).toEqual([0, 1, 2].map((chunk) => ({ id: 7, token: 'k'.repeat(32), chunk })));
    expect(w.seen.at(-1)).toMatchObject({ path: '/run/close', body: { runId: 7 } });
    expect(r.stoppedBy).toBeNull();
    expect(r.results.every((x) => x.chunks.every((c) => c.status === 'ok'))).toBe(true);
  });
});

describe('a run that does not fit is refused up front', () => {
  const refused = { status: 429, body: { error: { code: 'run_exceeds_allowance', need: 3500, remaining: 1200, budget: 4000 } } };

  it('sends no document text at all, marks every part not sent, and says why in plain words with the numbers', async () => {
    const w = worker({ run: refused });
    const r = await analyseAll(w.cfg, newClientSession(), docs);
    expect(w.seen.map((s) => s.path)).toEqual(['/run']);
    expect(w.extracts).toBe(0);
    expect(r.stoppedBy).toBe('run_exceeds_allowance');
    expect(r.results.every((x) => x.chunks.every((c) => c.status === 'not_sent'))).toBe(true);
    const t = refusalText(r.refusal!);
    expect(t).toMatch(/about 88% of today's analysis allowance, and about 30% is left/);
    expect(t).toMatch(/nothing was sent/i);
    expect(t).toMatch(/00:00 UTC/);
    expect(t).toMatch(/sample sets/);
    expect(t).not.toMatch(/neuron|run_exceeds|daily_limit|_/i);
  });

  it('the other refusals are plain too: busy, closed or used up, and an unreachable service', async () => {
    for (const [code, re] of [['run_busy', /Other analyses are running/], ['daily_limit', /allowance has been used|not available right now/]] as const) {
      const w = worker({ run: { status: 429, body: { error: { code } } } });
      const r = await analyseAll(w.cfg, newClientSession(), docs);
      expect(w.extracts).toBe(0);
      expect(refusalText(r.refusal!)).toMatch(re);
    }
    const net = { cfg: { baseUrl: 'https://w.example', fetchImpl: (async () => { throw new TypeError('down'); }) as unknown as typeof fetch, limits: LIMITS } as ClientConfig };
    const r = await analyseAll(net.cfg, newClientSession(), docs);
    expect(r.stoppedBy).toBe('network');
  });
});

describe('a manual retry prices only what it will send', () => {
  it('plans just the parts that failed', async () => {
    const first = worker({ failExtract: (n) => n === 2 });
    const a = await analyseAll(first.cfg, newClientSession(), docs);
    expect(a.results[0]!.chunks.map((c) => c.status)).toEqual(['ok', 'failed']);
    const retry = worker();
    const b = await analyseAll(retry.cfg, newClientSession(), docs, { previous: Object.fromEntries(a.results.map((r) => [r.docId, r])) });
    expect((retry.seen[0]!.body.plan as unknown[]).length).toBe(1);
    expect(retry.seen.filter((s) => s.path === '/extract')).toHaveLength(1);
    expect(retry.seen.filter((s) => s.path === '/extract')[0]!.body.run).toMatchObject({ chunk: 0 });
    expect(b.results.every((x) => x.chunks.every((c) => c.status === 'ok'))).toBe(true);
  });

  it('a retry with nothing to send asks for no allowance at all', async () => {
    const w = worker();
    const a = await analyseAll(w.cfg, newClientSession(), docs);
    const again = worker();
    await analyseAll(again.cfg, newClientSession(), docs, { previous: Object.fromEntries(a.results.map((r) => [r.docId, r])) });
    expect(again.seen).toHaveLength(0);
  });
});
