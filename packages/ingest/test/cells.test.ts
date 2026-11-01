import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGACY_PARSER_VERSION, PARSER_VERSION, detectCells, groupLines, groupRows, parsePdf } from '../src';
import type { RawItem } from '../src/core';

// Coordinate-aware cell detection, on PDFs whose items are genuinely positioned in columns. Synthetic items stand in for
// PDF.js output (the sample PDFs expose each row as one text item, so they have no x-coordinates to split on).

const H = 10;
const CW = 5; // character width
const item = (str: string, x: number, y: number): RawItem => ({ str, x, y, w: str.length * CW, h: H });
const COL = [50, 260, 340];
/** a row of cells at the grid columns */
const rowAt = (y: number, ...cells: [number, string][]) =>
  cells.flatMap(([c, t]) => {
    let x = COL[c]!;
    return t.split(' ').map((w) => {
      const it = item(w, x, y);
      x += w.length * CW + 3; // a word space (3) is well under a text height (10)
      return it;
    });
  });
const analyse = (items: RawItem[]) => {
  const rows = groupRows(items);
  const lines = groupLines(items);
  const ids = lines.map((_, i) => `p1-l${i + 1}`);
  return { rows, lines, ids, out: detectCells(rows, ids) };
};

const grid3 = (extra: RawItem[] = []) => [
  ...rowAt(700, [0, 'Item CP-101 Centrifugal pump'], [1, 'qty 10 units'], [2, '316 stainless steel']),
  ...rowAt(686, [0, 'Item CP-102 Submersible pump'], [1, 'qty 6 units'], [2, 'cast iron body']),
  ...rowAt(672, [0, 'Item CP-103 Dosing pump'], [1, 'qty 4 units'], [2, 'PVC head']),
  ...rowAt(658, [0, 'Item VL-201 Gate valve'], [1, 'qty 40 units'], [2, 'ductile iron']),
  ...extra,
];

describe('positioned columns', () => {
  it('finds the cells of each line as offsets into the UNCHANGED line text', () => {
    const { lines, out } = analyse(grid3());
    expect(out.map((o) => o.layout)).toEqual(['positioned', 'positioned', 'positioned', 'positioned']);
    for (const [i, o] of out.entries()) {
      expect(o.text).toBe(lines[i]!.text); // the same text the plain parser gives: evidence offsets stay valid
      expect(o.cells).toHaveLength(3);
    }
    const first = out[0]!;
    expect(first.cells!.map((c) => first.text.slice(c.start, c.end))).toEqual(['Item CP-101 Centrifugal pump', 'qty 10 units', '316 stainless steel']);
  });

  it('cells are ordered, do not overlap, and sit on the page grid', () => {
    const { out } = analyse(grid3());
    for (const o of out) {
      const cs = o.cells!;
      expect(cs.every((c, k) => k === 0 || c.start > cs[k - 1]!.end)).toBe(true);
      expect(cs.map((c) => Math.round(c.x0 / 10) * 10)).toEqual([50, 260, 340]);
    }
  });
});

describe('wrapped cells', () => {
  it('a line under the third column continues that cell of the line above', () => {
    const { out, ids } = analyse(grid3([item('and a long wrapped spec', COL[2]!, 644)]));
    const wrapped = out[4]!;
    expect(wrapped.layout).toBe('positioned');
    expect(wrapped.cells).toHaveLength(1);
    expect(wrapped.cells![0]!.wrapOf).toEqual({ blockId: ids[3], cell: 2 });
  });

  it('a wrapped continuation of a wrapped line keeps pointing at the original cell', () => {
    const { out, ids } = analyse(grid3([item('first wrap', COL[2]!, 644), item('second wrap', COL[2]!, 630)]));
    expect(out[5]!.cells![0]!.wrapOf).toEqual({ blockId: ids[3], cell: 2 });
  });

  it('a lone line under the FIRST column is uncertain (a new line, or a wrapped first cell): no cells, nothing guessed', () => {
    const { out } = analyse(grid3([item('Some text under the item column', COL[0]!, 644)]));
    expect(out[4]!.layout).toBe('uncertain');
    expect(out[4]!.cells).toBeUndefined();
  });

  it('a lone line under a column the line above did not use is uncertain', () => {
    const rows = [...grid3(), ...rowAt(644, [0, 'Item GK-801 Gasket kit'], [2, 'graphite']), item('stray', COL[1]!, 630)];
    const { out } = analyse(rows);
    expect(out[5]!.layout).toBe('uncertain');
  });
});

describe('adjacent columns and uncertain layouts', () => {
  it('columns closer than a text height are one cell: the line is not split, and where that breaks the grid it is uncertain', () => {
    // the item text runs right up to where the second column starts (gap 2 < a text height), so the two read as one cell
    const long = 'Item GK-801 Gasket kit spiral wound graphite'; // 44 chars, 220 units wide: ends at 270
    const crowded = [...grid3(), item(long, COL[0]!, 644), item('qty 50', COL[1]!, 644), item('graphite', COL[2]!, 644)];
    const { out } = analyse(crowded);
    expect(out[4]!.layout).toBe('uncertain');
    expect(out[4]!.cells).toBeUndefined();
  });

  it('too few aligned lines do not make a grid: every multi-cell line is uncertain', () => {
    const { out } = analyse([...rowAt(700, [0, 'Item A'], [1, 'qty 1']), ...rowAt(686, [0, 'Item B'], [1, 'qty 2'])]);
    expect(out.map((o) => o.layout)).toEqual(['uncertain', 'uncertain']);
  });

  it('a line whose cells are off the grid is uncertain even when the page has a grid', () => {
    const off = [...grid3(), item('Item ZZ-9 Odd', 50, 644), item('qty 9', 300, 644)];
    expect(analyse(off).out[4]!.layout).toBe('uncertain');
  });

  it('plain text lines are single_item', () => {
    const { out } = analyse([item('Prices are fixed for the validity period.', 50, 700), item('Payment is made in thirty days.', 50, 686)]);
    expect(out.map((o) => o.layout)).toEqual(['single_item', 'single_item']);
  });

  it('a row that is ONE text item with written separators is single_item: x-coordinates cannot split it', () => {
    const { out } = analyse([item('Item TK-110 Storage tank 5 m3 | qty 2 units | HDPE, vertical', 50, 700)]);
    expect(out[0]!.layout).toBe('single_item');
    expect(out[0]!.cells).toBeUndefined();
  });
});

describe('parser versions', () => {
  it('the current parser is versioned and the legacy one is named', () => {
    expect(PARSER_VERSION).toBe('ingest/2-cells');
    expect(LEGACY_PARSER_VERSION).toBe('ingest/1');
  });

  it('the real sample PDFs: every block says which parser made it, the text is the text the previous parser gave, and no cells are invented', async () => {
    const data = readFileSync(new URL('../../../samples/scopecheck-realistic/rfq.pdf', import.meta.url));
    const blocks = await parsePdf(new Uint8Array(data), 'rfq');
    expect(blocks.length).toBe(93);
    expect(blocks.every((b) => b.parser === PARSER_VERSION)).toBe(true);
    expect(blocks.some((b) => b.layout === 'positioned' || b.cells)).toBe(false);
    expect(blocks.find((b) => b.id === 'p2-l14')!.text).toBe('Item TK-110 Storage tank 5 m3 | qty 2 units | HDPE, vertical');
  });
});
