import { describe, expect, it } from 'vitest';
import { chunkForSchema, MAX_VALUES_PER_REQUEST } from './schema-fields';

const rows = Array.from({ length: 10 }, (_, i) => ({ id: `d-${i}`, docId: 'd', kind: 'pdf-run' as const, text: `Item ${i} Pump | qty ${i} units | steel` }));

describe('chunkForSchema', () => {
  it('splits by expected values for a known schema and keeps every block', () => {
    const { chunks, oversized } = chunkForSchema('scopecheck.rfq.v1', rows);
    expect(chunks.length).toBeGreaterThan(1);
    expect(MAX_VALUES_PER_REQUEST).toBe(14);
    expect(oversized).toEqual([]);
    expect(chunks.flat().map((b) => b.id)).toEqual(rows.map((r) => r.id));
  });
  it('uses the size-only chunker when limits are given explicitly', () => {
    expect(chunkForSchema('scopecheck.rfq.v1', rows, { maxChars: 100_000, maxBlocks: 400 }).chunks).toHaveLength(1);
  });
});
