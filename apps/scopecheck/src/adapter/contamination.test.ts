import { describe, expect, it } from 'vitest';
import { validateClaims, type Block, type EffectiveFact, type Fact } from '@skeleton-key/engine';
import { resolveItemIdentities } from './identity';
import { specContamination } from './rules';

// A contaminated specification field carries the identifier of its own row. Hand-made lines, no model, no labels.

const blk = (docId: string, id: string, text: string): Block => ({ id, docId, kind: 'pdf-run', text, page: 1, bbox: [0, 0, 1, 1] });
const eff = (f: Fact): EffectiveFact => ({ fact: f, value: f.value, provenance: 'document', usable: f.status === 'validated' }) as unknown as EffectiveFact;
function line(text: string, itemExcerpt: string, itemValue: string, specExcerpt: string, specValue: string) {
  const b = blk('quote', 'p1-l1', text);
  const [item, spec] = validateClaims([
    { field: 'item', kind: 'text', blockId: b.id, excerpt: itemExcerpt, value: itemValue },
    { field: 'specification', kind: 'text', blockId: b.id, excerpt: specExcerpt, value: specValue },
  ], { docId: 'quote', blocks: [b] }) as [Fact, Fact];
  const ids = resolveItemIdentities([item, spec].filter((f) => f.field === 'item'), [b]).identities;
  return { item: eff(item), spec: eff(spec), ids };
}

describe('contaminated specification fields', () => {
  it('a specification that includes the row\'s own item code is contaminated', () => {
    const t = 'We offer 5 units of Flow meter DN50 SN-403 with electromagnetic, IP68 at R 14 800 each.';
    const { item, spec, ids } = line(t, 'Flow meter DN50 SN-403', 'Flow meter DN50 SN-403', 'DN50 SN-403 with electromagnetic, IP68', 'DN50 SN-403 with electromagnetic, IP68');
    expect(specContamination(spec, item, ids)).toBe('item_code_in_specification');
  });

  it('it is detected from the code in the value or recovered from the source, and is case-insensitive', () => {
    const t = 'Item sn-403 Flow meter | qty 5 units | electromagnetic, SN-403, IP68';
    const { item, spec, ids } = line(t, 'Item sn-403 Flow meter', 'Flow meter', 'electromagnetic, SN-403, IP68', 'electromagnetic, SN-403, IP68');
    expect(ids.get(item.fact.id)).toMatchObject({ kind: 'code', code: 'SN-403' });
    expect(specContamination(spec, item, ids)).toBe('item_code_in_specification');
  });

  it.each([
    ['a clean specification', 'electromagnetic, IP68'],
    ['a standard (another code-like token)', 'electromagnetic, IP68, to SANS-1200'],
    ['a different item\'s code the spec refers to', 'electromagnetic, IP68, same as CP-101'],
    ['a longer number that only starts like the code', 'electromagnetic, SN-4031'],
    ['the item words repeated without the code', 'Flow meter electromagnetic IP68'],
  ])('is not contamination: %s', (_n, specValue) => {
    const t = `Item SN-403 Flow meter | qty 5 units | ${specValue}`;
    const { item, spec, ids } = line(t, 'Item SN-403 Flow meter', 'Flow meter', specValue, specValue);
    expect(specContamination(spec, item, ids)).toBeNull();
  });

  it('nothing is concluded without a resolved code (description-only or uncertain identity)', () => {
    const t = 'Item Flow meter | qty 5 units | electromagnetic SN-403';
    const { item, spec, ids } = line(t, 'Item Flow meter', 'Flow meter', 'electromagnetic SN-403', 'electromagnetic SN-403');
    expect(specContamination(spec, item, ids)).toBeNull();
  });

  it('a value the user typed is trusted as typed', () => {
    const t = 'Item SN-403 Flow meter | qty 5 units | electromagnetic SN-403';
    const { item, spec, ids } = line(t, 'Item SN-403 Flow meter', 'Flow meter', 'electromagnetic SN-403', 'electromagnetic SN-403');
    expect(specContamination({ ...spec, provenance: 'user_supplied' } as EffectiveFact, item, ids)).toBeNull();
  });
});
