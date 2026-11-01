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

/** The shape of one block in an extraction request: id and text, plus the line's cells when the parser validated them. */
export type RequestBlock = { id: string; text: string; cells?: string[] };

/**
 * What is sent to the Worker for a block. A line the parser found genuinely positioned in two or more cells also carries the
 * text of each cell, in order, each an exact substring of `text`. Nothing else is ever added, and `text` is never changed, so
 * evidence offsets keep pointing at the original characters. Uncertain or single-item lines, and wrapped continuations, carry no
 * cells: for them the request is exactly what it was before.
 */
export function toRequestBlock(b: Block): RequestBlock {
  if (b.layout === 'positioned' && b.cells && b.cells.length >= 2) {
    const cells = b.cells.map((c) => b.text.slice(c.start, c.end));
    if (cells.every((c) => c.trim().length > 0) && cellsInOrder(b.text, cells)) return { id: b.id, text: b.text, cells };
  }
  return { id: b.id, text: b.text };
}

/** True when each cell occurs in `text`, in order, without overlapping the one before. */
export function cellsInOrder(text: string, cells: string[]): boolean {
  let from = 0;
  for (const c of cells) {
    const at = text.indexOf(c, from);
    if (at < 0) return false;
    from = at + c.length;
  }
  return true;
}
