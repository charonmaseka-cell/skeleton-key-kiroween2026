import { buildEffectiveFacts, confirmCoverage, newExtraction, runRules, validateClaims, type Block, type DocumentExtraction, type Fact } from '@skeleton-key/engine';
import { describe, expect, it } from 'vitest';
import { resolveItemIdentities } from '../../../apps/scopecheck/src/adapter/identity';
import { scopeMatches, scopeRule, type ScopeData } from '../src/checks';

// Benchmark-local ScopeCheck matching and findings, driven by the shared ScopeCheck identity
// resolver (apps/scopecheck/src/adapter/identity.ts). Resolver unit tests live beside the resolver.

const block = (docId: string, id: string, text: string): Block => ({ id, docId, kind: 'pdf-run', text, page: 1, bbox: [0, 0, 100, 10] });
const itemFact = (b: Block, excerpt: string, value: string): Fact => {
  const [f] = validateClaims([{ field: 'item', kind: 'text', blockId: b.id, excerpt, value }], { docId: b.docId, blocks: [b] });
  return f!;
};
const done = (id: string, b: Block): DocumentExtraction => confirmCoverage(newExtraction(id, [b.id], [{ id: `${id}#1`, blockIds: [b.id], status: 'ok' }]), 'user');

describe('matching with identities: two different codes sharing one description', () => {
  const rfq = [block('rfq', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 10 units'), block('rfq', 'p1-l3', 'Item CP-200 Centrifugal pump | qty 4 units')];
  const quote = [block('quote-a', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 8 units')];
  const all = [...rfq, ...quote].map((b) => itemFact(b, b.text.split(' | ')[0]!, 'Centrifugal pump'));

  it('matches only the same code: CP-100 is verified, CP-200 is not matched to the CP-100 line', () => {
    const r = resolveItemIdentities(all, [...rfq, ...quote]);
    const data: ScopeData = { rfqDocId: 'rfq', quoteDocIds: ['quote-a'], identities: r.identities };
    const matches = scopeMatches(buildEffectiveFacts(all, []), data);
    expect(matches.find((m) => m.subjectId === 'CP-100')).toMatchObject({ status: 'verified' });
    expect(matches.find((m) => m.subjectId === 'CP-200')).toMatchObject({ status: 'none', candidateTargetIds: [] });
  });

  it('without the identity step the shared description collides (the original behaviour)', () => {
    const matches = scopeMatches(buildEffectiveFacts(all, []), { rfqDocId: 'rfq', quoteDocIds: ['quote-a'] });
    expect(matches.every((m) => m.subjectId === 'CENTRIFUGAL PUMP')).toBe(true);
  });
});

describe('uncertain identity never becomes a confirmed omission, even with confirmed coverage', () => {
  it('multiple possible codes on the quote line', () => {
    const rfqBlock = block('rfq', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 10 units');
    const bad = block('quote-a', 'p1-l2', 'Item CP-100 / CP-101 Centrifugal pump | qty 8 units');
    const facts = [itemFact(rfqBlock, 'Item CP-100 Centrifugal pump', 'Centrifugal pump'), itemFact(bad, 'Item CP-100 / CP-101 Centrifugal pump', 'Centrifugal pump')];
    const r = resolveItemIdentities(facts, [rfqBlock, bad]);
    const data: ScopeData = { rfqDocId: 'rfq', quoteDocIds: ['quote-a'], identities: r.identities };
    const effective = buildEffectiveFacts(facts, []);
    const out = runRules([scopeRule], { facts: effective, documents: new Map([['rfq', done('rfq', rfqBlock)], ['quote-a', done('quote-a', bad)]]), matches: scopeMatches(effective, data), data });
    expect(out.find((f) => f.code === 'item.absent')).toMatchObject({ subjectId: 'CP-100', state: 'needs_review', reason: 'match_unresolved' });
    expect(out.find((f) => f.code === 'item.identity_uncertain')).toMatchObject({ state: 'needs_review', reason: 'multiple_codes' });
    expect(out.some((f) => f.state === 'confirmed' && f.severity === 'critical')).toBe(false);
  });

  it('a competing code on a free-text line without pipe delimiters', () => {
    const rfqBlock = block('rfq', 'p1-l4', 'Item PG-6 Pressure gauge | qty 20 units | 0-10 bar range');
    const q = block('quote-c', 'p1-l4', 'Pressure gauge PG-6, 20 units, certified to SANS-1200, R 450 each.');
    const facts = [itemFact(rfqBlock, 'Item PG-6 Pressure gauge', 'Pressure gauge'), itemFact(q, 'Pressure gauge PG-6', 'Pressure gauge')];
    const r = resolveItemIdentities(facts, [rfqBlock, q]);
    const data: ScopeData = { rfqDocId: 'rfq', quoteDocIds: ['quote-c'], identities: r.identities };
    const effective = buildEffectiveFacts(facts, []);
    const out = runRules([scopeRule], { facts: effective, documents: new Map([['rfq', done('rfq', rfqBlock)], ['quote-c', done('quote-c', q)]]), matches: scopeMatches(effective, data), data });
    expect(out.find((f) => f.code === 'item.absent')).toMatchObject({ state: 'needs_review', reason: 'match_unresolved' });
    expect(out.find((f) => f.code === 'item.identity_uncertain')).toMatchObject({ state: 'needs_review' });
    expect(out.some((f) => f.state === 'confirmed' && f.severity === 'critical')).toBe(false);
  });
});

describe('a genuinely absent code', () => {
  it('a description-only item is never confirmed absent against a coded line, even with confirmed coverage', () => {
    const rb = block('rfq', 'p1-l2', 'Item Centrifugal pump | qty 10 units');
    const qb = block('quote-a', 'p1-l2', 'Item CP-100 Centrifugal pump | qty 8 units');
    const facts = [itemFact(rb, 'Item Centrifugal pump', 'Centrifugal pump'), itemFact(qb, 'Item CP-100 Centrifugal pump', 'CP-100 Centrifugal pump')];
    const r = resolveItemIdentities(facts, [rb, qb]);
    const data: ScopeData = { rfqDocId: 'rfq', quoteDocIds: ['quote-a'], identities: r.identities };
    const effective = buildEffectiveFacts(facts, []);
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
