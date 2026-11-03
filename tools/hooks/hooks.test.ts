import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeOutcomes, diffOutcomes } from './golden-outcomes';
import { testsFor } from './engine-tests';
import { ROOT, savedPaths } from './paths';

describe('hook input', () => {
  it('finds the saved file wherever the hook input names it, and repo-relative from an absolute path', () => {
    expect(savedPaths('{"tool":"fsWrite","input":{"path":"packages/engine/src/findings.ts"}}', {})).toEqual(['packages/engine/src/findings.ts']);
    expect(savedPaths(JSON.stringify({ files: [ROOT + 'apps/scopecheck/src/adapter/rules.ts'] }), {})).toEqual(['apps/scopecheck/src/adapter/rules.ts']);
    expect(savedPaths('', { FILE: 'packages/engine/src/matcher.ts' } as never)).toEqual(['packages/engine/src/matcher.ts']);
    expect(savedPaths('{"x":"/etc/passwd.json"}', {})).toEqual([]);
    expect(savedPaths('', {})).toEqual([]);
  });
});

describe('engine file saved -> that module\'s tests', () => {
  it('picks the module\'s own test and the tests that import it', () => {
    const r = testsFor(['packages/engine/src/findings.ts']);
    expect(r.all).toBe(false);
    expect(r.files).toContain('packages/engine/test/findings.test.ts');
    expect(r.why.join('\n')).toMatch(/the module's own test/);
  });
  it('runs every engine test when no module-specific test exists, and says so', () => {
    expect(testsFor(['packages/engine/src/no-such-module-xyz.ts']).all).toBe(true);
    expect(testsFor([]).all).toBe(true);
  });
  it('every engine module with a same-named test is found', () => {
    for (const f of readdirSync(ROOT + 'packages/engine/test').filter((x) => x.endsWith('.test.ts') && x !== 'helpers.ts')) {
      const name = f.replace('.test.ts', '');
      expect(testsFor([`packages/engine/src/${name}.ts`]).files).toContain(`packages/engine/test/${f}`);
    }
  });
});

describe('rule or adapter file saved -> changed outcomes are reported', () => {
  it('the committed snapshot equals the outcomes computed now (a rule change must update it on purpose)', () => {
    const was = JSON.parse(readFileSync(ROOT + 'tools/hooks/golden-outcomes.json', 'utf8')) as Record<string, string>;
    expect(diffOutcomes(was, computeOutcomes())).toEqual([]);
  });
  it('reports added, removed and changed outcomes, with the old and new state', () => {
    const was = { 'a / f / coverage none / item.absent | x | q': 'needs_review critical', 'a / f / coverage none / gone': 'confirmed info' };
    const now = { 'a / f / coverage none / item.absent | x | q': 'confirmed critical', 'a / f / coverage none / new': 'confirmed high' };
    expect(diffOutcomes(was, now)).toEqual([
      'ADDED    a / f / coverage none / new = confirmed high',
      'REMOVED  a / f / coverage none / gone (was confirmed info)',
      'CHANGED  a / f / coverage none / item.absent | x | q: needs_review critical -> confirmed critical',
    ]);
  });
  it('covers every sample fixture of both apps, with and without coverage confirmed', () => {
    const keys = Object.keys(computeOutcomes());
    for (const f of ['scopecheck-fulllength', 'scopecheck-standard', 'scopecheck-layout', 'packcheck-pack']) for (const c of ['none', 'confirmed']) expect(keys.some((k) => k.includes(`/ ${f} / coverage ${c} /`))).toBe(true);
  });
  it('the snapshot records the severity change: quantity differences are High', () => {
    const was = JSON.parse(readFileSync(ROOT + 'tools/hooks/golden-outcomes.json', 'utf8')) as Record<string, string>;
    const q = Object.entries(was).filter(([k]) => k.includes('quantity.differs'));
    expect(q.length).toBeGreaterThan(0);
    for (const [, v] of q) expect(v).toMatch(/high$/);
  });
});
