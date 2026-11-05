import { chunkBlocks, chunkByOutput, schemaEstimator, type Block, type ChunkLimits, type SchemaField } from '@skeleton-key/engine';

// What each extraction schema asks the model to return, as value KINDS only. The browser needs this to size
// requests by expected output. The server profiles (services/extraction-api/src/profiles.ts) remain the source of
// truth for prompts and limits; a test fails if these kinds drift from them.
export const SCHEMA_FIELDS: Record<string, SchemaField[]> = {
  'scopecheck.rfq.v1': [{ kind: 'text' }, { kind: 'quantity' }, { kind: 'text' }],
  'scopecheck.quote.v1': [{ kind: 'text' }, { kind: 'quantity' }, { kind: 'money' }, { kind: 'text' }, { kind: 'text' }],
  'scopecheck.quote.v2': [{ kind: 'text' }, { kind: 'quantity' }, { kind: 'money' }, { kind: 'money' }, { kind: 'text' }, { kind: 'text' }],
  'packcheck.grant.v1': [{ kind: 'name' }, { kind: 'money' }, { kind: 'money' }, { kind: 'date' }, { kind: 'date' }, { kind: 'text' }],
  'packcheck.grant.v2': [{ kind: 'name' }, { kind: 'money' }, { kind: 'money' }, { kind: 'date' }, { kind: 'date' }, { kind: 'text' }],
};

/**
 * Values one request is expected to return. An ESTIMATE from small benchmark samples (about 42 output tokens per value,
 * 29 to 36 tokens per second, a 25 s Worker timeout and a 1,500-token output cap): see tools/benchmark/src/chunking.ts.
 * It is not a proven limit. Task 5.5 (production limits) stays open.
 */
export const MAX_VALUES_PER_REQUEST = 14;
/**
 * Request limits the client chunks under. They sit inside the Worker's input limits (MAX_CHARS 6000, MAX_BLOCKS 80,
 * MAX_BODY_BYTES 8192, MAX_BLOCK_CHARS 1000) with room for the JSON around the text (about 40 bytes per block), so an ASCII request
 * the client builds stays under 8,192 bytes (4,500 + 80 x 40 = 7,700). Heavily multi-byte text can still exceed it; the Worker
 * then refuses that part and it is shown as not processed, never as covered. A block over MAX_BLOCK_CHARS is reported as
 * oversized (a failed part), never sent.
 */
export const REQUEST_LIMITS = { maxChars: 4_500, maxBlocks: 80 };
export const MAX_BLOCK_CHARS = 1_000;
export const MAX_BODY_BYTES = 8_192;

/** Values the model is expected to return for one chunk (the same estimate the chunker sizes requests by). Sent in the run plan, never the text. */
export function expectedValues(schemaId: string, chunk: Block[]): number {
  const fields = SCHEMA_FIELDS[schemaId];
  if (!fields) return Math.ceil(chunk.length / 2);
  const est = schemaEstimator(fields);
  return chunk.reduce((n, b) => n + est(b.text), 0);
}

/** Output-aware chunking for a schema; if limits are given explicitly they are used with the size-only chunker. */
export function chunkForSchema(schemaId: string, blocks: Block[], limits?: ChunkLimits): { chunks: Block[][]; oversized: Block[] } {
  if (limits) return chunkBlocks(blocks, limits);
  // A block longer than the Worker accepts is never sent: it is an oversized (failed) part of its own.
  const tooLong = blocks.filter((b) => b.text.length > MAX_BLOCK_CHARS);
  const sendable = blocks.filter((b) => b.text.length <= MAX_BLOCK_CHARS);
  const fields = SCHEMA_FIELDS[schemaId];
  if (!fields) {
    const r = chunkBlocks(sendable, { ...REQUEST_LIMITS });
    return { chunks: r.chunks, oversized: [...tooLong, ...r.oversized] };
  }
  const r = chunkByOutput(sendable, { ...REQUEST_LIMITS, maxValues: MAX_VALUES_PER_REQUEST, estimate: schemaEstimator(fields) });
  if (r.unaccounted.length) throw new Error(`chunk plan left blocks unaccounted for: ${r.unaccounted.join(',')}`);
  return { chunks: r.chunks, oversized: [...tooLong, ...r.oversized] };
}
