import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
        expect(d.blocks, `${d.id} blocks`).toEqual(JSON.parse(JSON.stringify(await loadBlocks(set.sample, doc))));
        const rec = JSON.parse(readFileSync(`${SAMPLES_DIR}../${d.recordedIn}`, 'utf8')) as BenchmarkResult;
        const saved = rec.samples.flatMap((s) => s.docs).find((x) => x.docId === d.id)!;
        expect(d.claims, `${d.id} claims`).toEqual(saved.claimsReturned);
      }
    });
  }
});
