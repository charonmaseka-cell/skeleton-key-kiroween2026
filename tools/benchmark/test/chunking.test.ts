import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILES } from '../../../services/extraction-api/src/profiles';
import { SCHEMA_FIELDS } from '../../../packages/ui/src/schema-fields';
import { DEFAULT_MAX_VALUES, buildFrozenPlan, documentHash, frozenChunker, outputChunker, type FrozenPlan } from '../src/chunking';
import { loadBlocks, loadSample } from '../src/samples';

const SAMPLE = 'scopecheck-realistic';
const PLAN_FILE = join(__dirname, '../../../samples/scopecheck-realistic/chunk-plan.json');
const PARAMS = { maxChars: 24_000, maxBlocks: 400, maxValues: DEFAULT_MAX_VALUES, overlap: 0, headingContext: true };
const committed = () => JSON.parse(readFileSync(PLAN_FILE, 'utf8')) as FrozenPlan;

describe('the frozen chunk plan (SC-T2b)', () => {
  it('regenerating the plan from the documents reproduces the committed file exactly', async () => {
    const fresh = await buildFrozenPlan(SAMPLE, PARAMS);
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(committed());
  });

  it('accounts for every block of every document, and the full-length documents are multi-chunk', async () => {
    const plan = committed();
    const sample = loadSample(SAMPLE);
    for (const d of plan.docs) {
      const doc = sample.docs.find((x) => x.id === d.docId)!;
      const blocks = await loadBlocks(SAMPLE, doc);
      expect(d.documentHash).toBe(documentHash(blocks));
      const covered = new Set([...d.chunks.flatMap((c) => c.blockIds), ...d.oversizedBlockIds]);
      expect(blocks.filter((b) => !covered.has(b.id))).toEqual([]);
      expect(d.chunks.length).toBeGreaterThan(1);
      expect(d.oversizedBlockIds).toEqual([]);
    }
  });

  it('the frozen chunker reproduces the chunks the live chunker builds, and refuses a changed document', async () => {
    const plan = committed();
    const doc = loadSample(SAMPLE).docs.find((d) => d.id === 'rfq')!;
    const blocks = await loadBlocks(SAMPLE, doc);
    const frozen = frozenChunker(plan)('rfq', blocks, doc.schemaId);
    const live = outputChunker(PARAMS)('rfq', blocks, doc.schemaId);
    expect(frozen.chunks.map((c) => c.map((b) => b.id))).toEqual(live.chunks.map((c) => c.map((b) => b.id)));
    const edited = blocks.map((b, i) => (i === 3 ? { ...b, text: `${b.text} changed` } : b));
    expect(() => frozenChunker(plan)('rfq', edited, doc.schemaId)).toThrow(/hash differs/);
    expect(() => frozenChunker(plan)('rfq', blocks, 'scopecheck.quote.v1')).toThrow(/built for/);
  });

  it('no chunk is over the value budget by the chunker\'s own estimate, and every request is within the output cap by that estimate', () => {
    for (const d of committed().docs) for (const c of d.chunks) {
      expect(c.overBudget).toBe(false);
      expect(c.estimatedValues).toBeLessThanOrEqual(DEFAULT_MAX_VALUES);
      expect(c.estimatedValues * 42).toBeLessThanOrEqual(0.8 * PROFILES[d.schemaId]!.maxOutputTokens);
    }
  });
});

describe('the chunker does not depend on golden labels or expected findings', () => {
  it('the same chunks result when every label is removed or scrambled; only the labelled diagnostic moves', async () => {
    const reference = await buildFrozenPlan(SAMPLE, PARAMS);
    const scrambled = loadSample(SAMPLE);
    for (const d of scrambled.docs) d.facts = d.facts.map((f) => ({ ...f, line: 0, excerpt: 'scrambled' }));
    const s = await buildFrozenPlan(SAMPLE, PARAMS, {}, scrambled);
    expect(s.docs).toEqual(reference.docs);
    expect(s.diagnostic).not.toEqual(reference.diagnostic);
    const none = loadSample(SAMPLE);
    for (const d of none.docs) d.facts = [];
    expect((await buildFrozenPlan(SAMPLE, PARAMS, {}, none)).docs).toEqual(reference.docs);
  });

  it('the chunker modules never import the sample or label code', () => {
    for (const f of ['../../../packages/engine/src/chunk-output.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/import .*(samples|expected|label|facts)/i);
    }
  });
});

describe('browser schema fields stay in step with the server profiles', () => {
  it('the value kinds the client sizes requests by equal the kinds in each server profile', () => {
    for (const id of Object.keys(SCHEMA_FIELDS)) {
      expect(PROFILES[id], `${id} exists on the server`).toBeDefined();
      expect(SCHEMA_FIELDS[id]!.map((f) => f.kind)).toEqual(PROFILES[id]!.fields.map((f) => f.kind));
    }
    for (const id of ['scopecheck.rfq.v1', 'scopecheck.quote.v1', 'scopecheck.quote.v2', 'packcheck.grant.v2']) expect(SCHEMA_FIELDS[id], `${id} is covered`).toBeDefined();
  });
});
