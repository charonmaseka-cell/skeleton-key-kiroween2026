import { buildEffectiveFacts, confirmCoverage, isEvidenceIntact, newExtraction, runRules, validateClaims, type Block, type Fact, type DocumentExtraction } from '@skeleton-key/engine';
import { describe, expect, it } from 'vitest';
import { scopeMatches, scopeRule, type ScopeData } from '../src/checks';
import { resolveItemIdentities } from '../src/scope-identity';

// ScopeCheck item identity: a code the model left out of an item value is recovered from the
// original source only when the source ties it unambiguously to that item. Uncertain identity
// stays Needs review. These tests use small hand-made documents; they do not call any model.

const block = (docId: string, id: string, text: string): Block => ({ id, docId, kind: 'pdf-run', text, page: 1, bbox: [0, 0, 100, 10] });
const itemFact = (b: Block, excerpt: string, value: string): Fact => {
  const [f] = validateClaims([{ field: 'item', kind: 'text', blockId: b.id, excerpt, value }], { docId: b.docId, blocks: [b] });
  return f!;
};
const snapshot = (f: Fact[]) => JSON.stringify(f);
const asDocs = (blocks: Block[]) => new Map<string, Block[]>(blocks.map((b) => [b.docId, blocks.filter((x) => x.docId === b.docId)]));

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

