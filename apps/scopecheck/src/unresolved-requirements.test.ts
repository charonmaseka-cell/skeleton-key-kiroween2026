import { describe, expect, it } from 'vitest';
import type { Block } from '@skeleton-key/engine';
import { buildLiveFixture, emptySession, evaluateSession, type DocumentResult } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';

// Every requirement line that cannot be resolved stays visible: each aspect (quantity, specification) against each quotation is a
// Not-evaluated comparison with a reason and the input that blocks it. Nothing is dropped to make the ledger look complete.

type Claim = { field: string; blockId: string; excerpt: string; value: unknown };
const KIND: Record<string, string> = { item: 'text', quantity: 'quantity', specification: 'text' };
const blk = (docId: string, id: string, text: string): Block => ({ id, docId, kind: 'pdf-run', text, page: 1, bbox: [0, 0, 1, 1] });
const q = (n: number) => ({ value: String(n), unit: 'units' });

const RFQ = [
  'Item AB-1 Pump | qty 2 units | cast iron', // resolved
  'Item AB-2 Valve to SANS-1200 | qty 4 units | brass', // two codes in the item: identity uncertain
  'Item AB-3 Motor | qty 6 units | IE3', // item value not supported by its excerpt: held
  'Item AB-4 Tank and Item AB-5 Stand | qty 1 units | HDPE', // two item values in one line
  'Item AB-6 Gauge | qty 8 units | 0-10 bar', // no item value extracted
];
const rfqClaims = (b: Block[]): Claim[] => [
  { field: 'item', blockId: b[0]!.id, excerpt: 'Item AB-1 Pump', value: 'AB-1 Pump' },
  { field: 'quantity', blockId: b[0]!.id, excerpt: 'qty 2 units', value: q(2) },
  { field: 'specification', blockId: b[0]!.id, excerpt: 'cast iron', value: 'cast iron' },
  { field: 'item', blockId: b[1]!.id, excerpt: 'Item AB-2 Valve to SANS-1200', value: 'Valve to SANS-1200' },
  { field: 'quantity', blockId: b[1]!.id, excerpt: 'qty 4 units', value: q(4) },
  { field: 'item', blockId: b[2]!.id, excerpt: 'Item AB-3 Motor', value: 'AB-3 Generator' },
  { field: 'quantity', blockId: b[2]!.id, excerpt: 'qty 6 units', value: q(6) },
  { field: 'item', blockId: b[3]!.id, excerpt: 'Item AB-4 Tank', value: 'AB-4 Tank' },
  { field: 'item', blockId: b[3]!.id, excerpt: 'Item AB-5 Stand', value: 'AB-5 Stand' },
  { field: 'quantity', blockId: b[4]!.id, excerpt: 'qty 8 units', value: q(8) },
  { field: 'specification', blockId: b[4]!.id, excerpt: '0-10 bar', value: '0-10 bar' },
];
const quoteClaims = (b: Block[]): Claim[] => [
  { field: 'item', blockId: b[0]!.id, excerpt: 'Item AB-1 Pump', value: 'AB-1 Pump' },
  { field: 'quantity', blockId: b[0]!.id, excerpt: '2 units', value: q(2) },
  { field: 'specification', blockId: b[0]!.id, excerpt: 'cast iron', value: 'cast iron' },
];

function run() {
  const docs = [
    { id: 'rfq', role: 'rfq', lines: RFQ, claims: rfqClaims },
    { id: 'quote-1', role: 'quote', lines: ['Item AB-1 Pump | 2 units | cast iron'], claims: quoteClaims },
    { id: 'quote-2', role: 'quote', lines: ['Item AB-1 Pump | 2 units | cast iron'], claims: quoteClaims },
  ];
  const fixture = buildLiveFixture(docs.map((d) => {
    const blocks = d.lines.map((t, i) => blk(d.id, `p1-l${i + 1}`, t));
    const claims = d.claims(blocks).map((c) => ({ kind: KIND[c.field], ...c }));
    const result: DocumentResult = { docId: d.id, blocks, claims, chunks: [{ index: 0, blockIds: blocks.map((b) => b.id), status: 'ok', claims: claims.length }] };
    return { id: d.id, role: d.role, fileName: `${d.id}.pdf`, profile: d.role === 'rfq' ? 'scopecheck.rfq.v1' : 'scopecheck.quote.v1', result };
  }));
  return evaluateSession(scopeCheckAdapter, fixture, emptySession(), 1);
}

describe('unresolved requirement lines', () => {
  const v = run();
  const c = v.evaluation.comparisons;

  it('the four unresolved rows each give 2 aspects x 2 quotations = 4 Not-evaluated comparisons; the resolved row gives 4 that ran', () => {
    expect(c).toHaveLength(5 * 2 * 2);
    for (const line of ['p1-l2', 'p1-l3', 'p1-l4', 'p1-l5']) {
      const rows = c.filter((x) => x.status === 'not_evaluated' && x.blocked?.docId === 'rfq' && (x.id.includes(line) || x.blocked?.factId && v.effective.get(x.blocked.factId)?.fact.evidence[0]?.blockId === line));
      expect(rows, line).toHaveLength(4);
      expect(new Set(rows.map((x) => `${x.field}~${x.docs[1]}`))).toEqual(new Set(['quantity~quote-1', 'specification~quote-1', 'quantity~quote-2', 'specification~quote-2']));
      for (const x of rows) {
        expect(x.reason, x.id).toBeTruthy();
        expect(x.blocked, x.id).toMatchObject({ docId: 'rfq', field: 'item' });
        expect(x.blocked!.reason, x.id).toBeTruthy();
      }
    }
    expect(c.filter((x) => x.id.startsWith('quantity:AB-1~') || x.id.startsWith('specification:AB-1~')).every((x) => x.status === 'agree')).toBe(true);
  });

  it('each gives its own reason', () => {
    const reasons = new Set(c.filter((x) => x.status === 'not_evaluated').map((x) => x.blocked!.reason));
    expect(reasons).toEqual(new Set(['multiple_codes', 'value_not_in_excerpt', 'multiple_items_in_block', 'no_fact']));
  });

  it('each also appears as a Needs-review item, so the person reviewing sees it, not just the ledger', () => {
    const codes = v.items.filter((i) => i.finding.responseDocId === 'rfq').map((i) => i.finding.code).sort();
    expect(codes).toEqual(['item.identity_uncertain', 'item.missing', 'item.multiple_items', 'item.unverified']);
    expect(v.items.filter((i) => i.finding.responseDocId === 'rfq').every((i) => i.finding.state === 'needs_review')).toBe(true);
  });

  it('nothing about an unresolved row is reported as a difference or an agreement', () => {
    const unresolved = c.filter((x) => x.blocked?.docId === 'rfq');
    expect(unresolved.every((x) => x.status === 'not_evaluated')).toBe(true);
    expect(v.items.some((i) => /differs/.test(i.finding.code))).toBe(false);
  });

  it('the export lists every Not-evaluated comparison with its reason', () => {
    expect(v.exportModel.notEvaluated).toHaveLength(16);
    expect(v.exportModel.notEvaluated.every((n) => !!n.reason)).toBe(true);
  });
});
