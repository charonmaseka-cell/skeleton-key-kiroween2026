import type { Block } from './types';

export type ChunkLimits = {
  maxChars: number;
  maxBlocks: number;
  /**
   * Blocks repeated at the start of the next chunk, so an item split across a chunk boundary is seen whole
   * by at least one request. Default 0. Overlap never lets a chunk exceed the limits, and never drops a block.
   */
  overlap?: number;
};

/**
 * Split blocks, in order, into chunks that respect the request limits.
 * A single block longer than maxChars cannot be sent and is returned in `oversized`
 * so the caller can surface it as an extraction issue instead of dropping it silently.
 */
export function chunkBlocks(blocks: Block[], limits: ChunkLimits): { chunks: Block[][]; oversized: Block[] } {
  const overlap = Math.max(0, Math.floor(limits.overlap ?? 0));
  const chunks: Block[][] = [];
  const oversized: Block[] = [];
  let cur: Block[] = [];
  let chars = 0;
  for (const b of blocks) {
    if (b.text.length > limits.maxChars) {
      oversized.push(b);
      continue;
    }
    if (cur.length > 0 && (cur.length >= limits.maxBlocks || chars + b.text.length > limits.maxChars)) {
      chunks.push(cur);
      // Seed the next chunk with the tail of this one, as much as still leaves room for the new block.
      let seed = overlap > 0 ? cur.slice(-overlap) : [];
      let seedChars = seed.reduce((n, x) => n + x.text.length, 0);
      while (seed.length > 0 && (seed.length + 1 > limits.maxBlocks || seedChars + b.text.length > limits.maxChars)) {
        seedChars -= seed[0]!.text.length;
        seed = seed.slice(1);
      }
      cur = seed;
      chars = seedChars;
    }
    cur.push(b);
    chars += b.text.length;
  }
  if (cur.length > 0) chunks.push(cur);
  return { chunks, oversized };
}
