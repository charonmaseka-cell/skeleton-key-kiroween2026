import type { RawItem } from './core';

// Coordinate-aware cell detection (parser 'ingest/2-cells').
//
// For PDFs whose text items are genuinely POSITIONED in columns, find the cells of each line from the gaps between items,
// and check them against a column grid shared by several lines of the page. The result is written as offsets into the
// unchanged line text, so evidence offsets and evidence mappings made against the plain text stay valid.
//
// It deliberately does NOT help where a whole row is one text item that already contains separators ("A | B | C"): there
// is no x-coordinate to split on. For that case the identity step uses the separators written in the text (identity.ts).
//
// Verdicts per line (Block.layout):
//   positioned   several cells whose starts all sit on the page's column grid; or a wrapped continuation of one cell
//   single_item  one cell, not a continuation of anything
//   uncertain    the line has several cells that do not sit on the grid, or a lone line that could be either a new line or
//                a continuation of the first column. No cells are given; nothing is guessed.
// A column needs at least MIN_ROWS lines to count as a grid column, and at least two columns are needed for any grid.

export const MIN_ROWS = 3;
type Cell = { start: number; end: number; x0: number; x1: number; wrapOf?: { blockId: string; cell: number } };
export type CellLayout = { layout: 'positioned' | 'single_item' | 'uncertain'; text: string; cells?: Cell[] };

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 10;

type RowCells = { texts: string[]; x0: number[]; x1: number[] };

function splitRow(row: RawItem[]): RowCells {
  const h = Math.max(...row.map((i) => i.h), 1);
  const breakGap = Math.max(h, 4); // a word space is about a quarter of the height; a column gap is at least a height
  const out: RowCells = { texts: [], x0: [], x1: [] };
  let cur: RawItem[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.texts.push(collapse(cur.map((i) => i.str).join(' ')));
    out.x0.push(Math.min(...cur.map((i) => i.x)));
    out.x1.push(Math.max(...cur.map((i) => i.x + i.w)));
    cur = [];
  };
  for (const it of row) {
    const prev = cur[cur.length - 1];
    if (prev && it.x - (prev.x + prev.w) > breakGap) flush();
    cur.push(it);
  }
  flush();
  return out;
}

/** Column starts supported by at least MIN_ROWS lines, left to right. */
function columnGrid(rows: RowCells[], tol: number): number[] {
  const starts = rows.filter((r) => r.texts.length >= 2).flatMap((r) => r.x0.map((x) => ({ x })));
  const sorted = starts.map((s) => s.x).sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const x of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && x - last[last.length - 1]! <= tol) last.push(x);
    else clusters.push([x]);
  }
  return clusters.filter((c) => c.length >= MIN_ROWS).map((c) => median(c));
}

const colOf = (grid: number[], x: number, tol: number) => grid.findIndex((g) => Math.abs(g - x) <= tol);

export function detectCells(rows: RawItem[][], blockIds: string[]): CellLayout[] {
  const split = rows.map(splitRow);
  const text = split.map((r) => r.texts.join(' '));
  const tol = Math.max(2, 0.4 * median(rows.map((r) => Math.max(...r.map((i) => i.h), 1))));
  const grid = columnGrid(split, tol);
  const result: CellLayout[] = [];
  // per resolved row: the grid column of each cell and where that cell started in the source (chain root for wraps)
  const resolved: ({ cols: number[]; origin: ({ blockId: string; cell: number } | undefined)[] } | null)[] = [];

  split.forEach((r, i) => {
    const t = text[i]!;
    const offsets = (() => {
      let pos = 0;
      return r.texts.map((c) => {
        const start = pos;
        pos += c.length + 1;
        return { start, end: start + c.length };
      });
    })();
    const make = (extra: Partial<Cell>[] = []): Cell[] => r.texts.map((_, k) => ({ ...offsets[k]!, x0: r.x0[k]!, x1: r.x1[k]!, ...(extra[k] ?? {}) }));
    resolved[i] = null;

    if (r.texts.length >= 2) {
      const cols = r.x0.map((x) => colOf(grid, x, tol));
      // A cell that runs on past the start of the next grid column has swallowed that column (adjacent columns closer than a
      // text height merge into one cell): the line is uncertain, not split.
      const swallows = cols.some((c, k) => c >= 0 && grid[c + 1] !== undefined && r.x1[k]! > grid[c + 1]! + tol);
      const ok = grid.length >= 2 && cols.every((c) => c >= 0) && new Set(cols).size === cols.length && cols.every((c, k) => k === 0 || c > cols[k - 1]!) && !swallows;
      if (!ok) {
        result.push({ layout: 'uncertain', text: t });
        return;
      }
      resolved[i] = { cols, origin: cols.map((_, k) => ({ blockId: blockIds[i]!, cell: k })) };
      result.push({ layout: 'positioned', text: t, cells: make() });
      return;
    }

    // one cell: a continuation of a cell above, a new plain line, or unclear
    const prev = i > 0 ? resolved[i - 1] : null;
    const c = grid.length >= 2 ? colOf(grid, r.x0[0]!, tol) : -1;
    if (!prev || c < 0) {
      result.push({ layout: 'single_item', text: t });
      return;
    }
    const at = prev.cols.indexOf(c);
    if (c === 0 || at < 0) {
      // Under the first column, or under a column the line above did not use: a new line or a wrapped first cell. Unclear.
      result.push({ layout: 'uncertain', text: t });
      return;
    }
    const root = prev.origin[at]!;
    resolved[i] = { cols: [c], origin: [root] };
    result.push({ layout: 'positioned', text: t, cells: make([{ wrapOf: root }]) });
  });
  return result;
}
