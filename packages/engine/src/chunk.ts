import type { Block } from './types';

export type ChunkLimits = { maxChars: number; maxBlocks: number };

/**
 * Split blocks, in order, into chunks that respect the request limits.
 * A single block longer than maxChars cannot be sent and is returned in `oversized`
 * so the caller can surface it as an extraction issue instead of dropping it silently.
 */
export function chunkBlocks(blocks: Block[], limits: ChunkLimits): { chunks: Block[][]; oversized: Block[] } {
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
      cur = [];
      chars = 0;
    }
    cur.push(b);
    chars += b.text.length;
  }
  if (cur.length > 0) chunks.push(cur);
  return { chunks, oversized };
}
