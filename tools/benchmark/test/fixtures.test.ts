import { createHash } from 'node:crypto';
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
        // Fixtures hold blocks as parsed by 'ingest/1' (lines of text). The current parser ('ingest/2-cells') yields the same
        // ids, text, page and bbox plus layout metadata; only that metadata is ignored here, so a change to ids, text or
        // offsets still fails this test.
        const legacy = (await loadBlocks(set.sample, doc)).map((b) => { const rest: Record<string, unknown> = { ...b }; delete rest.parser; delete rest.layout; delete rest.cells; return rest; });
        expect(d.blocks, `${d.id} blocks`).toEqual(JSON.parse(JSON.stringify(legacy)));
        const rec = JSON.parse(readFileSync(`${SAMPLES_DIR}../${d.recordedIn}`, 'utf8')) as BenchmarkResult;
        const saved = rec.samples.flatMap((s) => s.docs).find((x) => x.docId === d.id)!;
        // Recorded claims, exactly: no edits of any kind.
        expect(d.claims, `${d.id} claims`).toEqual(saved.claimsReturned);
        expect(Object.keys(d), `${d.id} keys`).not.toContain('claimEdits');
      }
    });
  }
});

describe('the PackCheck budget fixture is recorded output again', () => {
  it('comes from the staging-Worker recording of the CURRENT budget.pdf, which kept its provenance and was not edited', () => {
    const fixture = JSON.parse(readFileSync(`${SAMPLES_DIR}fixtures/packcheck-pack.json`, 'utf8')) as { docs: { id: string; recordedIn: string; claims: unknown[] }[] };
    const d = fixture.docs.find((x) => x.id === 'budget')!;
    expect(d.recordedIn).toMatch(/^samples\/benchmark-results\/live-packcheck-budget-v2-staging-worker-2026-/);
    const rec = JSON.parse(readFileSync(`${SAMPLES_DIR}../${d.recordedIn}`, 'utf8')) as { kind: string; provenance: { attemptsSent: number; budgetPdfSha256: string; request: { sha256: string } }; settings: { maxRepairAttempts: number } };
    expect(rec.kind).toBe('staging-worker-recording');
    expect(rec.provenance.attemptsSent).toBe(1);
    expect(rec.settings.maxRepairAttempts).toBe(0);
    // the recording was made from the PDF in the repository now
    expect(createHash('sha256').update(readFileSync(`${SAMPLES_DIR}packcheck/budget.pdf`)).digest('hex')).toBe(rec.provenance.budgetPdfSha256);
  });

  it('the historical recording of the old text is kept unchanged and is no longer the fixture source', () => {
    const old = JSON.parse(readFileSync(`${SAMPLES_DIR}benchmark-results/live-packcheck-budget-v2-2026-11-01T03-00-38-750Z.json`, 'utf8')) as BenchmarkResult;
    const claims = old.samples.flatMap((s) => s.docs).find((x) => x.docId === 'budget')!.claimsReturned as { excerpt: string }[];
    expect(claims.some((c) => c.excerpt.includes('28/02/2027'))).toBe(true);
  });
});
