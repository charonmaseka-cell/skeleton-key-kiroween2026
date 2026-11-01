import type { Block } from './types';

/**
 * The source cell [start, end) of a block that contains [start, end) of its text, when the PDF parser found validated
 * cells (Block.layout === 'positioned'). null otherwise: callers fall back to separators written in the text.
 */
export function cellAround(block: Block, start: number, end: number): { start: number; end: number } | null {
  if (block.layout !== 'positioned' || !block.cells) return null;
  const c = block.cells.find((x) => start >= x.start && end <= x.end && x.end <= block.text.length);
  return c ? { start: c.start, end: c.end } : null;
}
