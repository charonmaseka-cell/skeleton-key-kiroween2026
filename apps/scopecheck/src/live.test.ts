import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePdf } from '@skeleton-key/ingest';
import { buildLiveFixture, confirmDocumentCoverage, emptySession, evaluateSession, exportText, analyseAll, newClientSession, type ClientConfig, type DocumentResult, type Fixture } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';
import { SCOPECHECK_SLOTS } from './App';
import { FIXTURES } from './fixtures';

// The live path without a model: the REAL sample PDFs are parsed by the real ingestion code, sent in chunks through
// the real browser client to a FAKE Worker that answers with the recorded claims for the text it receives, and the
// result goes through the same validation, rules, review and export as the sample sets.

const standard = FIXTURES.find((f) => f.id === 'scopecheck-standard')!;
const PDFS: Record<string, string> = { rfq: 'rfq.pdf', 'quote-1': 'quote-a.pdf', 'quote-2': 'quote-b.pdf' };

async function parsed() {
  const out: Record<string, Awaited<ReturnType<typeof parsePdf>>> = {};
  for (const [id, file] of Object.entries(PDFS)) out[id] = await parsePdf(new Uint8Array(readFileSync(new URL(`../../../samples/scopecheck/${file}`, import.meta.url))), id);
  return out;
}

