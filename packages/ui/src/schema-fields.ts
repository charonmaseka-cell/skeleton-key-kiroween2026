import { chunkBlocks, chunkByOutput, schemaEstimator, type Block, type ChunkLimits, type SchemaField } from '@skeleton-key/engine';

// What each extraction schema asks the model to return, as value KINDS only. The browser needs this to size
// requests by expected output. The server profiles (services/extraction-api/src/profiles.ts) remain the source of
// truth for prompts and limits; a test fails if these kinds drift from them.
export const SCHEMA_FIELDS: Record<string, SchemaField[]> = {
  'scopecheck.rfq.v1': [{ kind: 'text' }, { kind: 'quantity' }, { kind: 'text' }],
  'scopecheck.quote.v1': [{ kind: 'text' }, { kind: 'quantity' }, { kind: 'money' }, { kind: 'text' }, { kind: 'text' }],
  'packcheck.grant.v1': [{ kind: 'name' }, { kind: 'money' }, { kind: 'money' }, { kind: 'date' }, { kind: 'date' }, { kind: 'text' }],
  'packcheck.grant.v2': [{ kind: 'name' }, { kind: 'money' }, { kind: 'money' }, { kind: 'date' }, { kind: 'date' }, { kind: 'text' }],
};

/**
 * Values one request is expected to return. An ESTIMATE from small benchmark samples (about 42 output tokens per value,
 * 29 to 36 tokens per second, a 25 s Worker timeout and a 1,500-token output cap): see tools/benchmark/src/chunking.ts.
 * It is not a proven limit. Task 5.5 (production limits) stays open.
 */
export const MAX_VALUES_PER_REQUEST = 14;
export const REQUEST_LIMITS = { maxChars: 24_000, maxBlocks: 400 };

/** Output-aware chunking for a schema; if limits are given explicitly they are used with the size-only chunker. */
export function chunkForSchema(schemaId: string, blocks: Block[], limits?: ChunkLimits): { chunks: Block[][]; oversized: Block[] } {
  if (limits) return chunkBlocks(blocks, limits);
  const fields = SCHEMA_FIELDS[schemaId];
  if (!fields) return chunkBlocks(blocks, { ...REQUEST_LIMITS });
  const r = chunkByOutput(blocks, { ...REQUEST_LIMITS, maxValues: MAX_VALUES_PER_REQUEST, estimate: schemaEstimator(fields) });
  if (r.unaccounted.length) throw new Error(`chunk plan left blocks unaccounted for: ${r.unaccounted.join(',')}`);
  return { chunks: r.chunks, oversized: r.oversized };
}
