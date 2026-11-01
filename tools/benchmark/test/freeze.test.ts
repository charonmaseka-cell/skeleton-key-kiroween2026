import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHAIN, EVALUATION_SET, REPO, RUNNER_FILES, computeHashes, hashesAtCommit } from '../src/freeze';

// The fresh-document validation (SC-T12) has an ORIGINAL freeze (freeze.json) and a chain of SUPERSEDING freezes (freeze-2.json,
// freeze-3.json), each recording a runner-only change on top of the one before. None is ever rewritten: each new one records the
// SHA-256 of the manifest it supersedes. If a test here fails, a frozen file changed after its freeze: revert it, or write a new
// superseding manifest on purpose (npx tsx tools/benchmark/src/freeze.ts --supersede --from OLD --to NEW --reason "...") and record why
// in docs/build-log.md BEFORE any live batch.
//
// After the SC-T12 results were accepted, development continues on later commits. So the ACCEPTED implementation is verified from git
// history at the commit the last manifest was frozen at (CI checks out full history for this), while the evaluation set (documents,
// labels, chunk plan and their generator) must still be byte-identical in the working tree.

type Manifest = {
  version?: number;
  frozenAtCommit: string;
  configuration: Record<string, unknown>;
  files: Record<string, string>;
  supersedes?: { file: string; sha256: string; frozenAtCommit: string };
  runnerOnly?: boolean;
  reason?: string;
  changedFiles?: { file: string; before: string; after: string }[];
  addedFiles?: { file: string; sha256: string }[];
};
const read = (p: string) => JSON.parse(readFileSync(join(REPO, p), 'utf8')) as Manifest;
const sha = (p: string) => createHash('sha256').update(readFileSync(join(REPO, p))).digest('hex');
const chain = CHAIN.map(read);
const original = chain[0]!;
const last = chain.at(-1)!;
const now = computeHashes();

/** things that decide what is extracted, chunked, matched, compared or scored: none of them may differ in any freeze */
const PROTECTED = (f: string) =>
  f.startsWith('packages/') || f.startsWith('apps/scopecheck/src/adapter/') || (f.startsWith('samples/scopecheck-fresh/') && !/freeze/.test(f)) ||
  ['services/extraction-api/src/profiles.ts', 'services/extraction-api/src/handler.ts', 'tools/benchmark/src/score.ts', 'tools/benchmark/src/chunking.ts', 'tools/benchmark/src/fresh-scopecheck.ts', 'tools/benchmark/src/samples.ts', 'tools/benchmark/src/preflight.ts', 'tools/benchmark/src/budget.ts', 'tools/benchmark/src/transport.ts', 'tools/benchmark/src/usage.ts'].includes(f);

