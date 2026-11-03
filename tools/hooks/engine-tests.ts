// Hook "engine file saved": run that module's tests (and only those, when they can be found).
//
//   packages/engine/src/<module>.ts saved  ->  packages/engine/test/<module>.test.ts (or src/<module>.test.ts), plus any engine test
//   that imports the module; if none is found, every engine test is run (and the output says so).
//
// Exit code = vitest's. It prints which tests it chose and why, so the hook's output is evidence of what ran.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { ROOT, exists, readStdin, savedPaths } from './paths';

export function testsFor(modules: string[]): { files: string[]; why: string[]; all: boolean } {
  const dirs = ['packages/engine/test', 'packages/engine/src'];
  const all = dirs.flatMap((d) => readdirSync(ROOT + d).filter((f) => /\.test\.ts$/.test(f)).map((f) => `${d}/${f}`));
  const files = new Set<string>();
  const why: string[] = [];
  for (const m of modules) {
    const name = m.replace(/^packages\/engine\/src\//, '').replace(/\.ts$/, '');
    for (const cand of [`packages/engine/test/${name}.test.ts`, `packages/engine/src/${name}.test.ts`]) if (exists(cand)) { files.add(cand); why.push(`${cand}: the module's own test`); }
    const base = name.split('/').pop()!;
    const importer = new RegExp(`from\\s+['"][./]*(?:src/)?${base}['"]`);
    for (const t of all) if (importer.test(readFileSync(ROOT + t, 'utf8')) && !files.has(t)) { files.add(t); why.push(`${t}: imports ${base}`); }
  }
  return { files: [...files], why, all: files.size === 0 };
}

if (process.argv[1]?.endsWith('engine-tests.ts')) {
  const modules = savedPaths(readStdin()).filter((p) => /^packages\/engine\/src\/[^/]+\.ts$/.test(p) && !/\.test\.ts$/.test(p));
  const { files, why, all } = testsFor(modules);
  console.log(`engine file saved: ${modules.join(', ') || '(not named in the hook input)'}`);
  for (const w of why) console.log(`  running ${w}`);
  if (all) console.log('  no module-specific test found: running every engine test');
  const args = ['vitest', 'run', ...(all ? ['packages/engine'] : files)];
  const r = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
