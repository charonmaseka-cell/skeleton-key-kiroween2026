import type { Block } from './types';

// Output-aware chunking. A request is limited by what the model must RETURN (output tokens and time), not only by
// how much text it reads. This chunker sizes requests by the number of values the extraction schema asks for in the
// source text. It uses ONLY the block text, the document structure (rows, continuation lines, headings) and the
// schema's value kinds. It never reads golden labels or expected findings.
//
// Guarantees:
//  - every input block is accounted for: it is in a chunk (as its own content), or reported in `oversized`;
//  - source block ids are preserved unchanged, so evidence still points at the original blocks;
//  - a table-like row and its continuation lines are never separated;
//  - the nearest preceding heading is repeated at the start of a chunk as read-only context (listed separately from
//    the chunk's own blocks in `info`), as are `overlap` trailing blocks when requested;
//  - a unit that alone exceeds the value budget goes in its own chunk, flagged `overBudget`, never dropped.

export type SchemaField = { name?: string; kind: string };

export type OutputChunkOptions = {
  maxChars: number;
  maxBlocks: number;
  /** Maximum values a single request is expected to return. */
  maxValues: number;
  /** Trailing blocks of the previous chunk repeated at the start of the next (whole units only). Default 0. */
  overlap?: number;
  /** Repeat the nearest preceding heading at the start of a chunk. Default true. */
  headingContext?: boolean;
  /** Expected number of values in a text. Default: estimateValues over `fields`, or one per separated segment. */
  estimate?: (text: string) => number;
};

export type OutputChunkInfo = {
  /** Blocks that belong to this chunk (excluding context). */
  blockIds: string[];
  /** Blocks repeated from earlier text as context (headings, overlap). They are also in the chunk, first. */
  contextBlockIds: string[];
  expectedValues: number;
  chars: number;
  overBudget: boolean;
  /** A unit longer than the character limit was split across chunks by block. */
  splitUnit: boolean;
};

export type OutputChunking = {
  chunks: Block[][];
  info: OutputChunkInfo[];
  oversized: Block[];
  /** Block ids that are in neither a chunk nor `oversized`. Must be empty. */
  unaccounted: string[];
};

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const MONEY = /(?:\b[A-Z]{3}\s?|[$€£]|\bR\s?)\d[\d\s,.]*\d|(?:\b[A-Z]{3}\s?|[$€£]|\bR\s?)\d/g;
const DATE = new RegExp(`\\b\\d{1,2}\\s+${MONTH}\\s+\\d{4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`, 'gi');
const SEPARATOR = /\s\|\s|\t/;

/**
 * Generic estimate of how many values a schema yields from one text.
 *  - a row separated by ` | ` or tabs yields one value per non-empty segment;
 *  - a sentence with a money amount (when the schema asks for money) is a record: the amount, a quantity if asked for,
 *    and up to two text values; dates count one each; a short "label: text" line counts one when the schema has
 *    free-text fields;
 *  - everything else (plain prose) yields 0.
 * It is a heuristic for sizing requests, deliberately a little high, and is checked against the model's actual output.
 */
export function estimateValues(fields: SchemaField[], text: string): number {
  const kinds = new Set(fields.map((f) => f.kind));
  if (SEPARATOR.test(text)) return text.split(/\s\|\s|\t/).filter((s) => s.trim().length > 0).length;
  let n = (kinds.has('date') ? (text.match(DATE) ?? []).length : 0);
  const amounts = kinds.has('money') ? (text.match(MONEY) ?? []).length : 0;
  if (amounts > 0) {
    // An amount marks a record written as a sentence: the amount itself, a quantity if the schema asks for one, and
    // up to two descriptive text values (a name and a specification).
    n += amounts + (kinds.has('quantity') ? 1 : 0) + Math.min(2, fields.filter((f) => f.kind === 'text').length);
  } else if (n === 0 && kinds.has('text') && /^[^:]{1,40}:\s*\S.{0,160}$/.test(text.trim())) n = 1;
  return n;
}

export function schemaEstimator(fields: SchemaField[]): (text: string) => number {
  return (text) => estimateValues(fields, text);
}

/** A short line with no terminal punctuation and no row separator: a section heading. */
export function isHeading(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 60 && !SEPARATOR.test(t) && !/[.:;,!?]$/.test(t) && t.split(/\s+/).length <= 8;
}

function continues(prev: Block, b: Block): boolean {
  // A line the parser found to be the wrapped continuation of a cell above belongs to that row (parser 'ingest/2-cells').
  if (b.layout === 'positioned' && b.cells?.length === 1 && b.cells[0]!.wrapOf) return true;
  const t = b.text.trimStart();
  return /^[a-z|;,)\-–]/.test(t) || /[|\-–]\s*$/.test(prev.text.trimEnd());
}

/** A cell that is only a short identifier (letters and digits, no spaces): a row reference, not a value to extract. */
const isReferenceCell = (t: string) => t.length <= 12 && !/\s/.test(t) && /[A-Za-z]/.test(t) && /\d/.test(t);

/**
 * Expected values in a unit. A line with validated positioned cells counts one value per cell (a reference cell and a
 * wrapped continuation count none); other lines use the text estimate over the unit's joined text.
 */
function unitValues(blocks: Block[], estimate: (t: string) => number): number {
  if (!blocks.some((b) => b.layout === 'positioned' && b.cells)) return estimate(blocks.map((b) => b.text).join(' '));
  return blocks.reduce((n, b) => {
    if (b.layout === 'positioned' && b.cells) {
      if (b.cells.length === 1 && b.cells[0]!.wrapOf) return n;
      return n + b.cells.filter((c) => !isReferenceCell(b.text.slice(c.start, c.end))).length;
    }
    return n + estimate(b.text);
  }, 0);
}

