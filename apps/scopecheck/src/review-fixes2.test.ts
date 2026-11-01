import { describe, expect, it } from 'vitest';
import { chunkBlocks, validateClaims, type Block } from '@skeleton-key/engine';
import { confirmDocumentCoverage, emptySession, evaluateSession, type Fixture, type SessionState } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';
import { buildMatrix } from './ComparisonMatrix';
import { FIXTURES } from './fixtures';

// Reproduced cases from commit 11bb39e (second review round). Each test fails on that commit.

const standard = FIXTURES.find((f) => f.id === 'scopecheck-standard')!;
const run = (f: Fixture, s: SessionState = emptySession(), at = 1) => evaluateSession(scopeCheckAdapter, f, s, at);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type Claim = Record<string, unknown>;
const doc = (f: Fixture, id: string) => f.docs.find((d) => d.id === id)!;
const claims = (f: Fixture, id: string) => doc(f, id).claims as Claim[];
const block = (docId: string, id: string, text: string): Block => ({ id, docId, kind: 'pdf-run', text, page: 1, bbox: [0, 0, 1, 1] });
const confirmed = (id: string) => confirmDocumentCoverage(emptySession(), id, 2);
const item = (v: ReturnType<typeof run>, code: string, pred: (i: ReturnType<typeof run>['items'][number]) => boolean = () => true) => v.items.filter((i) => i.finding.code === code && pred(i));

/** Case 1: the RFQ asks for CP-100 twice (10 and 100 units). */
function twoCp100(): Fixture {
  const f = clone(standard);
  const rfq = doc(f, 'rfq');
  rfq.blocks.push(block('rfq', 'p1-l9', 'Item CP-100 Centrifugal pump | qty 100 units | 316 stainless steel casing'));
  claims(f, 'rfq').push(
    { field: 'item', kind: 'text', blockId: 'p1-l9', excerpt: 'Item CP-100 Centrifugal pump', value: 'CP-100 Centrifugal pump' },
    { field: 'quantity', kind: 'quantity', blockId: 'p1-l9', excerpt: 'qty 100 units', value: { value: '100', unit: 'units' } },
    { field: 'specification', kind: 'text', blockId: 'p1-l9', excerpt: '316 stainless steel casing', value: '316 stainless steel casing' },
  );
  return f;
}

describe('case 1: requirement lines have distinct identities; ambiguous allocation is explicit', () => {
  const v = run(twoCp100());

  it('no comparison for a duplicated requirement reuses another line\'s "agree"', () => {
    const cp = v.evaluation.comparisons.filter((c) => c.id.includes('CP-100'));
    expect(cp.filter((c) => c.status === 'agree' && c.docs[1] === 'quote-b')).toEqual([]);
  });

  it('every ledger entry has a distinct id (one per requirement line, aspect and quotation)', () => {
    const ids = v.evaluation.comparisons.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cp100 = v.evaluation.comparisons.filter((c) => c.field === 'quantity' && c.id.includes('CP-100') && c.docs[1] === 'quote-b');
    expect(cp100).toHaveLength(2);
  });

  it('both requirement lines get their own Needs-review finding (item.allocation_ambiguous) and Not-evaluated entries naming ambiguous allocation', () => {
    const f = item(v, 'item.allocation_ambiguous', (i) => i.finding.responseDocId === 'quote-b');
    expect(f).toHaveLength(2);
    expect(new Set(f.map((i) => i.finding.id)).size).toBe(2);
    expect(f.every((i) => i.finding.state === 'needs_review')).toBe(true);
    const ne = v.evaluation.comparisons.filter((c) => c.id.includes('CP-100') && c.docs[1] === 'quote-b');
    expect(ne.every((c) => c.status === 'not_evaluated' && c.blocked?.reason === 'ambiguous_allocation')).toBe(true);
  });

  it('no confirmed quantity or specification difference is stated for CP-100 against either quotation line', () => {
    expect(item(v, 'quantity.differs', (i) => i.finding.subjectId.startsWith('CP-100')).filter((i) => i.finding.responseDocId === 'quote-b')).toEqual([]);
  });

  it('the matrix has one row per requirement line, with distinct keys, and none says Agrees for the ambiguous item', () => {
    const m = buildMatrix(v);
    expect(m.rows).toHaveLength(4);
    const keys = m.rows.map((r) => r.rowId);
    expect(new Set(keys).size).toBe(4);
    const cpRows = m.rows.filter((r) => r.key === 'CP-100');
    expect(cpRows).toHaveLength(2);
    for (const r of cpRows) for (const c of r.cells.filter((x) => x.quote === 'quote-b')) expect(c.aspects.every((a) => a.comparison?.status === 'not_evaluated')).toBe(true);
  });

  it('control: with a single CP-100 requirement line the comparison runs normally', () => {
    expect(run(standard).evaluation.comparisons.find((c) => c.id === 'quantity:CP-100~quote-b')).toMatchObject({ status: 'agree' });
  });
});

