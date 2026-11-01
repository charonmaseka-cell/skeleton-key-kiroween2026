// Freeze manifest for the fresh-document validation (SC-T12). It records WHAT is being evaluated, before any inference: the
// implementation (engine, parser, ScopeCheck adapter, request profiles, benchmark runner), the documents, the pre-registered
// labels and the chunk plan, as SHA-256 hashes of file contents. A test recomputes them: if any frozen file changes, that test
// fails until the manifest is deliberately re-written (and the reason recorded in the build log). Hashes are of content, so the
// manifest does not depend on a commit; `frozenAtCommit` is the commit that contained these files when the manifest was made.
//
//   npx tsx tools/benchmark/src/freeze.ts --write        writes samples/scopecheck-fresh/freeze.json (the ORIGINAL freeze; never rewritten)
//   npx tsx tools/benchmark/src/freeze.ts --supersede    writes samples/scopecheck-fresh/freeze-2.json: a RUNNER-ONLY change recorded on
//                                                        top of the original, which stays as it is (its SHA-256 is recorded in the new one)
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
export const RUNNER_ONLY = ['tools/benchmark/src/run.ts', 'tools/benchmark/src/cli.ts'];
/** Files a superseding freeze may add (all runner-side: raw-response recording and the batch allowance). */
export const RUNNER_ADDED = ['tools/benchmark/src/batch.ts', 'tools/benchmark/src/recording.ts'];

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
  ...RUNNER_ADDED,
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

/** Every frozen file as of now. The ORIGINAL manifest was written before RUNNER_ADDED existed, so it lists them as absent. */
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
 * Superseding freeze for a runner-only change. Refuses unless every file that differs from the original freeze is in RUNNER_ONLY
 * (or is a RUNNER_ADDED file the original did not list), so documents, labels, profiles, chunk plan, parser, engine, identity and
 * comparison rules provably stay as frozen.
 */
export function buildSupersedingManifest(reason: string) {
  const original = JSON.parse(readFileSync(join(REPO, MANIFEST), 'utf8')) as { frozenAtCommit: string; configuration: Record<string, unknown>; files: Record<string, string> };
  const now = computeHashes();
  const changed = Object.keys(original.files).filter((f) => now[f] !== original.files[f]);
  const added = Object.keys(now).filter((f) => !(f in original.files));
  const removed = Object.keys(original.files).filter((f) => !(f in now));
  const illegal = [...changed.filter((f) => !RUNNER_ONLY.includes(f)), ...added.filter((f) => !RUNNER_ADDED.includes(f)), ...removed];
  if (illegal.length) throw new Error(`not a runner-only change: ${illegal.join(', ')}`);
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    // not a git checkout
  }
  return {
    version: 2,
    supersedes: { file: MANIFEST, sha256: sha(MANIFEST), frozenAtCommit: original.frozenAtCommit },
    runnerOnly: true,
    reason,
    frozenAtCommit: commit,
    changedFiles: changed.map((f) => ({ file: f, before: original.files[f], after: now[f] })),
    addedFiles: added.map((f) => ({ file: f, sha256: now[f] })),
    unchanged: 'Every other file in the original freeze has the hash recorded there: the documents, the pre-registered labels, the chunk plan, the profiles, the parser, the engine, the identity step and the comparison (rules) code. A test checks each one against BOTH manifests.',
    configuration: {
      ...original.configuration,
      stopConditions: ['a stopping service error (daily, rate, quota, model, limiter, access, not configured)', 'an unrecovered schema error (schema_invalid or internal_error after the allowed repair)', 'a value accepted as validated that its own evidence does not support (audit), checked on each response before the next chunk is dispatched', 'a neuron-budget refusal'],
      observationsOnly: ['a supported value that differs from its label', 'a conservative hold', 'an extraction miss', 'a timeout (it costs an attempt and the batch goes on)'],
      batchAllowance: 'one allowance for every invocation of a batch; caps fixed at creation; attempts and estimated neurons already used are subtracted on resume; successful chunks are never resent',
    },
    files: now,
  };
}

if (process.argv[1]?.endsWith('freeze.ts') && process.argv.includes('--supersede')) {
  const i = process.argv.indexOf('--reason');
  const reason = i > 0 ? process.argv[i + 1]! : 'runner-only change';
  const m = buildSupersedingManifest(reason);
  writeFileSync(join(REPO, MANIFEST_2), JSON.stringify(m, null, 2) + '\n');
  console.log(`superseding freeze written: ${MANIFEST_2} (changed: ${m.changedFiles.map((c) => c.file).join(', ')}; added: ${m.addedFiles.map((c) => c.file).join(', ')}; commit ${m.frozenAtCommit.slice(0, 7)})`);
}
