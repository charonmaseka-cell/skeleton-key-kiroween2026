import { isEvidenceIntact, validateClaims, type Block, type Fact } from '@skeleton-key/engine';
import { describe, expect, it } from 'vitest';
import { descriptionOverlap, resolveItemIdentities } from './identity';

// The item-identity resolver, tested on its own with small hand-made documents (no model calls).
// A code the model left out of an item value is recovered from the original source only when the
// source ties it unambiguously to that item. Uncertain identity is never guessed.

const block = (docId: string, id: string, text: string): Block => ({ id, docId, kind: 'pdf-run', text, page: 1, bbox: [0, 0, 100, 10] });
const itemFact = (b: Block, excerpt: string, value: string): Fact => {
  const [f] = validateClaims([{ field: 'item', kind: 'text', blockId: b.id, excerpt, value }], { docId: b.docId, blocks: [b] });
  return f!;
};
const snapshot = (f: Fact[]) => JSON.stringify(f);

describe('a code omitted from the value but present in the source', () => {
  const b = block('rfq', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 10 units | 316 stainless steel casing');
  const fact = itemFact(b, 'Item CP-100 Centrifugal pump', 'Centrifugal pump');

  it('is recovered, with its own validated source span, and the fact is not changed', () => {
    expect(fact.status).toBe('validated');
    const before = snapshot([fact]);
    const r = resolveItemIdentities([fact], [b]);
    expect(r.identities.get(fact.id)).toEqual({ kind: 'code', code: 'CP-100', origin: 'recovered' });
    expect(r.recovered).toHaveLength(1);
    const rec = r.recovered[0]!;
    expect(rec).toMatchObject({ factId: fact.id, docId: 'rfq', code: 'CP-100', description: 'Centrifugal pump' });
    expect(rec.codeSpan.text).toBe('CP-100');
    expect(b.text.slice(rec.codeSpan.start, rec.codeSpan.end)).toBe('CP-100');
    expect(isEvidenceIntact(rec.codeSpan, new Map([[b.id, b]]))).toBe(true);
    expect(rec.itemEvidence).toEqual(fact.evidence[0]); // the model's own span is untouched
    expect(snapshot([fact])).toBe(before); // the fact (and so its extraction score) is not edited
    expect(fact.value).toBe('Centrifugal pump');
  });

  it('is not needed when the model already kept the code', () => {
    const kept = itemFact(b, 'Item CP-100 Centrifugal pump', 'CP-100 Centrifugal pump');
    const r = resolveItemIdentities([kept], [b]);
    expect(r.identities.get(kept.id)).toEqual({ kind: 'code', code: 'CP-100', origin: 'model_value' });
    expect(r.recovered).toHaveLength(0);
  });
});

describe('layouts without literal pipe delimiters', () => {
  it('a free-text sentence line: the single code is tied to the item by the whole line', () => {
    const b = block('quote-c', 'p1-l2', 'We offer 10 units of Centrifugal pump CP-100 with a cast iron casing at R 11 500 each.');
    const f = itemFact(b, 'Centrifugal pump CP-100', 'Centrifugal pump');
    const r = resolveItemIdentities([f], [b]);
    expect(r.identities.get(f.id)).toEqual({ kind: 'code', code: 'CP-100', origin: 'recovered' });
    expect(r.recovered[0]!.codeSpan.text).toBe('CP-100');
    expect(b.text.slice(r.recovered[0]!.codeSpan.start, r.recovered[0]!.codeSpan.end)).toBe('CP-100');
  });

  it('the code after the description, separated by a comma', () => {
    const b = block('quote-c', 'p1-l3', 'Motor starter MS-20, quantity 6 units, IP55 enclosure, R 3 150 each.');
    const f = itemFact(b, 'Motor starter MS-20', 'Motor starter');
    expect(resolveItemIdentities([f], [b]).identities.get(f.id)).toEqual({ kind: 'code', code: 'MS-20', origin: 'recovered' });
  });

  it('semicolons and tabs also separate columns, so a code in another column is not tied to the item', () => {
    const semi = block('d', 'b1', 'Item Centrifugal pump; qty 5; complies with ISO-9001');
    const tab = block('d', 'b2', 'Item Centrifugal pump\tqty 5\tcomplies with ISO-9001');
    for (const b of [semi, tab]) {
      const f = itemFact(b, 'Item Centrifugal pump', 'Centrifugal pump');
      expect(resolveItemIdentities([f], [b]).identities.get(f.id)).toMatchObject({ kind: 'description' });
    }
  });

  it('a second code-like token in the same segment (a standard) makes identity uncertain, not a guess', () => {
    const b = block('quote-c', 'p1-l4', 'Pressure gauge PG-6, 20 units, 0-10 bar range, certified to SANS-1200, R 450 each.');
    const recovered = itemFact(b, 'Pressure gauge PG-6', 'Pressure gauge');
    const r = resolveItemIdentities([recovered], [b]);
    expect(r.identities.get(recovered.id)).toMatchObject({ kind: 'uncertain', reason: 'multiple_codes', candidates: ['PG-6', 'SANS-1200'] });
    expect(r.recovered).toHaveLength(0);
  });

  it('a code the model put in its own value is also checked against competing codes in the source', () => {
    const b = block('quote-c', 'p1-l4', 'Pressure gauge PG-6, 20 units, certified to SANS-1200, R 450 each.');
    const f = itemFact(b, 'Pressure gauge PG-6', 'PG-6 Pressure gauge');
    expect(f.status).toBe('validated');
    expect(resolveItemIdentities([f], [b]).identities.get(f.id)).toMatchObject({ kind: 'uncertain', reason: 'multiple_codes' });
  });

  it('a code in the value that is not in the cited span is uncertain', () => {
    const b = block('d', 'b1', 'Item CP-100 Centrifugal pump | qty 5');
    const f: Fact = { ...itemFact(b, 'Item CP-100 Centrifugal pump', 'Centrifugal pump'), value: 'XX-9 Centrifugal pump' };
    expect(resolveItemIdentities([f], [b]).identities.get(f.id)).toMatchObject({ kind: 'uncertain', reason: 'code_not_in_source' });
  });
});

describe('two different codes sharing the same item description', () => {
  it('keeps each code with its own line and span', () => {
    const blocks = [block('rfq', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 10 units'), block('rfq', 'p1-l3', 'Item CP-200 Centrifugal pump | qty 4 units'), block('quote-a', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 8 units')];
    const facts = blocks.map((b) => itemFact(b, b.text.split(' | ')[0]!, 'Centrifugal pump'));
    const r = resolveItemIdentities(facts, blocks);
    expect(r.recovered.map((x) => [x.docId, x.code]).sort()).toEqual([['quote-a', 'CP-100'], ['rfq', 'CP-100'], ['rfq', 'CP-200']]);
    expect(new Set(r.recovered.filter((x) => x.docId === 'rfq').map((x) => x.codeSpan.blockId)).size).toBe(2);
  });
});

describe('multiple possible codes in the source', () => {
  const bad = block('quote-a', 'p1-l2', 'Item CP-100 / CP-101 Centrifugal pump | qty 8 units');

  it('does not guess: identity is uncertain and nothing is recovered', () => {
    const fact = itemFact(bad, 'Item CP-100 / CP-101 Centrifugal pump', 'Centrifugal pump');
    const r = resolveItemIdentities([fact], [bad]);
    expect(r.identities.get(fact.id)).toMatchObject({ kind: 'uncertain', reason: 'multiple_codes', candidates: ['CP-100', 'CP-101'] });
    expect(r.recovered).toHaveLength(0);
  });

  it('also holds when the model itself put two codes in the value', () => {
    const two = itemFact(bad, 'Item CP-100 / CP-101 Centrifugal pump', 'CP-100 / CP-101 Centrifugal pump');
    expect(two.status).toBe('validated'); // supported by the source, so the engine accepted it
    expect(resolveItemIdentities([two], [bad]).identities.get(two.id)).toMatchObject({ kind: 'uncertain', reason: 'multiple_codes' });
  });
});

describe('a genuinely absent code', () => {
  it('is description-only: nothing is recovered, and a code in another column is ignored', () => {
    const b = block('rfq', 'p1-l2', 'Item Centrifugal pump | qty 10 units | complies with ISO-9001');
    const fact = itemFact(b, 'Item Centrifugal pump', 'Centrifugal pump');
    const r = resolveItemIdentities([fact], [b]);
    expect(r.identities.get(fact.id)).toMatchObject({ kind: 'description' });
    expect(r.recovered).toHaveLength(0);
    expect(r.counts).toMatchObject({ descriptionOnly: 1, recovered: 0, uncertain: 0 });
  });
});

describe('invalid or missing evidence', () => {
  const b = block('rfq', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 10 units');
  const good = itemFact(b, 'Item CP-100 Centrifugal pump', 'Centrifugal pump');

  it('no evidence span: uncertain, nothing recovered', () => {
    const f: Fact = { ...good, evidence: [] };
    const r = resolveItemIdentities([f], [b]);
    expect(r.identities.get(f.id)).toMatchObject({ kind: 'uncertain', reason: 'evidence_missing' });
    expect(r.recovered).toHaveLength(0);
  });

  it('a span that no longer equals the source text: uncertain', () => {
    const tampered: Fact = { ...good, evidence: [{ ...good.evidence[0]!, text: 'Item CP-999 Centrifugal pump' }] };
    expect(resolveItemIdentities([tampered], [b]).identities.get(tampered.id)).toMatchObject({ kind: 'uncertain', reason: 'evidence_invalid' });
    const shifted: Fact = { ...good, evidence: [{ ...good.evidence[0]!, start: 1, end: 5 }] };
    expect(resolveItemIdentities([shifted], [b]).identities.get(shifted.id)).toMatchObject({ kind: 'uncertain', reason: 'evidence_invalid' });
  });

  it('the cited block is not available: uncertain', () => {
    const r = resolveItemIdentities([good], []);
    expect(r.identities.get(good.id)).toMatchObject({ kind: 'uncertain', reason: 'evidence_invalid' });
    expect(r.recovered).toHaveLength(0);
  });

  it('the description is not found exactly once inside the cited span: uncertain', () => {
    const wide = block('rfq', 'p1-l5', 'Item CP-100 Centrifugal pump and Centrifugal pump spares | qty 1');
    const f = itemFact(wide, 'Item CP-100 Centrifugal pump and Centrifugal pump spares', 'Centrifugal pump');
    expect(resolveItemIdentities([f], [wide]).identities.get(f.id)).toMatchObject({ kind: 'uncertain', reason: 'description_not_located' });
  });

  it('items that are not validated are not given an identity', () => {
    const held: Fact = { ...good, status: 'needs_review', reason: 'value_not_supported' };
    expect(resolveItemIdentities([held], [b]).identities.has(held.id)).toBe(false);
  });
});

describe('blocks across documents', () => {
  it('block IDs repeat across documents; each fact is resolved against its own document', () => {
    const rb = block('rfq', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 10 units');
    const qb = block('quote-b', 'p1-l2', 'Item CP-200 Centrifugal pump | qty 10 units');
    const facts = [itemFact(rb, 'Item CP-100 Centrifugal pump', 'Centrifugal pump'), itemFact(qb, 'Item CP-200 Centrifugal pump', 'Centrifugal pump')];
    const r = resolveItemIdentities(facts, [rb, qb]);
    expect(r.recovered.map((x) => `${x.docId}:${x.code}`).sort()).toEqual(['quote-b:CP-200', 'rfq:CP-100']);
  });
});

describe('descriptionOverlap', () => {
  it('is the share of the smaller description found in the other', () => {
    expect(descriptionOverlap('Centrifugal pump', 'CP-100 Centrifugal pump')).toBe(1);
    expect(descriptionOverlap('Centrifugal pump', 'Motor starter')).toBe(0);
  });
});