type Unit = { blocks: Block[]; values: number; chars: number; heading: boolean };

export function chunkByOutput(blocks: Block[], o: OutputChunkOptions): OutputChunking {
  const estimate = o.estimate ?? ((t: string) => estimateValues([], t) || (SEPARATOR.test(t) ? t.split(/\s\|\s|\t/).length : 0));
  const overlap = Math.max(0, Math.floor(o.overlap ?? 0));
  const useHeading = o.headingContext !== false;
  const oversized: Block[] = [];

  // 1. Units: a row and its continuation lines. A block longer than the limit is reported, not sent.
  const units: Unit[] = [];
  for (const b of blocks) {
    if (b.text.length > o.maxChars) {
      oversized.push(b);
      continue;
    }
    const last = units[units.length - 1];
    if (last && continues(last.blocks[last.blocks.length - 1]!, b)) {
      last.blocks.push(b);
      last.chars += b.text.length;
      last.heading = false;
    } else {
      units.push({ blocks: [b], values: 0, chars: b.text.length, heading: isHeading(b.text) });
    }
  }
  for (const u of units) u.values = unitValues(u.blocks, estimate);

  // 2. Greedy fill by values, characters and blocks.
  type Draft = { own: Unit[]; context: Block[]; values: number; chars: number; blocks: number; overBudget: boolean; splitUnit: boolean };
  const drafts: Draft[] = [];
  let lastHeading: Block | null = null;
  const start = (prevOwn: Unit[]): Draft => {
    const context: Block[] = [];
    if (overlap > 0) {
      let n = 0;
      const tail: Unit[] = [];
      for (let i = prevOwn.length - 1; i >= 0 && n + prevOwn[i]!.blocks.length <= overlap; i--) {
        tail.unshift(prevOwn[i]!);
        n += prevOwn[i]!.blocks.length;
      }
      for (const u of tail) context.push(...u.blocks);
    }
    const values = context.reduce((s, b) => s + estimate(b.text), 0);
    return { own: [], context, values, chars: context.reduce((s, b) => s + b.text.length, 0), blocks: context.length, overBudget: false, splitUnit: false };
  };
  let cur = start([]);
  const flush = () => {
    // A heading left at the end of a chunk belongs with the text it introduces: carry it to the next chunk.
    let carried: Unit | null = null;
    const tailUnit = cur.own[cur.own.length - 1];
    if (cur.own.length > 1 && tailUnit?.heading) {
      carried = cur.own.pop()!;
      cur.values -= carried.values;
      cur.chars -= carried.chars;
      cur.blocks -= carried.blocks.length;
    }
    if (cur.own.length > 0) drafts.push(cur);
    cur = start(cur.own);
    if (carried) {
      cur.own.push(carried);
      cur.values += carried.values;
      cur.chars += carried.chars;
      cur.blocks += carried.blocks.length;
    }
  };
  for (const u of units) {
    const fits = (d: Draft) => d.values + u.values <= o.maxValues && d.chars + u.chars <= o.maxChars && d.blocks + u.blocks.length <= o.maxBlocks;
    if (!fits(cur) && cur.own.length > 0) flush();
    if (!fits(cur)) {
      // Alone it still does not fit. Drop the context for it; it goes on its own and is flagged if over the value budget.
      cur = { own: [], context: [], values: 0, chars: 0, blocks: 0, overBudget: false, splitUnit: false };
      if (u.chars > o.maxChars || u.blocks.length > o.maxBlocks) {
        // Split the unit by block, never losing a block.
        let piece: Unit | null = null;
        const pieces: Unit[] = [];
        for (const b of u.blocks) {
          if (!piece || piece.chars + b.text.length > o.maxChars || piece.blocks.length >= o.maxBlocks) {
            piece = { blocks: [], values: 0, chars: 0, heading: false };
            pieces.push(piece);
          }
          piece.blocks.push(b);
          piece.chars += b.text.length;
        }
        for (const p of pieces) {
          p.values = estimate(p.blocks.map((b) => b.text).join(' '));
          drafts.push({ own: [p], context: [], values: p.values, chars: p.chars, blocks: p.blocks.length, overBudget: p.values > o.maxValues, splitUnit: true });
        }
        cur = start(pieces);
        continue;
      }
    }
    if (cur.own.length === 0 && useHeading && lastHeading && !u.heading && !cur.context.some((c) => c.id === lastHeading!.id)) {
      cur.context.unshift(lastHeading);
      cur.chars += lastHeading.text.length;
      cur.blocks += 1;
      cur.values += estimate(lastHeading.text);
    }
    cur.own.push(u);
    cur.values += u.values;
    cur.chars += u.chars;
    cur.blocks += u.blocks.length;
    if (cur.values > o.maxValues && cur.own.length === 1) cur.overBudget = true;
    if (u.heading) lastHeading = u.blocks[0]!;
    if (cur.overBudget) flush();
  }
  if (cur.own.length > 0) drafts.push(cur);

  const chunks = drafts.map((d) => [...d.context, ...d.own.flatMap((u) => u.blocks)]);
  const info: OutputChunkInfo[] = drafts.map((d) => {
    const own = d.own.flatMap((u) => u.blocks);
    return { blockIds: own.map((b) => b.id), contextBlockIds: d.context.map((b) => b.id), expectedValues: d.values, chars: d.chars, overBudget: d.overBudget, splitUnit: d.splitUnit };
  });
  const seen = new Set<string>([...info.flatMap((i) => i.blockIds), ...oversized.map((b) => b.id)]);
  return { chunks, info, oversized, unaccounted: blocks.filter((b) => !seen.has(b.id)).map((b) => b.id) };
}