describe('two different codes sharing the same item description', () => {
  const rfq = [block('rfq', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 10 units'), block('rfq', 'p1-l3', 'Item CP-200 Centrifugal pump | qty 4 units')];
  const quote = [block('quote-a', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 8 units')];
  const rfqFacts = rfq.map((b) => itemFact(b, b.text.split(' | ')[0]!, 'Centrifugal pump'));
  const quoteFacts = quote.map((b) => itemFact(b, b.text.split(' | ')[0]!, 'Centrifugal pump'));
  const all = [...rfqFacts, ...quoteFacts];

  it('keeps each code with its own line and span', () => {
    const r = resolveItemIdentities(all, [...rfq, ...quote]);
    expect(r.recovered.map((x) => [x.docId, x.code]).sort()).toEqual([['quote-a', 'CP-100'], ['rfq', 'CP-100'], ['rfq', 'CP-200']]);
    const spans = r.recovered.filter((x) => x.docId === 'rfq').map((x) => x.codeSpan.blockId);
    expect(new Set(spans).size).toBe(2);
  });

  it('matches only the same code: CP-100 is verified, CP-200 is not matched to the CP-100 line', () => {
    const r = resolveItemIdentities(all, [...rfq, ...quote]);
    const data: ScopeData = { rfqDocId: 'rfq', quoteDocIds: ['quote-a'], identities: r.identities };
    const matches = scopeMatches(buildEffectiveFacts(all, []), data);
    expect(matches.find((m) => m.subjectId === 'CP-100')).toMatchObject({ status: 'verified' });
    expect(matches.find((m) => m.subjectId === 'CP-200')).toMatchObject({ status: 'none', candidateTargetIds: [] });
  });

  it('without the identity step the shared description collides (the original behaviour)', () => {
    const data: ScopeData = { rfqDocId: 'rfq', quoteDocIds: ['quote-a'] };
    const matches = scopeMatches(buildEffectiveFacts(all, []), data);
    expect(matches.every((m) => m.subjectId === 'CENTRIFUGAL PUMP')).toBe(true);
  });
});

describe('multiple possible codes in the source', () => {
  const bad = block('quote-a', 'p1-l2', 'Item CP-100 / CP-101 Centrifugal pump | qty 8 units');
  const fact = itemFact(bad, 'Item CP-100 / CP-101 Centrifugal pump', 'Centrifugal pump');

  it('does not guess: identity is uncertain and nothing is recovered', () => {
    const r = resolveItemIdentities([fact], [bad]);
    expect(r.identities.get(fact.id)).toMatchObject({ kind: 'uncertain', reason: 'multiple_codes', candidates: ['CP-100', 'CP-101'] });
    expect(r.recovered).toHaveLength(0);
  });

  it('also holds when the model itself put two codes in the value', () => {
    const two = itemFact(bad, 'Item CP-100 / CP-101 Centrifugal pump', 'CP-100 / CP-101 Centrifugal pump');
    expect(two.status).toBe('validated'); // the value is supported by the source, so the engine accepted it
    expect(resolveItemIdentities([two], [bad]).identities.get(two.id)).toMatchObject({ kind: 'uncertain', reason: 'multiple_codes' });
  });

  it('stays Needs review even when coverage is confirmed: never a confirmed omission', () => {
    const rfqBlock = block('rfq', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 10 units');
    const rfqFact = itemFact(rfqBlock, 'Item CP-100 Centrifugal pump', 'Centrifugal pump');
    const facts = [rfqFact, fact];
    const r = resolveItemIdentities(facts, [rfqBlock, bad]);
    const data: ScopeData = { rfqDocId: 'rfq', quoteDocIds: ['quote-a'], identities: r.identities };
    const effective = buildEffectiveFacts(facts, []);
    const confirmed = (id: string, b: Block): DocumentExtraction => confirmCoverage(newExtraction(id, [b.id], [{ id: `${id}#1`, blockIds: [b.id], status: 'ok' }]), 'user');
    const documents = new Map([['rfq', confirmed('rfq', rfqBlock)], ['quote-a', confirmed('quote-a', bad)]]);
    const out = runRules([scopeRule], { facts: effective, documents, matches: scopeMatches(effective, data), data });
    const absent = out.find((f) => f.code === 'item.absent')!;
    expect(absent).toMatchObject({ subjectId: 'CP-100', state: 'needs_review', reason: 'match_unresolved' });
    expect(out.find((f) => f.code === 'item.identity_uncertain')).toMatchObject({ state: 'needs_review', reason: 'multiple_codes' });
    expect(out.some((f) => f.state === 'confirmed' && f.severity === 'critical')).toBe(false);
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

  it('a description-only item is never confirmed absent against a coded line, even with confirmed coverage', () => {
    const rb = block('rfq', 'p1-l2', 'Item Centrifugal pump | qty 10 units');
    const qb = block('quote-a', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 8 units');
    const facts = [itemFact(rb, 'Item Centrifugal pump', 'Centrifugal pump'), itemFact(qb, 'Item CP-100 Centrifugal pump', 'CP-100 Centrifugal pump')];
    const r = resolveItemIdentities(facts, [rb, qb]);
    const data: ScopeData = { rfqDocId: 'rfq', quoteDocIds: ['quote-a'], identities: r.identities };
    const effective = buildEffectiveFacts(facts, []);
    const done = (id: string, b: Block) => confirmCoverage(newExtraction(id, [b.id], [{ id: `${id}#1`, blockIds: [b.id], status: 'ok' }]), 'user');
    const out = runRules([scopeRule], { facts: effective, documents: new Map([['rfq', done('rfq', rb)], ['quote-a', done('quote-a', qb)]]), matches: scopeMatches(effective, data), data });
    expect(out.find((f) => f.code === 'item.absent')).toMatchObject({ state: 'needs_review', reason: 'match_unresolved' });
  });

  it('two description-only items with the same description still match each other by key', () => {
    const rb = block('rfq', 'p1-l2', 'Item Centrifugal pump | qty 10 units');
    const qb = block('quote-a', 'p1-l2', 'Item Centrifugal pump | qty 8 units');
    const facts = [itemFact(rb, 'Item Centrifugal pump', 'Centrifugal pump'), itemFact(qb, 'Item Centrifugal pump', 'Centrifugal pump')];
    const r = resolveItemIdentities(facts, [rb, qb]);
    const m = scopeMatches(buildEffectiveFacts(facts, []), { rfqDocId: 'rfq', quoteDocIds: ['quote-a'], identities: r.identities });
    expect(m[0]).toMatchObject({ status: 'verified' });
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
    const r = resolveItemIdentities(facts, [...asDocs([rb, qb]).values()].flat());
    expect(r.recovered.map((x) => `${x.docId}:${x.code}`).sort()).toEqual(['quote-b:CP-200', 'rfq:CP-100']);
  });
});