/** Case 2: one quotation block carries two valid item claims (MS-20 and PG-6). */
function twoItemsInOneBlock(): Fixture {
  const f = clone(standard);
  const b = doc(f, 'quote-b').blocks.find((x) => x.text.includes('MS-20'))!;
  b.text += ' / Item PG-6 Pressure gauge';
  claims(f, 'quote-b').push({ field: 'item', kind: 'text', blockId: b.id, excerpt: 'Item PG-6 Pressure gauge', value: 'PG-6 Pressure gauge' });
  return f;
}

describe('case 2: several item facts in one block are handled explicitly, never "the first"', () => {
  const f = twoItemsInOneBlock();
  const v = run(f, confirmed('quote-b'), 2);

  it('the second claim is a valid, validated item fact', () => {
    expect(v.facts.filter((x) => x.docId === 'quote-b' && x.field === 'item' && x.status === 'validated')).toHaveLength(3);
  });

  it('PG-6 is NOT a confirmed omission after coverage confirmation (it is on the quotation, in a block that cannot be allocated)', () => {
    expect(item(v, 'item.absent', (i) => i.finding.responseDocId === 'quote-b').filter((i) => i.finding.state === 'confirmed')).toEqual([]);
    expect(item(v, 'item.absent', (i) => i.finding.subjectId === 'PG-6' && i.finding.responseDocId === 'quote-b')[0]!.finding.state).toBe('needs_review');
  });

  it('a Needs-review finding names the block and carries both item facts as inputs', () => {
    const m = item(v, 'item.multiple_items', (i) => i.finding.responseDocId === 'quote-b');
    expect(m).toHaveLength(1);
    expect(m[0]!.finding.state).toBe('needs_review');
    expect(m[0]!.finding.inputs.filter((i) => i.field === 'item')).toHaveLength(2);
  });

  it('comparisons that would have used that block are Not evaluated, not "agree"', () => {
    const c = v.evaluation.comparisons.filter((x) => x.docs[1] === 'quote-b' && /MS-20/.test(x.id));
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((x) => x.status === 'not_evaluated')).toBe(true);
  });
});

/** Case 3: an item claim whose excerpt is not in its source block (evidence-empty fact). */
function badExcerpt(docId: 'rfq' | 'quote-b'): Fixture {
  const f = clone(standard);
  const c = claims(f, docId).find((x) => x.field === 'item' && String(x.excerpt).includes('MS-20'))!;
  c.excerpt = 'Gearbox unit that is not in the text';
  return f;
}

