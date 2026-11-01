import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isEvidenceIntact, locateExcerpt, normalizeWithMap, validateClaim, validateEvidence } from '../src';
import { block } from './helpers';

describe('evidence offsets refer to the original text', () => {
  it('maps normalised matches back to original characters (whitespace, case, dashes)', () => {
    const text = 'Pump   assembly\n  type\u2013A, rated 10 kW';
    const hit = locateExcerpt(text, 'pump assembly type-a')!;
    expect(hit.text).toBe('Pump   assembly\n  type\u2013A');
    expect(text.slice(hit.start, hit.end)).toBe(hit.text);
  });

  it('matches across line-break hyphenation and still slices the original', () => {
    const text = 'Full speci-\nfication applies.';
    const hit = locateExcerpt(text, 'full specification applies')!;
    expect(hit.text).toBe(text.slice(0, text.length - 1));
    expect(text.slice(hit.start, hit.end)).toBe(hit.text);
  });

  it('does not delete a hyphen that is not a line-break hyphen', () => {
    expect(locateExcerpt('stainless-steel pipe', 'stainless steel')).toBeNull();
    expect(locateExcerpt('stainless-steel pipe', 'stainless-steel')!.text).toBe('stainless-steel');
  });

  it('returns null when the excerpt is not in the block', () => {
    expect(locateExcerpt('abc def', 'xyz')).toBeNull();
    expect(validateEvidence(block('d', 'b', 'abc'), 'xyz')).toEqual({ ok: false, reason: 'excerpt_not_found' });
    expect(validateEvidence(undefined, 'abc')).toEqual({ ok: false, reason: 'block_missing' });
  });

  it('property: stored excerpt always equals the original slice at its offsets', () => {
    const word = fc.stringMatching(/^[A-Za-z0-9]{1,8}$/);
    const sep = fc.constantFrom(' ', '  ', '\n', ' \n ', '\t');
    fc.assert(
      fc.property(fc.array(fc.tuple(word, sep), { minLength: 2, maxLength: 12 }), fc.nat(), fc.nat(), (parts, a, b) => {
        const text = parts.map(([w, s]) => w + s).join('');
        const words = parts.map(([w]) => w);
        const i = a % words.length;
        const j = i + (b % (words.length - i));
        const excerpt = words.slice(i, j + 1).join(' ').toUpperCase(); // different spacing and case
        const hit = locateExcerpt(text, excerpt);
        expect(hit).not.toBeNull();
        expect(text.slice(hit!.start, hit!.end)).toBe(hit!.text);
        expect(normalizeWithMap(hit!.text).text).toBe(normalizeWithMap(excerpt).text);
      }),
    );
  });

  it('isEvidenceIntact detects a stored excerpt that no longer equals the source slice', () => {
    const b = block('d1', 'b1', 'Quantity: 10 units');
    const ev = validateEvidence(b, 'quantity: 10')!;
    if (!ev.ok) throw new Error('setup');
    const blocks = new Map([[b.id, b]]);
    expect(isEvidenceIntact(ev.evidence, blocks)).toBe(true);
    expect(isEvidenceIntact({ ...ev.evidence, text: 'quantity: 10' }, blocks)).toBe(false); // normalised text is not the original slice
  });

  it('validateClaim stores the original slice, not the model quote', () => {
    const b = block('d1', 'b1', 'Funding   requested: R1.6 million');
    const f = validateClaim(
      { field: 'funding', kind: 'money', blockId: 'b1', excerpt: 'funding requested: r1.6 million', value: { amount: '1600000', currency: 'ZAR' } },
      { docId: 'd1', blocks: [b] },
    );
    expect(f.status).toBe('validated');
    expect(f.evidence[0]!.text).toBe(b.text.slice(f.evidence[0]!.start, f.evidence[0]!.end));
    expect(f.evidence[0]!.text).toBe('Funding   requested: R1.6 million');
  });
});
