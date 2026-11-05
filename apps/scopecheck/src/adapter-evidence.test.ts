import { describe, expect, it } from 'vitest';
import type { Block } from '@skeleton-key/engine';
import { buildLiveFixture, emptySession, evaluateSession, type DocumentResult } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';

// Adapter-level tests with real evidence: the claims cite excerpts copied from the block text, the engine validates them, and the
// ScopeCheck rules run on the result. No model; no labels.

type Claim = { field: string; kind?: string; blockId: string; excerpt: string; value: unknown };
const blk = (docId: string, id: string, text: string): Block => ({ id, docId, kind: 'pdf-run', text, page: 1, bbox: [0, 0, 1, 1] });
const q = (n: number, unit = 'units') => ({ value: String(n), unit });

function run(docs: { id: string; role: 'rfq' | 'quote'; lines: string[]; claims: (blocks: Block[]) => Claim[] }[]) {
  const fixture = buildLiveFixture(docs.map((d) => {
    const blocks = d.lines.map((t, i) => blk(d.id, `p1-l${i + 1}`, t));
    const KIND: Record<string, string> = { item: 'text', quantity: 'quantity', specification: 'text', unit_price: 'money', exclusion: 'text' };
    const claims = d.claims(blocks).map((c) => ({ kind: KIND[c.field] ?? 'text', ...c })); // the Worker attaches the field kind
    for (const c of claims) if (!blocks.find((b) => b.id === c.blockId)!.text.includes(c.excerpt)) throw new Error(`test claim excerpt not in its block: ${c.excerpt}`);
    const result: DocumentResult = { docId: d.id, blocks, claims, chunks: [{ index: 0, blockIds: blocks.map((b) => b.id), status: 'ok', claims: claims.length }] };
    return { id: d.id, role: d.role, fileName: `${d.id}.pdf`, profile: d.role === 'rfq' ? 'scopecheck.rfq.v1' : 'scopecheck.quote.v1', result };
  }));
  return evaluateSession(scopeCheckAdapter, fixture, emptySession(), 1);
}
type View = ReturnType<typeof run>;
const cmp = (v: View, id: string) => v.evaluation.comparisons.find((c) => c.id === id);
const finding = (v: View, code: string, subject: string) => v.items.find((i) => i.finding.code === code && i.finding.subjectId === subject)?.finding;

/** one RFQ row and one quotation row; the quotation specification is cited as written, connector included */
function pair(rfqSpec: string, quoteLine: string, quoteSpecExcerpt: string) {
  return run([
    { id: 'rfq', role: 'rfq', lines: [`Item AB-1 Pump | qty 2 units | ${rfqSpec}`], claims: ([b]) => [
      { field: 'item', blockId: b!.id, excerpt: 'Item AB-1 Pump', value: 'AB-1 Pump' },
      { field: 'quantity', blockId: b!.id, excerpt: 'qty 2 units', value: q(2) },
      { field: 'specification', blockId: b!.id, excerpt: rfqSpec, value: rfqSpec },
    ] },
    { id: 'quote-1', role: 'quote', lines: [quoteLine], claims: ([b]) => [
      { field: 'item', blockId: b!.id, excerpt: 'AB-1 Pump', value: 'AB-1 Pump' },
      { field: 'quantity', blockId: b!.id, excerpt: '2 units', value: q(2) },
      { field: 'specification', blockId: b!.id, excerpt: quoteSpecExcerpt, value: quoteSpecExcerpt },
    ] },
  ]);
}

describe('connectors that stay inside the cited excerpt', () => {
  it.each([
    ['c/w in a table cell', 'Item AB-1 Pump | qty 2 units | c/w 316 stainless steel casing', 'c/w 316 stainless steel casing', 'c/w'],
    ['with in prose', 'We offer 2 units of AB-1 Pump with 316 stainless steel casing at R 10 each.', 'with 316 stainless steel casing', 'with'],
    ['complete with', 'AB-1 Pump, 2 units, complete with 316 stainless steel casing', 'complete with 316 stainless steel casing', 'complete with'],
    ['incl.', 'AB-1 Pump, 2 units, incl. 316 stainless steel casing', 'incl. 316 stainless steel casing', 'incl.'],
  ])('%s: the evidence keeps the connector, the comparison agrees, and says why', (_n, line, excerpt, connector) => {
    const v = pair('316 stainless steel casing', line, excerpt);
    const quoteSpec = [...v.effective.values()].find((e) => e.fact.docId === 'quote-1' && e.fact.field === 'specification')!;
    expect(quoteSpec.fact.status, quoteSpec.fact.reason).toBe('validated');
    expect(quoteSpec.fact.evidence[0]!.text).toBe(excerpt); // the connector is in the evidence, unchanged
    expect(quoteSpec.fact.evidence[0]!.text.startsWith(connector)).toBe(true);
    const c = cmp(v, 'specification:AB-1~quote-1')!;
    expect(c.status).toBe('agree');
    expect(c.detail).toContain(`leading "${connector.toLowerCase()}" not counted as a difference`);
    expect(finding(v, 'spec.differs', 'AB-1:specification')).toBeUndefined();
  });

  it.each([
    ['grade', 'Item AB-1 Pump | qty 2 units | c/w 304 stainless steel casing', 'c/w 304 stainless steel casing'],
    ['negation', 'We offer 2 units of AB-1 Pump without 316 stainless steel casing at R 10 each.', 'without 316 stainless steel casing'],
    ['a dropped qualifier', 'We offer 2 units of AB-1 Pump with stainless steel casing at R 10 each.', 'with stainless steel casing'],
  ])('a genuine difference with a connector in the excerpt is still a confirmed difference, with its evidence: %s', (_n, line, excerpt) => {
    const v = pair('316 stainless steel casing', line, excerpt);
    const f = finding(v, 'spec.differs', 'AB-1:specification')!;
    expect(f).toMatchObject({ severity: 'critical', state: 'confirmed' });
    expect(f.evidence.map((e) => e.evidence.text)).toContain(excerpt);
    expect(cmp(v, 'specification:AB-1~quote-1')!.status).toBe('flagged');
  });

  it('a connector in the requirement as well as the quotation is ignored on both sides', () => {
    const v = run([
      { id: 'rfq', role: 'rfq', lines: ['Item AB-1 Pump | qty 2 units | complete with DOL starter'], claims: ([b]) => [
        { field: 'item', blockId: b!.id, excerpt: 'Item AB-1 Pump', value: 'AB-1 Pump' },
        { field: 'quantity', blockId: b!.id, excerpt: 'qty 2 units', value: q(2) },
        { field: 'specification', blockId: b!.id, excerpt: 'complete with DOL starter', value: 'complete with DOL starter' },
      ] },
      { id: 'quote-1', role: 'quote', lines: ['Item AB-1 Pump | 2 units | c/w DOL starter'], claims: ([b]) => [
        { field: 'item', blockId: b!.id, excerpt: 'Item AB-1 Pump', value: 'AB-1 Pump' },
        { field: 'quantity', blockId: b!.id, excerpt: '2 units', value: q(2) },
        { field: 'specification', blockId: b!.id, excerpt: 'c/w DOL starter', value: 'c/w DOL starter' },
      ] },
    ]);
    expect(cmp(v, 'specification:AB-1~quote-1')!.status).toBe('agree');
  });
});
