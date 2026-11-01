import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellsInOrder as engineCellsInOrder, isEvidenceIntact, toRequestBlock, validateClaims, type Block } from '@skeleton-key/engine';
import { CELLS_RULE, buildMessages, getProfile, responseFormat } from '../../../services/extraction-api/src/profiles';
import { cellsInOrder as workerCellsInOrder, parseExtractRequest } from '../../../services/extraction-api/src/request';
import { parseConfig } from '../../../services/extraction-api/src/config';
import { SqliteAdmission } from '../src/admission';
import { oracleAi } from '../src/ai';
import { frozenChunker, type FrozenPlan } from '../src/chunking';
import { runBenchmark } from '../src/run';
import { HINTS, loadBlocks, loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';

// Cell boundaries reach the model-facing request (they did not before: every request sent only {id, text}, and in the SC-T12
// positioned tables the model returned whole rows as item values). Offline only.

const REPO = join(__dirname, '../../..');
const accepted = JSON.parse(readFileSync(join(__dirname, 'fixtures/accepted-request-hashes.json'), 'utf8')) as Record<string, string>;

async function requests(sid: string, id: string) {
  const plan = JSON.parse(readFileSync(join(REPO, `samples/${sid}/chunk-plan.json`), 'utf8')) as FrozenPlan;
  const doc = loadSample(sid).docs.find((d) => d.id === id)!;
  const blocks = await loadBlocks(sid, doc);
  const p = getProfile(doc.schemaId)!;
  return frozenChunker(plan)(id, blocks, doc.schemaId).chunks.map((c) => {
    const sent = c.map(toRequestBlock);
    const body = JSON.stringify({ messages: buildMessages(p, sent, false), response_format: responseFormat(p), max_tokens: p.maxOutputTokens });
    return { sent, chunk: c, sha: createHash('sha256').update(body).digest('hex') };
  });
}

describe('requests without cells are byte-identical to the accepted implementation', () => {
  it('every chunk with no positioned line (the earlier realistic set, the prose quotation) has the accepted request hash', async () => {
    let same = 0;
    let changed = 0;
    for (const [key, sha] of Object.entries(accepted)) {
      const [sid, rest] = key.split('/') as [string, string];
      const [id, n] = rest.split('#') as [string, string];
      const r = (await requests(sid, id))[Number(n) - 1]!;
      if (r.sent.some((b) => b.cells)) {
        expect(r.sha, key).not.toBe(sha); // cells were added: the request changes, as intended
        changed++;
      } else {
        expect(r.sha, key).toBe(sha);
        same++;
      }
    }
    expect(same).toBe(17); // 13 chunks of the earlier realistic set (rfq 6, quote-b 7) + 4 chunks of the prose quotation
    expect(changed).toBe(8); // the 8 chunks of the two positioned tables (tender 4, quotation A 4)
  });
});

describe('what a positioned line sends', () => {
  it('the fresh tender row carries its four cells, each an exact substring of the unchanged text', async () => {
    const r = await requests('scopecheck-fresh', 'rfq');
    const row = r.flatMap((x) => x.sent).find((b) => b.text.startsWith('LB-3101'))!;
    expect(row).toEqual({ id: row.id, text: 'LB-3101 Digital pH meter 6 each 0.01 pH resolution', cells: ['LB-3101', 'Digital pH meter', '6 each', '0.01 pH resolution'] });
  });

  it('wrapped continuations, single-item lines and uncertain lines carry no cells', async () => {
    const all = (await requests('scopecheck-fresh', 'rfq')).flatMap((x) => x.chunk);
    for (const b of all) {
      const s = toRequestBlock(b);
      const multi = b.layout === 'positioned' && (b.cells?.length ?? 0) >= 2;
      expect('cells' in s, b.id).toBe(multi);
      expect(Object.keys(s).sort()).toEqual(multi ? ['cells', 'id', 'text'] : ['id', 'text']);
    }
    expect(all.some((b) => b.text === 'draught shield' && !toRequestBlock(b).cells)).toBe(true);
  });

  it('the prompt rule about cells is added only when a block carries cells', () => {
    const p = getProfile('scopecheck.rfq.v1')!;
    expect(buildMessages(p, [{ id: 'a', text: 'x y' }], false)[0]!.content).not.toContain(CELLS_RULE);
    expect(buildMessages(p, [{ id: 'a', text: 'x y', cells: ['x', 'y'] }], false)[0]!.content).toContain(CELLS_RULE);
  });
});

describe('the Worker accepts only cells that are in the text, in order', () => {
  const cfg = parseConfig({ DAILY_ADMISSION_CEILING: '0', ALLOWED_ORIGINS: 'https://x.example' })!;
  const req = (blocks: unknown) => parseExtractRequest(JSON.stringify({ schemaId: 'scopecheck.rfq.v1', blocks }), cfg);

  it.each([
    [[{ id: 'a', text: 'LB-1 Pump 6 each', cells: ['LB-1', 'Pump', '6 each'] }], true],
    [[{ id: 'a', text: 'LB-1 Pump 6 each' }], true],
    [[{ id: 'a', text: 'LB-1 Pump 6 each', cells: ['Pump', 'LB-1'] }], false], // out of order
    [[{ id: 'a', text: 'LB-1 Pump 6 each', cells: ['LB-1', 'Valve'] }], false], // not in the text
    [[{ id: 'a', text: 'LB-1 Pump', cells: ['LB-1'] }], false], // a single cell is not a table row
    [[{ id: 'a', text: 'LB-1 Pump', cells: ['LB-1', ''] }], false], // empty cell
    [[{ id: 'a', text: 'LB-1 Pump', cells: ['LB-1', 'Pump'], x0: [1, 2] }], false], // no other keys
  ])('%j -> %s', (blocks, ok) => {
    expect(req(blocks).ok).toBe(ok);
  });

  it('cells count toward the input bound (they repeat the text)', () => {
    const small = parseConfig({ DAILY_ADMISSION_CEILING: '0', ALLOWED_ORIGINS: 'https://x.example', MAX_CHARS: '20' })!;
    expect(parseExtractRequest(JSON.stringify({ schemaId: 'scopecheck.rfq.v1', blocks: [{ id: 'a', text: 'LB-1 Pump 6 each' }] }), small).ok).toBe(true);
    expect(parseExtractRequest(JSON.stringify({ schemaId: 'scopecheck.rfq.v1', blocks: [{ id: 'a', text: 'LB-1 Pump 6 each', cells: ['LB-1', 'Pump', '6 each'] }] }), small)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('the Worker check and the engine check agree', () => {
    const cases: [string, string[]][] = [['a b c', ['a', 'b', 'c']], ['a b c', ['b', 'a']], ['aa', ['a', 'a']], ['aa', ['aa', 'a']], ['x', ['y']], ['ab ab', ['ab', 'ab']]];
    for (const [t, c] of cases) expect(workerCellsInOrder(t, c), `${t} ${c}`).toBe(engineCellsInOrder(t, c));
  });
});

describe('evidence is unchanged', () => {
  it('a claim whose excerpt is one cell validates with offsets into the original text, exactly as before', async () => {
    const blocks = await loadBlocks('scopecheck-fresh', loadSample('scopecheck-fresh').docs.find((d) => d.id === 'rfq')!);
    const b = blocks.find((x) => x.text.startsWith('LB-3101'))! as Block;
    const [f] = validateClaims([{ field: 'specification', kind: 'text', blockId: b.id, excerpt: '0.01 pH resolution', value: '0.01 pH resolution' }], { docId: 'rfq', blocks, hintsByField: HINTS });
    expect(f!.status).toBe('validated');
    expect(f!.evidence[0]).toMatchObject({ blockId: b.id, start: 32, end: 50, text: '0.01 pH resolution' });
    expect(b.text.slice(32, 50)).toBe('0.01 pH resolution');
    expect(isEvidenceIntact(f!.evidence[0]!, new Map([[b.id, b]]))).toBe(true);
  });

  it('end to end with the mock model, cells in the requests change nothing about the pre-registered findings (12 of 12)', async () => {
    const counter = new SqliteAdmission(':memory:');
    const transport = new LocalTransport({ ai: oracleAi([loadSample('scopecheck-fresh')]), counter, env: { DAILY_ADMISSION_CEILING: '100', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '5000' } });
    const plan = JSON.parse(readFileSync(join(REPO, 'samples/scopecheck-fresh/chunk-plan.json'), 'utf8')) as FrozenPlan;
    const r = await runBenchmark({ mode: 'mock', model: 'm', label: 't', transport, sampleIds: ['scopecheck-fresh'], limits: { maxChars: 24_000, maxBlocks: 400 }, chunker: frozenChunker(plan), attemptBudget: 100 });
    counter.close();
    expect(r.requests.every((q) => q.ok)).toBe(true);
    expect(r.samples[0]!.findings.score).toMatchObject({ expected: 12, matchedExactState: 12, falseCritical: [], missed: [] });
  });
});
