import { isEvidenceIntact, validateClaims, type Block, type Fact } from '@skeleton-key/engine';
import { describe, expect, it } from 'vitest';
import { resolveItemIdentities } from './identity';

// Source-grounded identity recovery from cell boundaries (no model, no labels). The real RFQ rows are ONE text item that
// already contains " | " separators, so the cells are the pipe-separated parts of the text.

const row = (id: string, text: string, extra: Partial<Block> = {}): Block => ({ id, docId: 'rfq', kind: 'pdf-run', text, page: 1, bbox: [0, 0, 100, 10], ...extra });
const itemFact = (b: Block, excerpt: string, value: string): Fact => validateClaims([{ field: 'item', kind: 'text', blockId: b.id, excerpt, value }], { docId: b.docId, blocks: [b] })[0]!;
const snapshot = (f: Fact[]) => JSON.stringify(f);

describe('a value that joins two source cells with "|" (the four unresolved RFQ rows)', () => {
  const b = row('p2-l14', 'Item TK-110 Storage tank 5 m3 | qty 2 units | HDPE, vertical');
  // the model cited the whole row and returned the description plus the specification cell
  const fact = itemFact(b, 'Item TK-110 Storage tank 5 m3 | qty 2 units | HDPE, vertical', 'Storage tank 5 m3 | HDPE, vertical');

  it('recovers the code from the description cell, records each part as an intact span, and leaves the raw claim alone', () => {
    expect(fact.status).toBe('validated');
    const before = snapshot([fact]);
    const r = resolveItemIdentities([fact], [b]);
    expect(r.identities.get(fact.id)).toEqual({ kind: 'code', code: 'TK-110', origin: 'recovered' });
    const rec = r.recovered[0]!;
    expect(rec.method).toBe('single_code_in_item_cell');
    expect(rec.codeSpan.text).toBe('TK-110');
    expect(rec.parts!.map((p) => p.text)).toEqual(['Storage tank 5 m3', 'HDPE, vertical']);
    const blocks = new Map([[b.id, b]]);
    expect([rec.codeSpan, ...rec.parts!].every((e) => isEvidenceIntact(e, blocks))).toBe(true);
    expect(fact.value).toBe('Storage tank 5 m3 | HDPE, vertical');
    expect(snapshot([fact])).toBe(before);
  });

  it('stays uncertain when a part is not in the source', () => {
    const f = itemFact(b, 'Item TK-110 Storage tank 5 m3 | qty 2 units | HDPE, vertical', 'Storage tank 5 m3 | HDPE, horizontal');
    expect(f.status === 'validated' ? resolveItemIdentities([f], [b]).identities.get(f.id) : { kind: 'uncertain' }).toMatchObject({ kind: 'uncertain' });
  });

  it('stays uncertain when a part occurs more than once in the cited span (not a cell boundary)', () => {
    const dup = row('p2-l15', 'Item TK-120 Dosing tank | qty 3 units | Dosing tank');
    const f = itemFact(dup, 'Item TK-120 Dosing tank | qty 3 units | Dosing tank', 'Dosing tank | 3 units');
    const r = resolveItemIdentities([f], [dup]);
    expect(r.identities.get(f.id)).toMatchObject({ kind: 'uncertain', reason: 'description_not_located' });
  });

  it('stays uncertain when two parts sit in the same cell', () => {
    const same = row('p2-l16', 'Item PN-130 Pipe DN50 PN16 HDPE | qty 120 lengths');
    const f = itemFact(same, 'Item PN-130 Pipe DN50 PN16 HDPE | qty 120 lengths', 'Pipe DN50 | PN16 HDPE');
    expect(resolveItemIdentities([f], [same]).identities.get(f.id)).toMatchObject({ kind: 'uncertain' });
  });

  it('keeps an ambiguous identity in review: two codes in the description cell', () => {
    const two = row('p2-l17', 'Item PN-140 Pipe DN100 to SANS-1200 | qty 80 lengths | HDPE, 6 m lengths');
    const f = itemFact(two, 'Item PN-140 Pipe DN100 to SANS-1200 | qty 80 lengths | HDPE, 6 m lengths', 'Pipe DN100 to SANS-1200 | HDPE, 6 m lengths');
    expect(resolveItemIdentities([f], [two]).identities.get(f.id)).toMatchObject({ kind: 'uncertain', reason: 'multiple_codes' });
  });

  it('does not use the code of a NEIGHBOURING cell: a code only in the specification cell is not the item code', () => {
    const spec = row('p2-l18', 'Item Flange set DN50 | qty 36 units | carbon steel, PN16, to SANS-1123');
    const f = itemFact(spec, 'Item Flange set DN50 | qty 36 units | carbon steel, PN16, to SANS-1123', 'Flange set DN50 | carbon steel, PN16, to SANS-1123');
    const id = resolveItemIdentities([f], [spec]).identities.get(f.id);
    expect(id).toEqual({ kind: 'description', key: 'flange set dn50' }); // description only: no code is invented
  });
});

