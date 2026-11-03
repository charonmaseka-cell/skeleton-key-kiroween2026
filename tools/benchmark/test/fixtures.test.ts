import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyClaimEdits, CLAIM_EDITS } from '../src/build-fixtures';
import type { BenchmarkResult } from '../src/run';
import { loadBlocks, loadSample, SAMPLES_DIR } from '../src/samples';

// The app fixtures must stay faithful to what they claim to be: source blocks parsed from the
// labelled sample PDFs, and the claims recorded in the named benchmark result. They hold no findings.

const SETS: { file: string; sample: string }[] = [
  { file: 'scopecheck-standard.json', sample: 'scopecheck' },
  { file: 'scopecheck-layout.json', sample: 'scopecheck-layout' },
  { file: 'packcheck-pack.json', sample: 'packcheck' },
];

describe('app fixtures', () => {
  for (const set of SETS) {
    const fixture = JSON.parse(readFileSync(`${SAMPLES_DIR}fixtures/${set.file}`, 'utf8')) as { sample: boolean; label: string; docs: { id: string; blocks: unknown[]; claims: unknown[]; recordedIn: string; profile: string }[] } & Record<string, unknown>;

    it(`${set.file} is labelled as a fictional sample and carries no saved findings`, () => {
      expect(fixture.sample).toBe(true);
      expect(fixture.label).toBe('Sample (fictional)');
      const text = JSON.stringify(fixture);
      expect(text).not.toMatch(/"findings"|"expectedFindings"|"comparisons"/);
    });

    it(`${set.file} blocks equal the parsed sample PDFs and claims equal the recorded benchmark response`, async () => {
      const sample = loadSample(set.sample);
      for (const d of fixture.docs) {
        const doc = sample.docs.find((x) => x.id === d.id)!;
        // Fixtures hold blocks as parsed by 'ingest/1' (lines of text). The current parser ('ingest/2-cells') yields the same
        // ids, text, page and bbox plus layout metadata; only that metadata is ignored here, so a change to ids, text or
        // offsets still fails this test.
        const legacy = (await loadBlocks(set.sample, doc)).map((b) => { const rest: Record<string, unknown> = { ...b }; delete rest.parser; delete rest.layout; delete rest.cells; return rest; });
        expect(d.blocks, `${d.id} blocks`).toEqual(JSON.parse(JSON.stringify(legacy)));
        const rec = JSON.parse(readFileSync(`${SAMPLES_DIR}../${d.recordedIn}`, 'utf8')) as BenchmarkResult;
        const saved = rec.samples.flatMap((s) => s.docs).find((x) => x.docId === d.id)!;
        // Recorded claims, exactly, except the documented excerpt edits (CLAIM_EDITS), which the fixture lists itself.
        expect(d.claims, `${d.id} claims`).toEqual(applyClaimEdits(String(fixture.id), d.id, saved.claimsReturned));
        expect((d as { claimEdits?: unknown }).claimEdits ?? [], `${d.id} edits listed`).toEqual((CLAIM_EDITS[String(fixture.id)] ?? []).filter((e) => e.doc === d.id).map(({ from, to, reason }) => ({ from, to, reason })));
      }
    });
  }
});

describe('documented claim edits', () => {
  it('there is exactly one, it changes only excerpts (never values), and the recording itself is unchanged', () => {
    expect(Object.entries(CLAIM_EDITS).flatMap(([f, es]) => es.map((e) => `${f}/${e.doc}: ${e.from} -> ${e.to}`))).toEqual(['packcheck-pack/budget: 28/02/2027 -> 28 February 2027']);
    const rec = JSON.parse(readFileSync(`${SAMPLES_DIR}benchmark-results/live-packcheck-budget-v2-2026-11-01T03-00-38-750Z.json`, 'utf8')) as BenchmarkResult;
    const claims = rec.samples.flatMap((s) => s.docs).find((x) => x.docId === 'budget')!.claimsReturned as { excerpt: string; value: unknown }[];
    expect(claims.some((c) => c.excerpt.includes('28/02/2027'))).toBe(true); // the historical record still quotes what the model saw
    const edited = applyClaimEdits('packcheck-pack', 'budget', claims) as { excerpt: string; value: unknown }[];
    expect(edited.map((c) => c.value)).toEqual(claims.map((c) => c.value));
  });
});
