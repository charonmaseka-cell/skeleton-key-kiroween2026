import { describe, expect, it } from 'vitest';
import { emptySession, evaluateSession } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

// Sample mode: the extraction is CACHED in the fixture (source blocks and recorded claims); the checks are EXECUTED afresh on
// every evaluation. The bundled fictional samples are the labelled default.

describe('bundled samples', () => {
  it('are the default and are all labelled as samples', () => {
    expect(FIXTURES.length).toBeGreaterThan(0);
    expect(FIXTURES.every((f) => f.sample && f.label)).toBe(true);
    expect(FIXTURES[0]!.sample).toBe(true);
  });

  it('cache extraction only: a fixture holds blocks and claims, never findings or comparisons', () => {
    for (const f of FIXTURES) {
      const text = JSON.stringify(f);
      expect(text).not.toMatch(/"findings"|"comparisons"|"state":"confirmed"/);
      expect(f.docs.every((d) => d.blocks.length > 0 && d.claims.length > 0)).toBe(true);
    }
  });

  it('run the rules afresh each time: a new result object per evaluation, and a changed cached claim changes the findings', () => {
    const fx = FIXTURES.find((f) => f.id === 'scopecheck-standard')!;
    const a = evaluateSession(scopeCheckAdapter, fx, emptySession(), 1);
    const b = evaluateSession(scopeCheckAdapter, fx, emptySession(), 1);
    expect(b).not.toBe(a);
    expect(b.items.map((i) => i.finding.fingerprint)).toEqual(a.items.map((i) => i.finding.fingerprint));
    // change one cached quantity claim in a copy: the findings must follow it
    const copy = JSON.parse(JSON.stringify(fx)) as typeof fx;
    const quote = copy.docs.find((d) => d.role === 'quote')!;
    const q = (quote.claims as { field: string; value: { value: string } }[]).find((c) => c.field === 'quantity')!;
    q.value = { ...q.value, value: '9999' };
    const c = evaluateSession(scopeCheckAdapter, copy, emptySession(), 1);
    expect(c.items.map((i) => i.finding.fingerprint)).not.toEqual(a.items.map((i) => i.finding.fingerprint));
  });
});
