// Freeze manifest for the fresh-document validation (SC-T12). It records WHAT is being evaluated, before any inference: the
// implementation (engine, parser, ScopeCheck adapter, request profiles, benchmark runner), the documents, the pre-registered
// labels and the chunk plan, as SHA-256 hashes of file contents. A test recomputes them: if any frozen file changes, that test
// fails until the manifest is deliberately re-written (and the reason recorded in the build log). Hashes are of content, so the
// manifest does not depend on a commit; `frozenAtCommit` is the commit that contained these files when the manifest was made.
//
//   npx tsx tools/benchmark/src/freeze.ts --write        writes samples/scopecheck-fresh/freeze.json (the ORIGINAL freeze; never rewritten)
//   npx tsx tools/benchmark/src/freeze.ts --supersede --from OLD --to NEW --reason "..."   writes NEW: a RUNNER-ONLY change recorded on top of
//                                                        OLD, which stays as it is (its SHA-256 is recorded in NEW)
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
export const MANIFEST_2 = 'samples/scopecheck-fresh/freeze-2.json';
/** The only files a superseding freeze may change: the live runner and its command line. Nothing that decides what is extracted, chunked, matched or compared. */
export const RUNNER_FILES = ['tools/benchmark/src/run.ts', 'tools/benchmark/src/cli.ts', 'tools/benchmark/src/batch.ts', 'tools/benchmark/src/recording.ts', 'tools/benchmark/src/recover.ts'];
export const MANIFEST_3 = 'samples/scopecheck-fresh/freeze-3.json';
/** The chain of manifests, oldest first. Each supersedes the one before it and records that one's SHA-256; none is ever rewritten. */
export const CHAIN = [MANIFEST, MANIFEST_2, MANIFEST_3];

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
  'tools/benchmark/src/batch.ts',
  'tools/benchmark/src/recording.ts',
  'tools/benchmark/src/recover.ts',
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

/** Every frozen file as of now. The ORIGINAL manifest was written before the runner-side files (batch, recording, recover) existed, so it lists them as absent. */
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

/**
 * Superseding freeze for a runner-only change. Refuses unless every file that differs from the manifest it supersedes is one of
 * RUNNER_FILES, so documents, labels, profiles, chunk plan, parser, engine, identity and comparison rules provably stay as frozen.
 */
export function buildSupersedingManifest(from: string, reason: string) {
  const prev = JSON.parse(readFileSync(join(REPO, from), 'utf8')) as { version?: number; frozenAtCommit: string; configuration: Record<string, unknown>; files: Record<string, string> };
  const now = computeHashes();
  const changed = Object.keys(prev.files).filter((f) => now[f] !== prev.files[f]);
  const added = Object.keys(now).filter((f) => !(f in prev.files));
  const removed = Object.keys(prev.files).filter((f) => !(f in now));
  const illegal = [...changed, ...added].filter((f) => !RUNNER_FILES.includes(f)).concat(removed);
  if (illegal.length) throw new Error(`not a runner-only change: ${illegal.join(', ')}`);
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    // not a git checkout
  }
  return {
    version: (prev.version ?? 1) + 1,
    supersedes: { file: from, sha256: sha(from), frozenAtCommit: prev.frozenAtCommit },
    runnerOnly: true,
    reason,
    frozenAtCommit: commit,
    changedFiles: changed.map((f) => ({ file: f, before: prev.files[f], after: now[f] })),
    addedFiles: added.map((f) => ({ file: f, sha256: now[f] })),
    unchanged: 'Every other file has the hash recorded in the manifest this one supersedes, and in the original: the documents, the pre-registered labels, the chunk plan, the profiles, the parser, the engine, the identity step and the comparison (rules) code. A test checks each one against every manifest in the chain.',
    configuration: prev.configuration,
    files: now,
  };
}

if (process.argv[1]?.endsWith('freeze.ts') && process.argv.includes('--supersede')) {
  const arg = (k: string) => process.argv[process.argv.indexOf(k) + 1]!;
  const from = process.argv.includes('--from') ? arg('--from') : MANIFEST;
  const to = process.argv.includes('--to') ? arg('--to') : MANIFEST_2;
  const m = buildSupersedingManifest(from, process.argv.includes('--reason') ? arg('--reason') : 'runner-only change');
  writeFileSync(join(REPO, to), JSON.stringify(m, null, 2) + '\n');
  console.log(`superseding freeze written: ${to} supersedes ${from} (changed: ${m.changedFiles.map((c) => c.file).join(', ') || 'none'}; added: ${m.addedFiles.map((c) => c.file).join(', ') || 'none'}; commit ${m.frozenAtCommit.slice(0, 7)})`);
}
