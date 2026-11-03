import { describe, expect, it } from 'vitest';
import { analyseAll, buildLiveFixture, confirmDocumentCoverage, emptySession, evaluateSession, newClientSession, type ClientConfig, type Fixture } from '@skeleton-key/ui';
import { packCheckAdapter } from './adapter';
import { PACKCHECK_SLOTS } from './App';
import { FIXTURES } from './fixtures';

// The PackCheck live path without a model: the sample pack's source text goes through the real browser client (chunked
// by expected output) to a FAKE Worker that answers with the recorded claims, then through the same validation, rules,
// review and export as the sample pack. No inference is made.

const pack = FIXTURES[0]!;
const keyOf = (f: { code: string; fingerprint: string; state: string }) => `${f.code}|${f.fingerprint}|${f.state}`;
const run = (f: Fixture, s = emptySession()) => evaluateSession(packCheckAdapter, f, s, 1);

function fakeWorker(fail: (n: number) => { status: number; code: string } | null = () => null) {
  let n = 0;
  const bodies: { schemaId: string; blocks: { id: string; text: string }[] }[] = [];
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    if (/\/run(\/close)?$/.test(String(_u))) return new Response(JSON.stringify({ runId: 1, token: 't'.repeat(32), holdNeurons: 1, attempts: 1, budget: 4000, remaining: 3999, closed: true }), { status: 200 });
    const body = JSON.parse(String(init.body)) as (typeof bodies)[number];
    bodies.push(body);
    n++;
    const f = fail(n);
    if (f) return new Response(JSON.stringify({ error: { code: f.code } }), { status: f.status });
    const ids = new Map(body.blocks.map((b) => [b.id, b.text]));
    const src = pack.docs.find((d) => body.blocks.every((b) => d.blocks.some((x) => x.id === b.id && x.text === b.text)));
    const claims = (src?.claims as { blockId: string }[] | undefined)?.filter((c) => ids.has(c.blockId)) ?? [];
    return new Response(JSON.stringify({ claims, meta: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies, get requests() { return n; } };
}

async function analyse(w: ReturnType<typeof fakeWorker>, limits?: { maxChars: number; maxBlocks: number }) {
  const cfg: ClientConfig = { baseUrl: 'https://worker.example', fetchImpl: w.fetchImpl, limits };
  const docs = pack.docs.map((d) => ({ docId: d.id, schemaId: PACKCHECK_SLOTS.find((s) => s.id === d.id)!.schemaId, blocks: d.blocks }));
  const { results } = await analyseAll(cfg, newClientSession(), docs);
  const fixture = buildLiveFixture(results.map((r, i) => ({ id: r.docId, role: PACKCHECK_SLOTS.find((s) => s.id === r.docId)!.role, title: `${r.docId}.pdf`, profile: docs[i]!.schemaId, result: r })));
  return { fixture, results };
}

describe('PackCheck live path with a fake Worker', () => {
  it('produces the same findings as the sample pack, labelled live, with every document processed and coverage unverified', async () => {
    const w = fakeWorker();
    const { fixture, results } = await analyse(w);
    const sample = run(pack);
    const live = run(fixture);
    expect(live.items.map((i) => keyOf(i.finding)).sort()).toEqual(sample.items.map((i) => keyOf(i.finding)).sort());
    expect(Object.values(results).every((r) => r.chunks.every((c) => c.status === 'ok'))).toBe(true);
    expect(fixture.sample).toBe(false);
    expect(live.exportModel.sample).toBe(false);
    for (const d of live.documents.values()) expect(d.coverage.state).toBe('unverified');
    for (const b of w.bodies) expect(Object.keys(b).sort()).toEqual(['blocks', 'run', 'schemaId']);
    for (const b of w.bodies) expect(Object.keys((b as unknown as { run: object }).run).sort()).toEqual(['chunk', 'id', 'token']);
  });

  it('a failed chunk in the application form leaves it incomplete, and even with coverage asserted nothing is confirmed missing from it', async () => {
    const w = fakeWorker((n) => (n === 2 ? { status: 502, code: 'schema_invalid' } : null));
    const { fixture, results } = await analyse(w, { maxChars: 400, maxBlocks: 400 });
    const incomplete = Object.values(results).filter((r) => r.chunks.some((c) => c.status !== 'ok')).map((r) => r.docId);
    expect(incomplete.length).toBeGreaterThan(0);
    const v = run(fixture, confirmDocumentCoverage(emptySession(), incomplete[0]!, 2));
    expect(v.exportModel.coverage.find((c) => c.docId === incomplete[0])).toMatchObject({ state: 'processing_incomplete', confirmedByUser: false });
    expect(v.items.filter((i) => i.finding.code.endsWith('.absent') && i.finding.state === 'confirmed')).toEqual([]);
  });

  it('a stopping error on the first request processes nothing and invents nothing', async () => {
    const w = fakeWorker(() => ({ status: 429, code: 'daily_limit' }));
    const { fixture } = await analyse(w);
    expect(w.requests).toBe(1);
    expect(run(fixture).items.filter((i) => i.finding.state === 'confirmed')).toEqual([]);
  });
});