describe('case 3a: a failed RFQ item stays visible in review and exports, with no invented evidence', () => {
  const v = run(badExcerpt('rfq'));
  const held = item(v, 'item.unverified', (i) => i.finding.responseDocId === 'rfq');

  it('is a Needs-review finding with the real reason and NO evidence', () => {
    expect(held).toHaveLength(1);
    expect(held[0]!.finding).toMatchObject({ state: 'needs_review', reason: 'excerpt_not_found' });
    expect(held[0]!.finding.evidence).toEqual([]);
    expect(held[0]!.finding.inputs[0]!.evidence).toEqual([]);
  });

  it('is exported as unresolved, with empty evidence', () => {
    const e = v.exportModel.unresolved.find((x) => x.code === 'item.unverified')!;
    expect(e).toBeTruthy();
    expect(e.evidence).toEqual([]);
  });

  it('its comparisons are Not evaluated for each quotation and aspect', () => {
    const ne = v.evaluation.comparisons.filter((c) => c.blocked?.reason === 'excerpt_not_found' && c.blocked.docId === 'rfq');
    expect(ne.map((c) => `${c.field}~${c.docs[1]}`).sort()).toEqual(['quantity~quote-a', 'quantity~quote-b', 'specification~quote-a', 'specification~quote-b']);
  });

  it('and it appears as a row in the matrix', () => {
    expect(buildMatrix(v).rows.some((r) => r.held)).toBe(true);
  });
});

describe('case 3b: an unresolved quotation item blocks confirmed omissions', () => {
  const v = run(badExcerpt('quote-b'), confirmed('quote-b'), 2);

  it('PG-6 stays Needs review (held candidate in the response) even after coverage confirmation', () => {
    const a = item(v, 'item.absent', (i) => i.finding.subjectId === 'PG-6' && i.finding.responseDocId === 'quote-b')[0]!;
    expect(a.finding).toMatchObject({ state: 'needs_review', reason: 'held_candidate_in_response' });
  });

  it('the failed quotation item itself is a visible Needs-review finding with no evidence', () => {
    const h = item(v, 'item.unverified', (i) => i.finding.responseDocId === 'quote-b');
    expect(h).toHaveLength(1);
    expect(h[0]!.finding.evidence).toEqual([]);
  });

  it('control: without the failed item, the same confirmation does confirm the PG-6 omission', () => {
    expect(item(run(standard, confirmed('quote-b'), 2), 'item.absent', (i) => i.finding.subjectId === 'PG-6')[0]!.finding.state).toBe('confirmed');
  });
});

