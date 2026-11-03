import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// HU-T2: components use the semantic colour utilities (bg-sk-*, text-sk-*, border-sk-*), never a fixed palette class, so both modes
// stay correct. The only allowed raw colours are the two mode banners (labelling, not theme: HU-7), on lines marked `banner-colours`
// (the marker is the comment on the line above the banner's JSX).
const ROOT = new URL('../../../', import.meta.url).pathname;
const RAW = /\b(?:bg|text|border|ring|outline|divide|decoration|fill|stroke|from|to|via|shadow|accent|caret|placeholder)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist') continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

describe('no fixed palette classes in components (HU-T2)', () => {
  const files = [...walk(join(ROOT, 'packages/ui/src')), ...walk(join(ROOT, 'apps/scopecheck/src')), ...walk(join(ROOT, 'apps/packcheck/src'))];
  it('finds the component files', () => expect(files.length).toBeGreaterThan(8));
  it('has no raw Tailwind palette class outside the marked banner lines', () => {
    const bad: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (lines[i - 1]?.includes('banner-colours')) return;
        if (RAW.test(line)) bad.push(`${f.replace(ROOT, '')}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
    expect(bad).toEqual([]);
  });
  it('writes no hex colour in a component (colours come from the tokens)', () => {
    const bad: string[] = [];
    for (const f of files) readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (HEX.test(line) && !/&#|href=|id=/.test(line)) bad.push(`${f.replace(ROOT, '')}:${i + 1}`); });
    expect(bad).toEqual([]);
  });
});
