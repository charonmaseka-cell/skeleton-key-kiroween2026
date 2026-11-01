import { describe, expect, it } from 'vitest';
import { chunkByOutput, estimateValues, isHeading, schemaEstimator } from '../src';
import { block } from './helpers';

const rowFields = [{ kind: 'text' }, { kind: 'quantity' }, { kind: 'text' }];
const mk = (texts: string[]) => texts.map((t, i) => block('d', `b${i + 1}`, t));
const row = (n: number) => `Line ${n} Widget | qty ${n} units | steel body`; // 3 values
const O = { maxChars: 10_000, maxBlocks: 400, maxValues: 6, estimate: schemaEstimator(rowFields) };
const own = (r: ReturnType<typeof chunkByOutput>) => r.info.map((i) => i.blockIds);

describe('estimateValues', () => {
  it('counts one value per separated segment of a row', () => {
    expect(estimateValues(rowFields, row(1))).toBe(3);
    expect(estimateValues(rowFields, 'a\t b\tc\td')).toBe(4);
  });
  it('plain prose is 0; a short label line is 1 when the schema has text fields', () => {
    expect(estimateValues(rowFields, 'Bidders should read every clause of this document before preparing an offer.')).toBe(0);
    expect(estimateValues(rowFields, 'Payment: thirty days from a correct invoice.')).toBe(1);
    expect(estimateValues([{ kind: 'money' }], 'Payment: thirty days from a correct invoice.')).toBe(0);
  });
  it('a sentence with an amount is a record (amount, quantity, up to two text values)', () => {
    const f = [{ kind: 'text' }, { kind: 'quantity' }, { kind: 'money' }, { kind: 'text' }];
    expect(estimateValues(f, 'We offer 10 units of Pump with a steel casing at R 12 500 each.')).toBe(4);
  });
  it('dates count only when the schema asks for them', () => {
    expect(estimateValues([{ kind: 'date' }], 'Starts 1 March 2027 and ends 2027-12-31.')).toBe(2);
    expect(estimateValues([{ kind: 'money' }], 'Starts 1 March 2027.')).toBe(0);
  });
});

describe('chunkByOutput', () => {
  it('sizes chunks by expected values and accounts for every block, in order, with source ids unchanged', () => {
    const blocks = mk([...Array.from({ length: 7 }, (_, i) => row(i + 1))]);
    const r = chunkByOutput(blocks, O);
    expect(own(r)).toEqual([['b1', 'b2'], ['b3', 'b4'], ['b5', 'b6'], ['b7']]);
    expect(r.info.map((i) => i.expectedValues)).toEqual([6, 6, 6, 3]);
    expect(r.unaccounted).toEqual([]);
    expect(r.oversized).toEqual([]);
    expect(r.chunks.flat().map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']);
    // the chunk holds the original block objects, so evidence offsets still point at the source text
    expect(r.chunks[0]![0]).toBe(blocks[0]);
  });

  it('keeps a row and its continuation lines together', () => {
    const blocks = mk([row(1), `${row(2)} |`, 'with extra detail', row(3), 'and a lowercase continuation']);
    const r = chunkByOutput(blocks, { ...O, maxValues: 7 });
    for (const ids of own(r)) {
      // b2 and b3 are one row; b4 and b5 are one row
      expect(ids.includes('b2') === ids.includes('b3')).toBe(true);
      expect(ids.includes('b4') === ids.includes('b5')).toBe(true);
    }
    expect(r.unaccounted).toEqual([]);
  });

  it('repeats the nearest preceding heading as context, listed apart from the chunk\'s own blocks', () => {
    const blocks = mk(['Schedule of items', row(1), row(2), row(3), row(4)]);
    expect(isHeading('Schedule of items')).toBe(true);
    const r = chunkByOutput(blocks, O);
    expect(r.info[0]!.contextBlockIds).toEqual([]);
    expect(r.info[1]!.contextBlockIds).toEqual(['b1']);
    expect(r.chunks[1]!.map((b) => b.id)).toEqual(['b1', 'b4', 'b5']);
    expect(r.info[1]!.blockIds).toEqual(['b4', 'b5']);
    expect(r.unaccounted).toEqual([]);
  });

  it('does not strand a heading at the end of a chunk', () => {
    const blocks = mk([row(1), row(2), 'Next section', row(3)]);
    const r = chunkByOutput(blocks, O);
    expect(own(r)).toEqual([['b1', 'b2'], ['b3', 'b4']]);
  });

  it('repeats trailing whole rows when overlap is requested, within the limits', () => {
    const blocks = mk([row(1), row(2), row(3), row(4)]);
    const r = chunkByOutput(blocks, { ...O, maxValues: 9, overlap: 1, headingContext: false });
    expect(r.info.map((i) => i.blockIds)).toEqual([['b1', 'b2', 'b3'], ['b4']]);
    expect(r.info[1]!.contextBlockIds).toEqual(['b3']);
    expect(r.info[1]!.expectedValues).toBe(6);
  });

  it('a unit alone over the value budget goes in its own chunk, flagged, and is not dropped', () => {
    const big = 'Big a | b | c | d | e | f | g | h';
    const r = chunkByOutput(mk([row(1), big, row(2)]), O);
    expect(own(r)).toEqual([['b1'], ['b2'], ['b3']]);
    expect(r.info.map((i) => i.overBudget)).toEqual([false, true, false]);
    expect(r.unaccounted).toEqual([]);
  });

  it('a block longer than the character limit is reported as oversized, never dropped silently', () => {
    const r = chunkByOutput(mk([row(1), 'x'.repeat(500), row(2)]), { ...O, maxChars: 200 });
    expect(r.oversized.map((b) => b.id)).toEqual(['b2']);
    expect(r.unaccounted).toEqual([]);
  });

  it('a row group longer than the character limit is split by block and marked', () => {
    const lines = ['start of row |', 'part two |', 'part three |', 'part four'];
    const r = chunkByOutput(mk(lines), { ...O, maxChars: 30, estimate: () => 1 });
    expect(r.info.every((i) => i.splitUnit)).toBe(true);
    expect(r.chunks.flat().map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(r.unaccounted).toEqual([]);
  });

  it('every chunk respects the character and block limits', () => {
    const r = chunkByOutput(mk(Array.from({ length: 30 }, (_, i) => row(i + 1))), { ...O, maxChars: 150, maxBlocks: 3, maxValues: 100 });
    for (const c of r.chunks) {
      expect(c.length).toBeLessThanOrEqual(3);
      expect(c.reduce((n, b) => n + b.text.length, 0)).toBeLessThanOrEqual(150);
    }
    expect(r.unaccounted).toEqual([]);
  });

  it('is deterministic and uses only text and the estimator (identical input gives identical output)', () => {
    const blocks = mk(['Items', ...Array.from({ length: 12 }, (_, i) => row(i + 1))]);
    expect(chunkByOutput(blocks, O)).toEqual(chunkByOutput(blocks.map((b) => ({ ...b })), O));
  });
});
