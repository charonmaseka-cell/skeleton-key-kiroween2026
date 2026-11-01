import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// R1.3: the engine must not import app code or contain domain-specific logic.
const SRC = new URL('.', import.meta.url).pathname;
const DOMAIN_WORDS = /\b(rfq|quote|quotation|grant|attachment|supplier|incoterm|warranty)\b/i;
const IMPORT_LINE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('engine boundary', () => {
  const files = sourceFiles(SRC);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('does not import apps, app packages or UI', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(IMPORT_LINE)) {
        const spec = m[1] ?? '';
        expect(spec, `${file} imports ${spec}`).not.toMatch(/(^|\/)apps\//);
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^@skeleton-key\/(scopecheck|packcheck|ui)/);
      }
    }
  });

  it('contains no domain-specific terms', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(DOMAIN_WORDS);
    }
  });
});