/** A fake Worker: recorded claims for any chunk whose text it recognises, optionally failing chosen requests. */
function fakeWorker(fail: (n: number, texts: string[]) => { status: number; code: string } | null = () => null) {
  let n = 0;
  const bodies: { schemaId: string; blocks: { id: string; text: string }[] }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as (typeof bodies)[number];
    bodies.push(body);
    n++;
    const f = fail(n, body.blocks.map((b) => b.text));
    if (f) return new Response(JSON.stringify({ error: { code: f.code } }), { status: f.status });
    const texts = new Map(body.blocks.map((b) => [b.id, b.text]));
    const src = standard.docs.find((d) => body.blocks.every((b) => d.blocks.some((x) => x.id === b.id && x.text === b.text)));
    const claims = (src?.claims as { blockId: string }[] | undefined)?.filter((c) => texts.has(c.blockId) && src!.blocks.find((x) => x.id === c.blockId)!.text === texts.get(c.blockId)) ?? [];
    return new Response(JSON.stringify({ claims, meta: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies, get requests() { return n; } };
}

async function analyse(w: ReturnType<typeof fakeWorker>, limits = { maxChars: 180, maxBlocks: 400 }): Promise<{ fixture: Fixture; results: Record<string, DocumentResult> }> {
  const cfg: ClientConfig = { baseUrl: 'https://worker.example', fetchImpl: w.fetchImpl, limits };
  const session = newClientSession();
  const blocks = await parsed();
  const used = SCOPECHECK_SLOTS.filter((s) => blocks[s.id]);
  const all = await analyseAll(cfg, session, used.map((slot) => ({ docId: slot.id, schemaId: slot.schemaId, blocks: blocks[slot.id]! })));
  const results: Record<string, DocumentResult> = Object.fromEntries(all.results.map((r) => [r.docId, r]));
  const fixture = buildLiveFixture(SCOPECHECK_SLOTS.filter((s) => results[s.id]).map((s) => ({ id: s.id, role: s.role, title: PDFS[s.id]!, profile: s.schemaId, result: results[s.id]! })), 'live-upload-1');
  return { fixture, results };
}
const run = (f: Fixture, s = emptySession(), at = 1) => evaluateSession(scopeCheckAdapter, f, s, at);
const states = (v: ReturnType<typeof run>) => new Map(v.items.map((i) => [`${i.finding.code}|${i.finding.subjectId}|${i.finding.responseDocId}`, i.finding.state]));

describe('uploaded PDFs, in chunks, through a fake Worker, to findings', () => {
  it('the documents are split into several requests, only block ids and text are sent, and nothing is processed before Analyse', async () => {
    const w = fakeWorker();
    expect(w.requests).toBe(0); // parsing alone sends nothing
    await parsed();
    expect(w.requests).toBe(0);
    const { results } = await analyse(w);
    expect(w.requests).toBeGreaterThan(3);
    expect(Object.values(results).every((r) => r.chunks.length > 1 && r.chunks.every((c) => c.status === 'ok'))).toBe(true);
    for (const b of w.bodies) expect(Object.keys(b).sort()).toEqual(['blocks', 'schemaId']);
    expect(JSON.stringify(w.bodies)).not.toMatch(/\.pdf/); // no file names leave the device
  });

  it('reproduces the expected findings: both differences confirmed, the exclusion, and the PG-6 omission as Needs review', async () => {
    const { fixture } = await analyse(fakeWorker());
    const v = run(fixture);
    const s = states(v);
    expect(s.get('quantity.differs|CP-100:quantity|quote-1')).toBe('confirmed');
    expect(s.get('spec.differs|CP-100:specification|quote-2')).toBe('confirmed');
    expect([...s.keys()].filter((k) => k.startsWith('exclusion.stated|quote-1:') && k.endsWith(':exclusion|quote-1'))).toHaveLength(1);
    expect(s.get('item.absent|PG-6|quote-2')).toBe('needs_review');
    expect([...s.values()].filter((x) => x === 'confirmed')).toHaveLength(3);
    for (const d of v.documents.values()) expect(d.coverage.state).toBe('unverified');
  });

  it('is labelled live, not sample, in the model and in the export', async () => {
    const { fixture } = await analyse(fakeWorker());
    expect(fixture.sample).toBe(false);
    const v = run(fixture);
    expect(v.exportModel.sample).toBe(false);
    expect(exportText(v)).not.toMatch(/SAMPLE/);
  });
});

describe('a chunk that fails cannot produce a confirmed omission', () => {
  it('quote 2 loses the part with its last line: the document is incomplete and, even with coverage asserted, nothing is confirmed absent', async () => {
    // fail the request that carries quote-b's PG-6 neighbourhood (the last chunk of the last document)
    let last = 0;
    const w = fakeWorker((n, texts) => { last = n; return texts.some((t) => /QB-04|MS-20/.test(t)) && n >= 7 ? { status: 502, code: 'schema_invalid' } : null; });
    const { fixture, results } = await analyse(w);
    expect(last).toBeGreaterThan(0);
    const failedDocs = Object.values(results).filter((r) => r.chunks.some((c) => c.status !== 'ok'));
    expect(failedDocs.length).toBeGreaterThan(0);
    const v = run(fixture, confirmDocumentCoverage(emptySession(), 'quote-2', 2), 2);
    expect(v.exportModel.coverage.find((c) => c.docId === 'quote-2')).toMatchObject({ state: 'processing_incomplete', confirmedByUser: false });
    expect(v.items.filter((i) => i.finding.code === 'item.absent' && i.finding.responseDocId === 'quote-2').every((i) => i.finding.state === 'needs_review')).toBe(true);
  });

  it('a stopping error (daily allowance) on the first request: nothing is processed, nothing is invented, and the app still evaluates', async () => {
    const w = fakeWorker(() => ({ status: 429, code: 'daily_limit' }));
    const { fixture, results } = await analyse(w);
    expect(w.requests).toBe(1); // the run stopped at once: later documents were not sent either
    expect(results.rfq!.stoppedBy).toBe('daily_limit');
    expect(Object.values(results).flatMap((r) => r.chunks).filter((c) => c.status === 'ok')).toEqual([]);
    expect(results['quote-2']!.chunks.every((c) => c.status === 'not_sent')).toBe(true);
    const v = run(fixture);
    expect(v.items.filter((i) => i.finding.state === 'confirmed')).toEqual([]);
    expect(v.exportModel.coverage.every((c) => c.state === 'processing_incomplete')).toBe(true);
  });
});
