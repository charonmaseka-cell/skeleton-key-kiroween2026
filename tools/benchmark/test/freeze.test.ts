import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANIFEST, MANIFEST_2, REPO, RUNNER_ADDED, RUNNER_ONLY, computeHashes, frozenFileList } from '../src/freeze';

// The fresh-document validation (SC-T12) has an ORIGINAL freeze (freeze.json) and one SUPERSEDING freeze (freeze-2.json) that records a
// runner-only change: the stop conditions, the batch allowance and the raw-response log. The original is kept exactly as it was
// written. If a test here fails, a frozen file changed after its freeze: revert it, or write a new superseding manifest
// on purpose (npx tsx tools/benchmark/src/freeze.ts --supersede --reason "...") and record why in docs/build-log.md BEFORE any live batch.

type Original = { frozenAtCommit: string; configuration: Record<string, unknown>; files: Record<string, string> };
type Superseding = { supersedes: { file: string; sha256: string; frozenAtCommit: string }; runnerOnly: boolean; reason: string; changedFiles: { file: string; before: string; after: string }[]; addedFiles: { file: string; sha256: string }[]; configuration: Record<string, unknown>; files: Record<string, string> };
const read = <T,>(p: string) => JSON.parse(readFileSync(join(REPO, p), 'utf8')) as T;
const original = read<Original>(MANIFEST);
const next = read<Superseding>(MANIFEST_2);
const now = computeHashes();

/** things that decide what is extracted, chunked, matched, compared or scored: none of them may differ between the two freezes */
const PROTECTED = (f: string) =>
  f.startsWith('packages/') || f.startsWith('apps/scopecheck/src/adapter/') || f.startsWith('samples/scopecheck-fresh/') && !f.endsWith('freeze.json') ||
  ['services/extraction-api/src/profiles.ts', 'services/extraction-api/src/handler.ts', 'tools/benchmark/src/score.ts', 'tools/benchmark/src/chunking.ts', 'tools/benchmark/src/fresh-scopecheck.ts', 'tools/benchmark/src/samples.ts', 'tools/benchmark/src/preflight.ts', 'tools/benchmark/src/budget.ts', 'tools/benchmark/src/transport.ts', 'tools/benchmark/src/usage.ts'].includes(f);

describe('the original freeze is retained unchanged', () => {
  it('the file still has the SHA-256 the superseding freeze recorded for it, and still names its own commit', () => {
    const sha = createHash('sha256').update(readFileSync(join(REPO, MANIFEST))).digest('hex');
    expect(next.supersedes).toMatchObject({ file: MANIFEST, sha256: sha, frozenAtCommit: original.frozenAtCommit });
    expect(original.frozenAtCommit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('the superseding freeze records a runner-only change', () => {
  it('only the live runner and its command line changed; two runner-side files were added; nothing else', () => {
    expect(next.runnerOnly).toBe(true);
    expect(next.changedFiles.map((c) => c.file).sort()).toEqual([...RUNNER_ONLY].sort());
    expect(next.addedFiles.map((c) => c.file).sort()).toEqual([...RUNNER_ADDED].sort());
    expect(next.reason.length).toBeGreaterThan(40);
  });

  it('every file the original freeze listed has its original hash now, except the runner files, which have the superseding hash', () => {
    const changed = new Map(next.changedFiles.map((c) => [c.file, c]));
    for (const [f, h] of Object.entries(original.files)) {
      if (changed.has(f)) {
        expect(changed.get(f)!.before, f).toBe(h);
        expect(now[f], f).toBe(changed.get(f)!.after);
        expect(next.files[f], f).toBe(now[f]);
        expect(now[f], f).not.toBe(h);
      } else {
        expect(now[f], f).toBe(h);
        expect(next.files[f], f).toBe(h);
      }
    }
  });

  it('documents, labels, profiles, chunk plan, parser, engine, identity and comparison rules are byte-identical in both freezes', () => {
    const protectedFiles = Object.keys(original.files).filter(PROTECTED);
    expect(protectedFiles.length).toBeGreaterThan(30);
    for (const f of ['samples/scopecheck-fresh/sample.json', 'samples/scopecheck-fresh/chunk-plan.json', 'samples/scopecheck-fresh/rfq.pdf', 'apps/scopecheck/src/adapter/rules.ts', 'apps/scopecheck/src/adapter/identity.ts', 'services/extraction-api/src/profiles.ts', 'packages/ingest/src/cells.ts', 'packages/engine/src/chunk-output.ts']) expect(protectedFiles).toContain(f);
    for (const f of protectedFiles) {
      expect(now[f], f).toBe(original.files[f]);
      expect(next.files[f], f).toBe(original.files[f]);
    }
    for (const c of next.changedFiles) expect(PROTECTED(c.file), c.file).toBe(false);
  });

  it('the superseding manifest covers exactly the files that exist now, and each hash matches', () => {
    expect(Object.keys(next.files).sort()).toEqual(frozenFileList());
    expect(next.files).toEqual(now);
    for (const a of next.addedFiles) expect(now[a.file]).toBe(a.sha256);
  });

  it('keeps the frozen configuration and adds the stop conditions and the batch allowance', () => {
    for (const k of ['model', 'profiles', 'outputCapTokens', 'timeoutMs', 'maxRepairsPerRequest', 'concurrency', 'chunking', 'parser', 'scopeRuleVersion', 'auditVersion', 'productionAdmission']) expect(next.configuration[k], k).toEqual(original.configuration[k]);
    expect(next.configuration).toMatchObject({ outputCapTokens: 1500, timeoutMs: 25_000, concurrency: 1, productionAdmission: 0 });
    expect(next.configuration.stopConditions).toHaveLength(4);
    expect(next.configuration.observationsOnly).toHaveLength(4);
  });
});

describe('what the freeze covers', () => {
  it('rules, identity, parser cells, chunker, profiles, scorer, labels, plan and the runner are all in it', () => {
    for (const f of ['apps/scopecheck/src/adapter/rules.ts', 'apps/scopecheck/src/adapter/identity.ts', 'packages/ingest/src/cells.ts', 'packages/engine/src/chunk-output.ts', 'services/extraction-api/src/profiles.ts', 'tools/benchmark/src/score.ts', 'tools/benchmark/src/run.ts', 'tools/benchmark/src/batch.ts', 'tools/benchmark/src/recording.ts', 'samples/scopecheck-fresh/sample.json', 'samples/scopecheck-fresh/chunk-plan.json']) expect(frozenFileList()).toContain(f);
  });
});
