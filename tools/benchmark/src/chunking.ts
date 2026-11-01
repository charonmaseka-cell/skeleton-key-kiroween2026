import { chunkBlocks, chunkByOutput, hashOf, schemaEstimator, type Block, type OutputChunkInfo } from '@skeleton-key/engine';
import { PROFILES } from '../../../services/extraction-api/src/profiles';
import { loadBlocks, loadSample, type Sample } from './samples';

// Chunking strategies for benchmark runs, and the FROZEN plan.
//
// The output-aware chunker (engine/chunk-output.ts) reads only block text, document structure and the extraction
// schema's value kinds. It never reads the golden labels. The plan file records its decisions so a live run can use
// exactly the chunks that were reviewed and committed before any call was made. The label-derived counts in the file
// are an OFFLINE BENCHMARK DIAGNOSTIC: they let a reader compare the estimate with the pre-registered labels, and no
// code path reads them to decide anything.

export type ChunkParams = { maxChars: number; maxBlocks: number; maxValues: number; overlap: number; headingContext: boolean };

// maxValues: values one request is expected to return. Derivation (estimates from small samples, not proof):
//   output cap 1,500 tokens x 80% fit / 42 tokens per value = 28 values by tokens;
//   25 s timeout x 90% = 22.5 s, less 1.5 s fixed, x 29 tokens/s (slowest measured) / 42 = about 14 values by time.
// The smaller figure rules. The slowest measured request (18.1 s) carried 13 values.
export const DEFAULT_MAX_VALUES = 14;

export type FrozenChunk = { blockIds: string[]; contextBlockIds: string[]; estimatedValues: number; chars: number; overBudget: boolean; splitUnit: boolean };
export type FrozenDoc = { docId: string; schemaId: string; blocks: number; documentHash: string; chunks: FrozenChunk[]; oversizedBlockIds: string[] };
export type FrozenPlan = {
  version: 1;
  sample: string;
  chunker: 'output-aware';
  parameters: ChunkParams;
  note: string;
  docs: FrozenDoc[];
  diagnostic: { note: string; docs: { docId: string; labelledValues: number; chunks: { chunk: number; labelledValues: number }[] }[] };
};

export const documentHash = (blocks: Block[]) => hashOf(blocks.map((b) => [b.id, b.text]));

export type Chunking = { chunks: Block[][]; oversized: Block[]; info?: OutputChunkInfo[]; unaccounted?: string[] };
export type Chunker = (docId: string, blocks: Block[], schemaId: string) => Chunking;

/** The size-only chunker used before SC-T2b. */
export const sizeChunker = (limits: { maxChars: number; maxBlocks: number; overlap?: number }): Chunker => (_d, blocks) => chunkBlocks(blocks, limits);

export const outputChunker = (p: ChunkParams): Chunker => (_d, blocks, schemaId) => {
  const fields = PROFILES[schemaId]!.fields;
  return chunkByOutput(blocks, { maxChars: p.maxChars, maxBlocks: p.maxBlocks, maxValues: p.maxValues, overlap: p.overlap, headingContext: p.headingContext, estimate: schemaEstimator(fields) });
};

/** Build the plan from the documents' text and the schema. Labels are read only for the separate diagnostic. */
export async function buildFrozenPlan(sampleId: string, params: ChunkParams, schemaOverrides: Record<string, string> = {}, sample: Sample = loadSample(sampleId)): Promise<FrozenPlan> {
  const chunker = outputChunker(params);
  const docs: FrozenDoc[] = [];
  const diag: FrozenPlan['diagnostic']['docs'] = [];
  for (const doc of sample.docs) {
    const blocks = await loadBlocks(sampleId, doc);
    const schemaId = schemaOverrides[doc.id] ?? doc.schemaId;
    const r = chunker(doc.id, blocks, schemaId);
    if (r.unaccounted?.length) throw new Error(`${doc.id}: blocks not accounted for: ${r.unaccounted.join(',')}`);
    docs.push({
      docId: doc.id, schemaId, blocks: blocks.length, documentHash: documentHash(blocks),
      chunks: r.info!.map((i) => ({ blockIds: i.blockIds, contextBlockIds: i.contextBlockIds, estimatedValues: i.expectedValues, chars: i.chars, overBudget: i.overBudget, splitUnit: i.splitUnit })),
      oversizedBlockIds: r.oversized.map((b) => b.id),
    });
    // Offline diagnostic only: the chunker above never saw `doc.facts` or `doc.lines`.
    diag.push({
      docId: doc.id, labelledValues: doc.facts.length,
      chunks: r.chunks.map((c, k) => { const texts = new Set(c.map((b) => b.text)); return { chunk: k + 1, labelledValues: doc.facts.filter((f) => texts.has(doc.lines[f.line]!)).length }; }),
    });
  }
  return {
    version: 1, sample: sampleId, chunker: 'output-aware', parameters: params,
    note: 'Frozen output-aware chunk plan. Built from block text, structure and the extraction schema only. estimatedValues is the chunker estimate, not a label.',
    docs,
    diagnostic: { note: 'OFFLINE BENCHMARK DIAGNOSTIC: counts derived from the pre-registered labels. The chunker never read them and no run decision uses them.', docs: diag },
  };
}

/** A chunker that replays a frozen plan. It refuses a document whose text differs from the one the plan was built for. */
export function frozenChunker(plan: FrozenPlan): Chunker {
  return (docId, blocks, schemaId) => {
    const d = plan.docs.find((x) => x.docId === docId);
    if (!d) throw new Error(`frozen plan has no document ${docId}`);
    if (d.schemaId !== schemaId) throw new Error(`frozen plan for ${docId} was built for ${d.schemaId}, not ${schemaId}`);
    if (d.documentHash !== documentHash(blocks)) throw new Error(`frozen plan for ${docId} does not match the document text (hash differs); rebuild and re-review the plan`);
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const pick = (ids: string[]) => ids.map((id) => { const b = byId.get(id); if (!b) throw new Error(`frozen plan names unknown block ${id}`); return b; });
    const chunks = d.chunks.map((c) => [...pick(c.contextBlockIds), ...pick(c.blockIds)]);
    const oversized = pick(d.oversizedBlockIds);
    const seen = new Set([...d.chunks.flatMap((c) => c.blockIds), ...d.oversizedBlockIds]);
    const unaccounted = blocks.filter((b) => !seen.has(b.id)).map((b) => b.id);
    if (unaccounted.length) throw new Error(`frozen plan for ${docId} does not account for blocks: ${unaccounted.join(',')}`);
    return { chunks, oversized, info: d.chunks.map((c) => ({ ...c, expectedValues: c.estimatedValues })), unaccounted };
  };
}
