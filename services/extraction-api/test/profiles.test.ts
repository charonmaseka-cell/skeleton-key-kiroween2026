import { createHash } from 'node:crypto';
import { validateClaims, type Block } from '@skeleton-key/engine';
import { describe, expect, it } from 'vitest';
import { buildMessages, PROFILES } from '../src/profiles';

// Profiles are versioned so earlier benchmark results stay reproducible: a published version is
// frozen, and a behaviour change is a new version.

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const blocks = [{ id: 'b1', text: 'Funding requested: R1.6 million' }];
const sys = (id: string) => buildMessages(PROFILES[id]!, blocks, false)[0]!.content.split('\n');

describe('profile versions', () => {
  it('packcheck.grant.v1 is frozen (it produced the recorded benchmark results)', () => {
    expect(sha(PROFILES['packcheck.grant.v1'])).toBe('9c9bf7c046d4f9c34e46e6d4cbcc86a6bce3e405807dec05584c4a1292ba0915');
  });

  it('v2 differs from v1 only in the two money field descriptions', () => {
    const v1 = PROFILES['packcheck.grant.v1']!;
    const v2 = PROFILES['packcheck.grant.v2']!;
    expect(v2.id).toBe('packcheck.grant.v2');
    expect({ ...v2, id: v1.id, fields: [] }).toEqual({ ...v1, fields: [] }); // same model, token cap, purpose
    expect(v2.fields.map((f) => [f.name, f.kind])).toEqual(v1.fields.map((f) => [f.name, f.kind]));
    const changed = v2.fields.filter((f, i) => f.description !== v1.fields[i]!.description).map((f) => f.name);
    expect(changed).toEqual(['funding_requested', 'total_project_budget']);
    for (const name of changed) {
      const d = v2.fields.find((f) => f.name === name)!.description;
      expect(d).toContain('"R1.6 million" means amount "1600000" with currency "ZAR"');
      expect(d).toContain('copied exactly as written');
    }
  });

  it('the prompt differs from v1 only on the two money field lines', () => {
    const a = sys('packcheck.grant.v1');
    const b = sys('packcheck.grant.v2');
    expect(b).toHaveLength(a.length);
    const differing = b.map((line, i) => (line !== a[i] ? line.split(' ')[1] : null)).filter(Boolean);
    expect(differing).toEqual(['funding_requested', 'total_project_budget']);
  });

  it('the other profiles are untouched by the new version', () => {
    expect(Object.keys(PROFILES).sort()).toEqual(['packcheck.grant.v1', 'packcheck.grant.v2', 'scopecheck.quote.v1', 'scopecheck.rfq.v1']);
  });
});

describe('validation is unchanged by the profile: magnitude is checked against the excerpt', () => {
  const block: Block = { id: 'b1', docId: 'application-form', kind: 'pdf-run', text: 'Funding requested: R1.6 million', page: 1, bbox: [0, 0, 1, 1] };
  const claim = (amount: string) => ({ field: 'funding_requested', kind: 'money', blockId: 'b1', excerpt: 'Funding requested: R1.6 million', value: { amount, currency: 'ZAR' } });
  const hints = { funding_requested: ['funding requested'] };

  it('"R1.6 million" validates as 1600000 ZAR and the excerpt is preserved', () => {
    const [f] = validateClaims([claim('1600000')], { docId: 'application-form', blocks: [block], hintsByField: hints });
    expect(f).toMatchObject({ status: 'validated', value: { amount: '1600000', currency: 'ZAR' } });
    expect(f!.evidence[0]!.text).toBe('Funding requested: R1.6 million');
  });

  it('the v1-style reading (1.6) is still held, not accepted', () => {
    const [f] = validateClaims([claim('1.6')], { docId: 'application-form', blocks: [block], hintsByField: hints });
    expect(f).toMatchObject({ status: 'needs_review', reason: 'value_not_in_excerpt' });
  });
});
