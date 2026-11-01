import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isEvidenceIntact, validateClaims, type Block } from '@skeleton-key/engine';
import { parsePdf } from '@skeleton-key/ingest';
import { SqliteAdmission } from '../src/admission';
import { oracleAi } from '../src/ai';
import { DEFAULT_MAX_VALUES, buildFrozenPlan, documentHash, frozenChunker, outputChunker, type FrozenPlan } from '../src/chunking';
import { SAMPLE_ID, buildFresh, renderPdf } from '../src/fresh-scopecheck';
import { runBenchmark } from '../src/run';
import { HINTS, loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';

// Offline checks of the fresh-validation documents: the layout is what it claims to be, the pre-registered labels point at the
// real text, evidence offsets hold, and the pre-registered findings follow from the rules on ideal extraction. No model is called.

const DIR = join(__dirname, '../../../samples', SAMPLE_ID);
const params = { maxChars: 24_000, maxBlocks: 400, maxValues: DEFAULT_MAX_VALUES, overlap: 0, headingContext: true };
const parse = (id: string) => parsePdf(new Uint8Array(readFileSync(join(DIR, `${id}.pdf`))), id);

describe('the committed files are what the generator writes', () => {
  it('sample.json and every PDF are reproduced exactly (deterministic)', async () => {
    const { sample, rows } = buildFresh();
    expect(JSON.parse(readFileSync(join(DIR, 'sample.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(sample)));
    for (const d of sample.docs) expect(Buffer.from(await renderPdf(d.id, rows[d.id]!)).equals(readFileSync(join(DIR, d.file)))).toBe(true);
  });
});

describe('parser: layout and cells on the real PDFs', () => {
  it('the parsed lines are exactly the labelled lines, in order, with ids p{page}-l{line}', async () => {
    for (const d of loadSample(SAMPLE_ID).docs) {
      const blocks = await parse(d.id);
      expect(blocks.map((b) => b.text)).toEqual(d.lines);
      expect(blocks.every((b) => /^p\d+-l\d+$/.test(b.id))).toBe(true);
    }
  });

  it('the tender and quotation A are genuinely positioned: every table row has validated cells that are the table cells', async () => {
    const rfq = await parse('rfq');
    const row = rfq.find((b) => b.text.startsWith('LB-3101'))!;
    expect(row.layout).toBe('positioned');
    expect(row.parser).toBe('ingest/2-cells');
    expect(row.cells!.map((c) => row.text.slice(c.start, c.end))).toEqual(['LB-3101', 'Digital pH meter', '6 each', '0.01 pH resolution']);
    const a = (await parse('quote-a')).find((b) => b.text.startsWith('LB-3101'))!;
    expect(a.cells!.map((c) => a.text.slice(c.start, c.end))).toEqual(['LB-3101', 'Digital pH meter', '6 each', 'R 3 450', 'c/w 0.01 pH resolution']);
    expect(rfq.filter((b) => b.layout === 'positioned').length).toBeGreaterThanOrEqual(14);
  });

  it('a wrapped description is a one-cell line linked to the description cell of the row above', async () => {
    for (const id of ['rfq', 'quote-a']) {
      const blocks = await parse(id);
      const i = blocks.findIndex((b) => b.text === 'draught shield');
      expect(blocks[i]!.layout).toBe('positioned');
      expect(blocks[i]!.cells).toHaveLength(1);
      expect(blocks[i]!.cells![0]!.wrapOf).toEqual({ blockId: blocks[i - 1]!.id, cell: 1 });
    }
  });

  it('the prose quotation has no positioned lines, and no line anywhere gets cells it does not have', async () => {
    const b = await parse('quote-b');
    expect(b.some((x) => x.layout === 'positioned' || x.cells)).toBe(false);
    for (const id of ['rfq', 'quote-a', 'quote-b']) {
      for (const x of await parse(id)) {
        for (const c of x.cells ?? []) {
          expect(x.text.slice(c.start, c.end).length).toBe(c.end - c.start);
          expect(x.text.slice(c.start, c.end).trim()).not.toBe('');
        }
      }
    }
  });

  it('cells never change the text: the same text as the plain line grouping gives', async () => {
    const { rows } = buildFresh();
    for (const [id, r] of Object.entries(rows)) expect((await parse(id)).map((b) => b.text)).toEqual(r.map((x) => x.cells.map((c) => c.text).join(' ')));
  });
});

describe('evidence: every pre-registered label points at real text', () => {
  it('each labelled excerpt is in its line, validates as a claim, and its evidence span is intact', async () => {
    const sample = loadSample(SAMPLE_ID);
    for (const d of sample.docs) {
      const blocks = await parse(d.id);
      const byId = new Map(blocks.map((b) => [b.id, b]));
      const claims = d.facts.map((f) => ({ field: f.field, kind: f.kind, blockId: blocks[f.line]!.id, excerpt: f.excerpt, value: f.value }));
      const facts = validateClaims(claims, { docId: d.id, blocks, hintsByField: HINTS });
      expect(facts).toHaveLength(d.facts.length);
      for (const f of facts) {
        expect(f.status, `${d.id} ${f.field} ${JSON.stringify(f.value)} ${f.reason ?? ''}`).toBe('validated');
        expect(f.evidence.every((e) => isEvidenceIntact(e, byId))).toBe(true);
      }
    }
  });
});

describe('the pre-registered findings follow from the rules on ideal extraction (a consistency check, not a model result)', () => {
  async function ideal(dropItemCodes: boolean) {
    const counter = new SqliteAdmission(':memory:');
    const transport = new LocalTransport({ ai: oracleAi([loadSample(SAMPLE_ID)], { dropItemCodes }), counter, env: { DAILY_ADMISSION_CEILING: '1000', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '5000' } });
    const r = await runBenchmark({ mode: 'mock', model: 'mock', label: 't', transport, sampleIds: [SAMPLE_ID], limits: params, chunker: outputChunker(params), attemptBudget: 1000 });
    counter.close();
    return r.samples[0]!;
  }

  it('with item codes returned: all 12 expected exactly, no false critical, all 48 comparisons planned', async () => {
    const s = await ideal(false);
    expect(s.findings.score).toMatchObject({ expected: 12, matchedExactState: 12, missed: [], falseCritical: [], overConfident: [], unexpectedOther: [] });
    expect(s.comparisonCompleteness).toEqual({ labelledRequirementRows: 12, quotations: 2, aspects: 2, expected: 48, planned: 48, complete: true });
  });

  it('with every item code DROPPED from the values, the same 12: codes come back from the reference cell, except the row naming a standard', async () => {
    const s = await ideal(true);
    expect(s.findings.score).toMatchObject({ expected: 12, matchedExactState: 12, missed: [], falseCritical: [] });
    expect(s.identity!.recovered.filter((x) => x.method === 'row_reference_cell').length).toBeGreaterThanOrEqual(20);
    expect(s.identity!.uncertain.map((u) => `${u.docId}:${u.reason}`)).toEqual(['quote-a:multiple_codes']);
  });

  it('the connector row (quotation A LB-3101, "c/w ...") is not a difference, and the contaminated-specification check stays quiet', async () => {
    const s = await ideal(false);
    expect(s.findings.produced.some((f) => f.subject.startsWith('LB-3101:specification'))).toBe(false);
    expect(s.findings.produced.some((f) => f.code === 'specification.contaminated')).toBe(false);
  });
});

describe('chunking: from text, structure and schema only', () => {
  const plan = () => JSON.parse(readFileSync(join(DIR, 'chunk-plan.json'), 'utf8')) as FrozenPlan;

  it('the frozen plan regenerates identically', async () => {
    expect(JSON.parse(JSON.stringify(await buildFrozenPlan(SAMPLE_ID, params)))).toEqual(plan());
  });

  it('it is not changed by removing or scrambling the labels', async () => {
    const ref = await buildFrozenPlan(SAMPLE_ID, params);
    const scrambled = loadSample(SAMPLE_ID);
    for (const d of scrambled.docs) d.facts = d.facts.map((f) => ({ ...f, line: 0, excerpt: 'x' }));
    expect((await buildFrozenPlan(SAMPLE_ID, params, {}, scrambled)).docs).toEqual(ref.docs);
    const none = loadSample(SAMPLE_ID);
    for (const d of none.docs) d.facts = [];
    none.expectedFindings = [];
    expect((await buildFrozenPlan(SAMPLE_ID, params, {}, none)).docs).toEqual(ref.docs);
  });

  it('every block is accounted for, wrapped lines stay with their row, and the plan matches the documents', async () => {
    for (const d of plan().docs) {
      const blocks: Block[] = await parse(d.docId);
      expect(d.documentHash).toBe(documentHash(blocks));
      const own = d.chunks.flatMap((c) => c.blockIds);
      expect(own.sort()).toEqual(blocks.map((b) => b.id).sort());
      expect(d.oversizedBlockIds).toEqual([]);
      const ch = frozenChunker(plan())(d.docId, blocks, d.schemaId);
      for (const c of ch.chunks) {
        const ids = c.map((b) => b.id);
        for (const b of c) {
          const w = b.cells?.[0]?.wrapOf;
          if (b.layout === 'positioned' && b.cells!.length === 1 && w) expect(ids, `${d.docId} ${b.id} stays with ${w.blockId}`).toContain(w.blockId);
        }
      }
      expect(d.chunks.every((c) => !c.overBudget && c.estimatedValues <= DEFAULT_MAX_VALUES)).toBe(true);
    }
  });
});
