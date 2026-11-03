import { describe, expect, it } from 'vitest';
import { emptySession, evaluateSession, type Fixture } from '@skeleton-key/ui';
import { scoreFindings } from '../../../tools/benchmark/src/score';
import { loadSample } from '../../../tools/benchmark/src/samples';
import full from '../../../samples/fixtures/scopecheck-full.json';
import { scopeCheckAdapter, type ScopeContext } from './adapter';
import { FIXTURES } from './fixtures';

// The full-length sample (default): recorded 70B output of the SC-T12 fresh set, run through the app exactly as a user sees it.
// The app must reproduce the pre-registered result (12 of 12, no false critical, no over-confident finding).

const fx = full as unknown as Fixture;
const v = evaluateSession(scopeCheckAdapter, fx, emptySession(), 1);
const sample = loadSample('scopecheck-fresh');

describe('full-length sample', () => {
  it('is the default, clearly labelled recorded output; the small set stays as a second option', () => {
    expect(FIXTURES.map((f) => f.id)).toEqual(['scopecheck-full', 'scopecheck-standard', 'scopecheck-layout']);
    expect(fx.sample).toBe(true);
    expect(fx.label).toBe('Sample (fictional)');
    expect(fx.extraction.note).toMatch(/recorded output of @cf\/meta\/llama-3\.3-70b-instruct-fp8-fast/);
    expect(fx.extraction.note).toMatch(/No document is uploaded and no model is called/);
    expect(fx.docs.map((d) => d.recordedIn)).toEqual(Array(3).fill(expect.stringMatching(/^samples\/benchmark-results\/live-sc-t12-fresh-resume2-/)));
    for (const d of fx.docs) expect(d.chunks!.length).toBe(4);
  });

  it('reproduces the pre-registered findings: 12 of 12, no false critical, no over-confident', () => {
    const exclusionBlocks: Record<string, Set<string>> = {};
    for (const doc of sample.docs) {
      const lines = new Set(doc.facts.filter((f) => f.field === 'exclusion').map((f) => doc.lines[f.line]));
      exclusionBlocks[doc.id] = new Set(fx.docs.find((d) => d.id === doc.id)!.blocks.filter((b) => lines.has(b.text)).map((b) => b.id));
    }
    const s = scoreFindings(v.evaluation.findings, sample.expectedFindings!, { coverageConfirmed: false, exclusionBlocks });
    expect(s.expected).toBe(12);
    expect(s.matchedExactState).toBe(12);
    expect(s.missed).toEqual([]);
    expect(s.falseCritical).toEqual([]);
    expect(s.overConfident).toEqual([]);
  });

  it('every document was processed in full; coverage stays unverified until a person confirms it', () => {
    for (const d of v.documents.values()) expect(d.coverage.state).toBe('unverified');
  });

  it('totals as quoted: quotation B is complete; quotation A is incomplete because of its held and missed prices', () => {
    const t = (v.evaluation.context as ScopeContext).totals;
    expect(t['quote-b']).toMatchObject({ complete: true, excluded: 0, total: { currency: 'ZAR' } });
    expect(t['quote-a']!.complete).toBe(false);
    expect(t['quote-a']!.excluded).toBeGreaterThan(0);
    expect(t['quote-a']!.reason).toBe('lines_excluded');
  });
});