describe('positioned cells from the parser take precedence over separators in the text', () => {
  // "A B" is one cell with no pipe: the code is tied to the item by the parser's cell, not by a separator.
  const text = 'Item CP-100 Centrifugal pump 10 units 316 stainless steel casing';
  const cells = [{ start: 0, end: 28, x0: 50, x1: 200 }, { start: 29, end: 37, x0: 260, x1: 300 }, { start: 38, end: text.length, x0: 340, x1: 480 }];
  const b = row('p1-l2', text, { layout: 'positioned', cells, parser: 'ingest/2-cells' });

  it('recovers the code from the item cell', () => {
    expect(text.slice(0, 28)).toBe('Item CP-100 Centrifugal pump');
    const f = itemFact(b, 'Item CP-100 Centrifugal pump', 'Centrifugal pump');
    const r = resolveItemIdentities([f], [b]);
    expect(r.identities.get(f.id)).toEqual({ kind: 'code', code: 'CP-100', origin: 'recovered' });
  });

  it('a code in a different positioned cell is not tied to the item', () => {
    const other = row('p1-l3', 'Item Centrifugal pump 10 units CP-999 stainless', { layout: 'positioned', cells: [{ start: 0, end: 22, x0: 50, x1: 150 }, { start: 23, end: 31, x0: 200, x1: 250 }, { start: 32, end: 45, x0: 300, x1: 420 }], parser: 'ingest/2-cells' });
    const f = itemFact(other, 'Item Centrifugal pump', 'Centrifugal pump');
    expect(resolveItemIdentities([f], [other]).identities.get(f.id)).toMatchObject({ kind: 'description' });
  });

  it('an uncertain layout gives no cells and falls back to the written separators', () => {
    const u = row('p1-l4', 'Item CP-100 Centrifugal pump | qty 10 units', { layout: 'uncertain', parser: 'ingest/2-cells' });
    const f = itemFact(u, 'Item CP-100 Centrifugal pump', 'Centrifugal pump');
    expect(resolveItemIdentities([f], [u]).identities.get(f.id)).toEqual({ kind: 'code', code: 'CP-100', origin: 'recovered' });
  });
});

describe('a reference in a cell of its own (genuinely positioned rows)', () => {
  const T = 'LB-3101 Digital pH meter 6 each 0.01 pH resolution';
  const cells = [{ start: 0, end: 7, x0: 50, x1: 90 }, { start: 8, end: 24, x0: 115, x1: 190 }, { start: 25, end: 31, x0: 300, x1: 330 }, { start: 32, end: T.length, x0: 360, x1: 470 }];
  const mk = (text: string, c = cells, layout: Block['layout'] = 'positioned') => row('p1-l9', text, { layout, cells: c, parser: 'ingest/2-cells' });

  it('the code in the reference cell is tied to the row\'s description, with its own intact span', () => {
    const b = mk(T);
    const f = itemFact(b, 'Digital pH meter', 'Digital pH meter');
    const r = resolveItemIdentities([f], [b]);
    expect(r.identities.get(f.id)).toEqual({ kind: 'code', code: 'LB-3101', origin: 'recovered' });
    expect(r.recovered[0]).toMatchObject({ method: 'row_reference_cell', code: 'LB-3101' });
    expect(r.recovered[0]!.codeSpan.text).toBe('LB-3101');
    expect(isEvidenceIntact(r.recovered[0]!.codeSpan, new Map([[b.id, b]]))).toBe(true);
  });

  it('a second code in the description cell makes the row uncertain; nothing is chosen', () => {
    const t = 'LB-3101 Digital pH meter to ISO-17034 6 each';
    const b = mk(t, [{ start: 0, end: 7, x0: 50, x1: 90 }, { start: 8, end: 37, x0: 115, x1: 250 }, { start: 38, end: t.length, x0: 300, x1: 330 }]);
    const f = itemFact(b, 'Digital pH meter to ISO-17034', 'Digital pH meter to ISO-17034');
    expect(resolveItemIdentities([f], [b]).identities.get(f.id)).toMatchObject({ kind: 'uncertain', reason: 'multiple_codes' });
  });

  it('a code that shares a cell with other words is not a reference cell (no code is invented)', () => {
    const t = 'Digital pH meter 6 each model LB-3101 plus';
    const b = mk(t, [{ start: 0, end: 16, x0: 50, x1: 130 }, { start: 17, end: 23, x0: 200, x1: 230 }, { start: 24, end: t.length, x0: 300, x1: 420 }]);
    const f = itemFact(b, 'Digital pH meter', 'Digital pH meter');
    expect(resolveItemIdentities([f], [b]).identities.get(f.id)).toEqual({ kind: 'description', key: 'digital ph meter' });
  });

  it('without cells the whole line is one segment, as before (the code is still found, by the older rule)', () => {
    const b = row('p1-l9', T);
    const f = itemFact(b, 'Digital pH meter', 'Digital pH meter');
    const r = resolveItemIdentities([f], [b]);
    expect(r.identities.get(f.id)).toEqual({ kind: 'code', code: 'LB-3101', origin: 'recovered' });
    expect(r.recovered[0]!.method).toBe('single_code_in_item_segment');
  });

  it('a code the model kept in its value is checked against the reference cell too: a different reference makes the row uncertain', () => {
    const t = 'LB-3101 Digital pH meter to ISO-17034 6 each';
    const b = mk(t, [{ start: 0, end: 7, x0: 50, x1: 90 }, { start: 8, end: 37, x0: 115, x1: 250 }, { start: 38, end: t.length, x0: 300, x1: 330 }]);
    const f = itemFact(b, 'Digital pH meter to ISO-17034', 'Digital pH meter to ISO-17034');
    expect(resolveItemIdentities([f], [b]).identities.get(f.id)).toMatchObject({ kind: 'uncertain', reason: 'multiple_codes' });
    const same = itemFact(b, 'LB-3101 Digital pH meter', 'LB-3101 Digital pH meter');
    expect(resolveItemIdentities([same], [b]).identities.get(same.id)).toMatchObject({ kind: 'code', code: 'LB-3101' });
  });
});
