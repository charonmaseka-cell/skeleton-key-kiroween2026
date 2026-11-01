import { describe, expect, it } from 'vitest';
import { chunkBlocks, issuesFromDocument, issuesFromFacts, newExtraction, serverDroppedIssue } from '../src';
import { block, fact } from './helpers';

describe('chunking', () => {
  const blocks = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeeeeeeeee'].map((t, i) => block('d', `b${i}`, t));
  it('splits in order within char and block limits', () => {
    const { chunks, oversized } = chunkBlocks(blocks, { maxChars: 9, maxBlocks: 2 });
    expect(chunks.map((c) => c.map((b) => b.id))).toEqual([['b0', 'b1'], ['b2', 'b3']]);
    expect(oversized.map((b) => b.id)).toEqual(['b4']); // too big to send; reported, not dropped silently
  });
  it('keeps every sendable block exactly once', () => {
    const { chunks } = chunkBlocks(blocks.slice(0, 4), { maxChars: 7, maxBlocks: 10 });
    expect(chunks.flat().map((b) => b.id)).toEqual(['b0', 'b1', 'b2', 'b3']);
    expect(chunks.every((c) => c.reduce((n, b) => n + b.text.length, 0) <= 7)).toBe(true);
  });
});

describe('extraction issues', () => {
  it('classifies rejected and ambiguous facts, failed chunks and unprocessed blocks; never implies coverage', () => {
    const facts = [
      fact({ id: 'a', value: null, status: 'needs_review', reason: 'excerpt_not_found', evidence: [] }),
      fact({ id: 'b', value: null, status: 'needs_review', reason: 'date_format_ambiguous' }),
      fact({ id: 'c', value: 'x', status: 'validated' }),
    ];
    expect(issuesFromFacts(facts).map((i) => [i.factId, i.kind])).toEqual([['a', 'claim_rejected'], ['b', 'claim_ambiguous']]);
    const doc = newExtraction('d', ['b0', 'b1', 'b2'], [{ id: 'c1', blockIds: ['b0'], status: 'ok' }, { id: 'c2', blockIds: ['b1'], status: 'failed' }]);
    expect(issuesFromDocument(doc).map((i) => i.kind)).toEqual(['chunk_failed', 'block_unprocessed']);
    expect(doc.coverage.state).toBe('unverified');
    expect(serverDroppedIssue('d', { unknown_block: 2, unknown_field: 0 })).toEqual([{ docId: 'd', kind: 'server_dropped', reason: 'unknown_block', count: 2 }]);
  });
});