describe('every earlier freeze is retained unchanged', () => {
  it('each manifest records the SHA-256 of the one it supersedes, and that file still has it', () => {
    expect(chain.length).toBe(3);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]!.supersedes, CHAIN[i]).toMatchObject({ file: CHAIN[i - 1], sha256: sha(CHAIN[i - 1]!), frozenAtCommit: chain[i - 1]!.frozenAtCommit });
      expect(chain[i]!.runnerOnly).toBe(true);
      expect(chain[i]!.reason!.length).toBeGreaterThan(40);
    }
    expect(original.frozenAtCommit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('each superseding freeze records a runner-only change', () => {
  it('only runner files changed or were added at each step, and every hash follows from the step before', () => {
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1]!;
      const m = chain[i]!;
      const changed = new Map(m.changedFiles!.map((c) => [c.file, c]));
      const added = new Map(m.addedFiles!.map((c) => [c.file, c]));
      for (const f of [...changed.keys(), ...added.keys()]) expect(RUNNER_FILES, `${CHAIN[i]} ${f}`).toContain(f);
      for (const [f, h] of Object.entries(prev.files)) {
        if (changed.has(f)) {
          expect(changed.get(f)!.before, f).toBe(h);
          expect(m.files[f], f).toBe(changed.get(f)!.after);
          expect(m.files[f], f).not.toBe(h);
        } else expect(m.files[f], f).toBe(h);
      }
      for (const [f, a] of added) expect(m.files[f], f).toBe(a.sha256);
      expect(Object.keys(m.files).sort()).toEqual([...Object.keys(prev.files), ...added.keys()].sort());
    }
  });

  it('freeze 2 changed run.ts and cli.ts and added batch.ts and recording.ts; freeze 3 changed batch.ts and added recover.ts (the record of what happened)', () => {
    expect(chain[1]!.changedFiles!.map((c) => c.file).sort()).toEqual(['tools/benchmark/src/cli.ts', 'tools/benchmark/src/run.ts']);
    expect(chain[1]!.addedFiles!.map((c) => c.file).sort()).toEqual(['tools/benchmark/src/batch.ts', 'tools/benchmark/src/recording.ts']);
    expect(chain[2]!.changedFiles!.map((c) => c.file)).toEqual(['tools/benchmark/src/batch.ts']);
    expect(chain[2]!.addedFiles!.map((c) => c.file)).toEqual(['tools/benchmark/src/recover.ts']);
  });

  it('documents, labels, profiles, chunk plan, parser, engine, identity and comparison rules are byte-identical in EVERY freeze', () => {
    const protectedFiles = Object.keys(original.files).filter(PROTECTED);
    expect(protectedFiles.length).toBeGreaterThan(30);
    for (const f of ['samples/scopecheck-fresh/sample.json', 'samples/scopecheck-fresh/chunk-plan.json', 'samples/scopecheck-fresh/rfq.pdf', 'apps/scopecheck/src/adapter/rules.ts', 'apps/scopecheck/src/adapter/identity.ts', 'services/extraction-api/src/profiles.ts', 'packages/ingest/src/cells.ts', 'packages/engine/src/chunk-output.ts']) expect(protectedFiles).toContain(f);
    for (const f of protectedFiles) for (const m of chain) expect(m.files[f], `${f} in a freeze`).toBe(original.files[f]);
    for (const m of chain.slice(1)) for (const c of [...m.changedFiles!, ...m.addedFiles!.map((x) => ({ file: x.file }))]) expect(PROTECTED(c.file), c.file).toBe(false);
  });

  it('the evaluation set (documents, labels, chunk plan, generator) is still byte-identical now', () => {
    const files = Object.keys(original.files).filter(EVALUATION_SET);
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) expect(now[f], f).toBe(original.files[f]);
  });

  it('the ACCEPTED implementation is reproducible: every file of the last manifest has that hash at its frozen commit in git', () => {
    const atCommit = hashesAtCommit(last.frozenAtCommit, Object.keys(last.files));
    const missing = Object.entries(atCommit).filter(([, h]) => h === null).map(([f]) => f);
    expect(missing, 'git history is needed for this check (CI: actions/checkout with fetch-depth 0)').toEqual([]);
    for (const [f, h] of Object.entries(last.files)) expect(atCommit[f], f).toBe(h);
  });

  it('the frozen configuration is the same in every freeze: model, profiles, 1,500-token cap, 25 s timeout, concurrency 1, admission 0', () => {
    for (const m of chain) for (const k of ['model', 'profiles', 'outputCapTokens', 'timeoutMs', 'maxRepairsPerRequest', 'concurrency', 'chunking', 'parser', 'scopeRuleVersion', 'auditVersion', 'productionAdmission']) expect(m.configuration[k], k).toEqual(original.configuration[k]);
    expect(last.configuration).toMatchObject({ outputCapTokens: 1500, timeoutMs: 25_000, concurrency: 1, productionAdmission: 0 });
    expect((chain[1]!.configuration as { stopConditions: string[] }).stopConditions).toHaveLength(4);
  });
});

describe('what the freeze covers', () => {
  it('rules, identity, parser cells, chunker, profiles, scorer, labels, plan and the runner are all in it', () => {
    for (const f of ['apps/scopecheck/src/adapter/rules.ts', 'apps/scopecheck/src/adapter/identity.ts', 'packages/ingest/src/cells.ts', 'packages/engine/src/chunk-output.ts', 'services/extraction-api/src/profiles.ts', 'tools/benchmark/src/score.ts', 'tools/benchmark/src/run.ts', 'tools/benchmark/src/batch.ts', 'tools/benchmark/src/recording.ts', 'tools/benchmark/src/recover.ts', 'samples/scopecheck-fresh/sample.json', 'samples/scopecheck-fresh/chunk-plan.json']) expect(Object.keys(last.files)).toContain(f);
  });
});
