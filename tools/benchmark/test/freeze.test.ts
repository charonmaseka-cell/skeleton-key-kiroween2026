import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANIFEST, REPO, computeHashes, frozenFileList } from '../src/freeze';

// The implementation, documents, labels and chunk plan under evaluation in the fresh-document validation are frozen. If this
// test fails, a frozen file changed after the freeze: either revert it, or re-write the manifest on purpose
// (npx tsx tools/benchmark/src/freeze.ts --write) and record why in docs/build-log.md BEFORE any live batch.

const manifest = JSON.parse(readFileSync(join(REPO, MANIFEST), 'utf8')) as { files: Record<string, string>; configuration: Record<string, unknown>; frozenAtCommit: string };

describe('freeze of the fresh-document validation', () => {
  it('every frozen file still has the hash recorded at the freeze, and no frozen file was added or removed', () => {
    const now = computeHashes();
    const changed = Object.keys(manifest.files).filter((f) => now[f] !== manifest.files[f]);
    expect(changed).toEqual([]);
    expect(Object.keys(now).sort()).toEqual(Object.keys(manifest.files).sort());
  });

  it('covers the parts that decide the outcome: rules, identity, parser cells, chunker, profiles, scorer and the labels', () => {
    for (const f of ['apps/scopecheck/src/adapter/rules.ts', 'apps/scopecheck/src/adapter/identity.ts', 'packages/ingest/src/cells.ts', 'packages/engine/src/chunk-output.ts', 'services/extraction-api/src/profiles.ts', 'tools/benchmark/src/score.ts', 'samples/scopecheck-fresh/sample.json', 'samples/scopecheck-fresh/chunk-plan.json']) expect(frozenFileList()).toContain(f);
  });

  it('records the configuration that stays fixed: model, output cap, timeout, concurrency 1, admission 0', () => {
    expect(manifest.configuration).toMatchObject({ outputCapTokens: 1500, timeoutMs: 25_000, concurrency: 1, productionAdmission: 0, parser: 'ingest/2-cells', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' });
  });
});
