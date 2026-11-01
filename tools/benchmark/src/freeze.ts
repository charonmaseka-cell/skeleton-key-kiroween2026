// Freeze manifest for the fresh-document validation (SC-T12). It records WHAT is being evaluated, before any inference: the
// implementation (engine, parser, ScopeCheck adapter, request profiles, benchmark runner), the documents, the pre-registered
// labels and the chunk plan, as SHA-256 hashes of file contents. A test recomputes them: if any frozen file changes, that test
// fails until the manifest is deliberately re-written (and the reason recorded in the build log). Hashes are of content, so the
// manifest does not depend on a commit; `frozenAtCommit` is the commit that contained these files when the manifest was made.
//
//   npx tsx tools/benchmark/src/freeze.ts --write     writes samples/scopecheck-fresh/freeze.json
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LEGACY_PARSER_VERSION, PARSER_VERSION } from '@skeleton-key/ingest';
import { scopeRule } from '../../../apps/scopecheck/src/adapter/rules';
import { AUDIT_VERSION } from './run';
import { DEFAULT_MAX_VALUES } from './chunking';

export const REPO = new URL('../../../', import.meta.url).pathname;
export const MANIFEST = 'samples/scopecheck-fresh/freeze.json';

/** Directories hashed file by file (non-test sources only) and single files. */
const DIRS = ['packages/engine/src', 'packages/ingest/src', 'apps/scopecheck/src/adapter'];
const FILES = [
  'services/extraction-api/src/profiles.ts',
  'services/extraction-api/src/handler.ts',
  'tools/benchmark/src/run.ts',
  'tools/benchmark/src/score.ts',
  'tools/benchmark/src/chunking.ts',
  'tools/benchmark/src/budget.ts',
  'tools/benchmark/src/preflight.ts',
  'tools/benchmark/src/transport.ts',
  'tools/benchmark/src/usage.ts',
  'tools/benchmark/src/samples.ts',
  'tools/benchmark/src/cli.ts',
  // the documents, the pre-registered labels and the chunk plan
  'tools/benchmark/src/fresh-scopecheck.ts',
  'samples/scopecheck-fresh/sample.json',
  'samples/scopecheck-fresh/rfq.pdf',
  'samples/scopecheck-fresh/quote-a.pdf',
  'samples/scopecheck-fresh/quote-b.pdf',
  'samples/scopecheck-fresh/chunk-plan.json',
];

const sha = (p: string) => createHash('sha256').update(readFileSync(join(REPO, p))).digest('hex');
function walk(dir: string): string[] {
  return readdirSync(join(REPO, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(join(REPO, p)).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

export function frozenFileList(): string[] {
  return [...DIRS.flatMap(walk), ...FILES].map((p) => relative('', p)).sort();
}

export function computeHashes(): Record<string, string> {
  return Object.fromEntries(frozenFileList().map((p) => [p, sha(p)]));
}

export function buildManifest() {
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    // not a git checkout
  }
  return {
    version: 1,
    purpose: 'Freeze of the implementation under evaluation for the fresh-document validation (SC-T12). Written before any inference on these documents.',
    frozenAtCommit: commit,
    configuration: {
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      profiles: { rfq: 'scopecheck.rfq.v1', 'quote-a': 'scopecheck.quote.v1', 'quote-b': 'scopecheck.quote.v1' },
      outputCapTokens: 1500,
      timeoutMs: 25_000,
      maxRepairsPerRequest: 1,
      concurrency: 1,
      chunking: { kind: 'output-aware', frozenPlan: 'samples/scopecheck-fresh/chunk-plan.json', valuesPerRequest: DEFAULT_MAX_VALUES },
      parser: PARSER_VERSION,
      legacyParser: LEGACY_PARSER_VERSION,
      scopeRuleVersion: scopeRule.version,
      auditVersion: AUDIT_VERSION,
      productionAdmission: 0,
    },
    rules: 'Labels, expected findings and the freeze are committed first. The rules, parser, chunker, profiles and runner are not to be changed between this freeze and the live batch; a change means a new freeze and a new build-log entry.',
    files: computeHashes(),
  };
}

if (process.argv[1]?.endsWith('freeze.ts') && process.argv.includes('--write')) {
  const m = buildManifest();
  writeFileSync(join(REPO, MANIFEST), JSON.stringify(m, null, 2) + '\n');
  console.log(`freeze written: ${MANIFEST} (${Object.keys(m.files).length} files, rules v${m.configuration.scopeRuleVersion}, ${m.configuration.parser}, commit ${m.frozenAtCommit.slice(0, 7)})`);
}
