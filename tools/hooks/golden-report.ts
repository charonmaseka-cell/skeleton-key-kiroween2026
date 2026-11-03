// Hook "rule or adapter file saved": rerun the golden fixtures and REPORT CHANGED OUTCOMES.
//
//   1. Computes every rule outcome on every sample fixture and compares it with tools/hooks/golden-outcomes.json: prints each
//      outcome that was added, removed or changed (finding state or severity, comparison counts).
//   2. Runs the golden and review-regression tests of both apps and prints their summary.
//   Exit 1 if any outcome changed or any test failed. After an intended change, review the report and run with --update to accept it.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { computeOutcomes, diffOutcomes } from './golden-outcomes';
import { ROOT, readStdin, savedPaths } from './paths';

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
export const SNAPSHOT = 'tools/hooks/golden-outcomes.json';
export const GOLDEN_TESTS = ['apps/scopecheck/src/golden.test.ts', 'apps/scopecheck/src/review-fixes.test.ts', 'apps/packcheck/src/golden.test.ts', 'apps/packcheck/src/review-fixes.test.ts'];

if (process.argv[1]?.endsWith('golden-report.ts')) {
  const saved = savedPaths(process.argv.includes('--update') ? '' : readStdin());
  const now = computeOutcomes();
  if (process.argv.includes('--update')) {
    writeFileSync(ROOT + SNAPSHOT, JSON.stringify(now, null, 2) + '\n');
    console.log(`golden outcomes snapshot written: ${Object.keys(now).length} outcomes`);
    process.exit(0);
  }
  console.log(`rule or adapter file saved: ${saved.join(', ') || '(not named in the hook input)'}`);
  const was = JSON.parse(readFileSync(ROOT + SNAPSHOT, 'utf8')) as Record<string, string>;
  const diff = diffOutcomes(was, now);
  if (diff.length === 0) console.log(`outcomes: unchanged (${Object.keys(now).length} outcomes compared with ${SNAPSHOT})`);
  else {
    console.log(`outcomes: ${diff.length} CHANGED since the committed snapshot:`);
    for (const l of diff) console.log(`  ${l}`);
    console.log('  If this is intended, review it and run: npx tsx tools/hooks/golden-report.ts --update');
  }
  const r = spawnSync('npx', ['vitest', 'run', ...GOLDEN_TESTS], { cwd: ROOT, encoding: 'utf8' });
  const summary = (r.stdout + r.stderr).split('\n').filter((l) => /Test Files|Tests |FAIL|✗|×/.test(l)).map((l) => l.replace(ANSI, '').trim());
  console.log(`golden tests: ${r.status === 0 ? 'pass' : 'FAIL'}`);
  for (const l of summary) console.log(`  ${l}`);
  process.exit(diff.length || r.status ? 1 : 0);
}