describe('split items and overlapping chunks', () => {
  function splitCp100(): Fixture {
    const f = clone(standard);
    const q = doc(f, 'quote-b');
    const i = q.blocks.findIndex((b) => b.text.includes('CP-100'));
    const whole = q.blocks[i]!;
    // "Item CP-100 Centrifugal pump | qty 10 units | cast iron casing | R 11 900 each" split over two blocks
    const cut = whole.text.indexOf(' | ');
    const a = block('quote-b', whole.id, whole.text.slice(0, cut));
    const b = block('quote-b', `${whole.id}b`, whole.text.slice(cut + 3));
    q.blocks.splice(i, 1, a, b);
    for (const c of claims(f, 'quote-b')) if (c.blockId === whole.id && c.field !== 'item') c.blockId = b.id;
    return f;
  }

  it('an item description in one block and its quantity in the next never compare as "agree": Not evaluated, with the missing fact named', () => {
    const v = run(splitCp100());
    const q = v.evaluation.comparisons.find((c) => c.id === 'quantity:CP-100~quote-b')!;
    expect(q).toMatchObject({ status: 'not_evaluated', blocked: { docId: 'quote-b', field: 'quantity', reason: 'no_fact' } });
    expect(item(v, 'quantity.differs', (i) => i.finding.subjectId.startsWith('CP-100') && i.finding.responseDocId === 'quote-b')).toEqual([]);
  });

  it('when the second half is in a chunk that failed, nothing absent from that quotation can be confirmed', () => {
    const f = splitCp100();
    const q = doc(f, 'quote-b');
    const ids = q.blocks.map((b) => b.id);
    const cut = ids.indexOf(`${q.blocks.find((b) => b.id.endsWith('b'))!.id}`);
    q.chunks = [{ blockIds: ids.slice(0, cut), status: 'ok' }, { blockIds: ids.slice(cut), status: 'failed' }];
    const v = run(f, confirmed('quote-b'), 2);
    expect(item(v, 'item.absent', (i) => i.finding.responseDocId === 'quote-b').every((i) => i.finding.state === 'needs_review')).toBe(true);
    expect(v.exportModel.coverage.find((c) => c.docId === 'quote-b')).toMatchObject({ state: 'processing_incomplete' });
  });

  it('identical claims for the same block from overlapping chunks are one fact, not a "multiple candidates" conflict', () => {
    const f = clone(standard);
    const dup = claims(f, 'quote-a').filter((c) => c.blockId === doc(f, 'quote-a').blocks.find((b) => b.text.includes('CP-100'))!.id);
    claims(f, 'quote-a').push(...clone(dup)); // the overlap region was extracted twice
    const v = run(f);
    expect(v.evaluation.comparisons.find((c) => c.id === 'quantity:CP-100~quote-a')).toMatchObject({ status: 'flagged' });
    expect(v.evaluation.comparisons.some((c) => c.blocked?.reason === 'multiple_candidates')).toBe(false);
    expect(v.items.map((i) => i.finding.id).length).toBe(new Set(v.items.map((i) => i.finding.id)).size);
  });

  it('conflicting claims for the same block from overlapping chunks stay a conflict (Not evaluated), never the first one', () => {
    const f = clone(standard);
    const b = doc(f, 'quote-a').blocks.find((x) => x.text.includes('CP-100'))!;
    claims(f, 'quote-a').push({ field: 'quantity', kind: 'quantity', blockId: b.id, excerpt: 'qty 8 units', value: { value: '9', unit: 'units' } });
    const v = run(f);
    const c = v.evaluation.comparisons.find((x) => x.id === 'quantity:CP-100~quote-a')!;
    expect(c.status).toBe('not_evaluated');
  });
});

describe('engine: duplicate claims and overlapping chunks', () => {
  const b: Block = block('d', 'p1-l1', 'Item CP-100 Centrifugal pump | qty 8 units');
  const claim = { field: 'quantity', kind: 'quantity', blockId: 'p1-l1', excerpt: 'qty 8 units', value: { value: '8', unit: 'units' } };

  it('an exact duplicate claim yields one fact', () => {
    expect(validateClaims([claim, { ...claim }], { docId: 'd', blocks: [b], hintsByField: { quantity: ['qty'] } })).toHaveLength(1);
  });
  it('a claim for the same excerpt with a different value is kept as a separate fact', () => {
    const f = validateClaims([claim, { ...claim, value: { value: '9', unit: 'units' } }], { docId: 'd', blocks: [b], hintsByField: { quantity: ['qty'] } });
    expect(f).toHaveLength(2);
    expect(new Set(f.map((x) => x.id)).size).toBe(2);
  });
  it('chunk overlap repeats the last blocks of a chunk at the start of the next, and loses no block', () => {
    const blocks = Array.from({ length: 10 }, (_, i) => block('d', `p1-l${i + 1}`, 'x'.repeat(100)));
    const { chunks } = chunkBlocks(blocks, { maxChars: 450, maxBlocks: 400, overlap: 1 });
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]![0]!.id).toBe(chunks[i - 1]![chunks[i - 1]!.length - 1]!.id);
    expect(new Set(chunks.flat().map((x) => x.id)).size).toBe(10);
    for (const c of chunks) expect(c.reduce((n, x) => n + x.text.length, 0)).toBeLessThanOrEqual(450);
  });
  it('overlap 0 (the default) is unchanged', () => {
    const blocks = Array.from({ length: 10 }, (_, i) => block('d', `p1-l${i + 1}`, 'x'.repeat(100)));
    expect(chunkBlocks(blocks, { maxChars: 450, maxBlocks: 400 }).chunks.flat()).toHaveLength(10);
  });
});
