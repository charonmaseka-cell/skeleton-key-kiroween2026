import { describe, expect, it } from 'vitest';
import { checkSupport, dateCandidates, documentDateOrder, numericDateOrder, validateClaims, type Block } from '../src';
import pack from '../../../samples/fixtures/packcheck-pack.json';

// Date-order rule: an ambiguous numeric date (01/03/2026: 1 March or 3 January?) is read in the order that another date in
// the same excerpt, or else in the same document, proves (28/02/2027 can only be day first). No proof, or conflicting proof,
// leaves it ambiguous. Engine level, so both apps and the benchmark follow it.

const date = (excerpt: string, claimed: string, documentDateOrder?: 'day_first' | 'month_first' | null, hints?: string[]) =>
  checkSupport({ kind: 'date', claimed, excerpt, hints, documentDateOrder });
const blk = (docId: string, id: string, text: string): Block => ({ id, docId, text, page: 1 }) as Block;

describe('numericDateOrder', () => {
  it('a day above 12 proves day first; a month position above 12 proves month first', () => {
    expect(numericDateOrder('Invoice 28/02/2027')).toEqual({ order: 'day_first', conflict: false });
    expect(numericDateOrder('Invoice 02/28/2027')).toEqual({ order: 'month_first', conflict: false });
    expect(numericDateOrder('28.02.2027')).toEqual({ order: 'day_first', conflict: false });
  });
  it('ambiguous, equal-part, ISO and month-name dates prove nothing', () => {
    for (const t of ['01/03/2026', '05/05/2026', '2027-02-28', '28 February 2027', 'February 28, 2027', 'no date here']) expect(numericDateOrder(t)).toEqual({ order: null, conflict: false });
  });
  it('an impossible date (31/02/2027, 45/03/2026) proves nothing', () => {
    expect(numericDateOrder('31/02/2027 45/03/2026')).toEqual({ order: null, conflict: false });
  });
  it('two dates that prove opposite orders are a conflict', () => {
    expect(numericDateOrder('28/02/2027 and 02/28/2027')).toEqual({ order: null, conflict: true });
  });
});

describe('same excerpt', () => {
  it('"01/03/2026 to 28/02/2027": the start date is 1 March 2026, validated, and says where its order came from', () => {
    expect(date('Project period: 01/03/2026 to 28/02/2027', '2026-03-01', null, ['period'])).toMatchObject({ status: 'supported', resolved: '2026-03-01' });
    expect(dateCandidates('Project period: 01/03/2026 to 28/02/2027')[0]).toMatchObject({ iso: '2026-03-01', ambiguous: false, orderFrom: 'excerpt' });
  });
  it('month-first proof (02/28/2027) reads 03/01/2026 as 1 March 2026', () => {
    expect(date('From 03/01/2026 to 02/28/2027', '2026-03-01', null, ['from'])).toMatchObject({ status: 'supported', resolved: '2026-03-01' });
  });
  it('a claim that disagrees with the proven order is not supported (the order is never bent to fit the model)', () => {
    expect(date('Project period: 01/03/2026 to 28/02/2027', '2026-01-03', null, ['period'])).toMatchObject({ status: 'unsupported', reason: 'value_not_in_excerpt' });
  });
  it('conflicting proof in the excerpt leaves it ambiguous, and the document cannot override that', () => {
    const t = 'Dates: 01/03/2026, 28/02/2027, 02/28/2027';
    expect(dateCandidates(t)[0]).toMatchObject({ ambiguous: true, iso: null });
    expect(dateCandidates(t, 'day_first')[0]).toMatchObject({ ambiguous: true, iso: null });
    expect(date('Starts 01/03/2026 (28/02/2027 or 02/28/2027)', '2026-03-01', 'day_first', ['starts'])).toMatchObject({ status: 'needs_review', reason: 'date_format_ambiguous' });
  });
  it('with no proof anywhere the date stays ambiguous, as before', () => {
    expect(date('Starts 01/02/2026', '2026-02-01')).toMatchObject({ status: 'needs_review', reason: 'date_format_ambiguous' });
    expect(date('Starts 01/02/2026', '2026-02-01', null)).toMatchObject({ status: 'needs_review', reason: 'date_format_ambiguous' });
  });
  it('a month-name date in the excerpt is no proof of numeric order', () => {
    expect(date('Project period: 01/03/2026 to 28 February 2027', '2026-03-01', null, ['period'])).toMatchObject({ status: 'needs_review', reason: 'date_format_ambiguous' });
  });
});

describe('same document', () => {
  it('another block of the document proves the order: the date is validated through validateClaims', () => {
    const blocks = [blk('d', 'b1', 'Invoice date: 25/03/2026'), blk('d', 'b2', 'Starts 01/03/2026')];
    expect(documentDateOrder('d', blocks)).toBe('day_first');
    const [f] = validateClaims([{ field: 'start', blockId: 'b2', excerpt: 'Starts 01/03/2026', value: '2026-03-01', kind: 'date' }], { docId: 'd', blocks });
    expect(f).toMatchObject({ status: 'validated', value: '2026-03-01' });
    expect(dateCandidates('Starts 01/03/2026', 'day_first')[0]).toMatchObject({ iso: '2026-03-01', orderFrom: 'document' });
  });
  it('another DOCUMENT proves nothing: only the same document counts', () => {
    const blocks = [blk('other', 'b1', 'Invoice date: 25/03/2026'), blk('d', 'b2', 'Starts 01/03/2026')];
    expect(documentDateOrder('d', blocks)).toBeNull();
    const [f] = validateClaims([{ field: 'start', blockId: 'b2', excerpt: 'Starts 01/03/2026', value: '2026-03-01', kind: 'date' }], { docId: 'd', blocks });
    expect(f).toMatchObject({ status: 'needs_review', reason: 'date_format_ambiguous' });
  });
  it('conflicting dates across the document leave it ambiguous', () => {
    const blocks = [blk('d', 'b1', 'Issued 25/03/2026'), blk('d', 'b2', 'Due 03/25/2026'), blk('d', 'b3', 'Starts 01/03/2026')];
    expect(documentDateOrder('d', blocks)).toBeNull();
    const [f] = validateClaims([{ field: 'start', blockId: 'b3', excerpt: 'Starts 01/03/2026', value: '2026-03-01', kind: 'date' }], { docId: 'd', blocks });
    expect(f).toMatchObject({ status: 'needs_review', reason: 'date_format_ambiguous' });
  });
  it('the excerpt wins over the document when both prove an order', () => {
    expect(date('From 03/01/2026 to 02/28/2027', '2026-03-01', 'day_first', ['from'])).toMatchObject({ status: 'supported', resolved: '2026-03-01' });
  });
});

describe('the PackCheck sample keeps its planted ambiguity', () => {
  it('no date in the budget document proves an order, so 01/03/2026 stays ambiguous', () => {
    const budget = (pack as unknown as { docs: { id: string; blocks: Block[] }[] }).docs.find((d) => d.id === 'budget')!;
    expect(budget.blocks.some((b) => b.text.includes('01/03/2026'))).toBe(true);
    expect(documentDateOrder('budget', budget.blocks)).toBeNull();
    expect(budget.blocks.find((b) => b.text.includes('01/03/2026'))!.text).toBe('Project period: 01/03/2026 to 28 February 2027');
  });
});
