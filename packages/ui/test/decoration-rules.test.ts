import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// HU-16 (ecto is brand, decoration and focus only), HU-9 (no sound, nothing third-party, no heavy images). Scans the source.
const ROOT = new URL('../../../', import.meta.url).pathname;
function walk(dir: string, ok: (f: string) => boolean, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git'].includes(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, ok, out);
    else if (ok(p)) out.push(p);
  }
  return out;
}
const src = (f: string) => /\.(tsx?|css)$/.test(f) && !/\.test\./.test(f);
const files = [...walk(join(ROOT, 'packages/ui/src'), src), ...walk(join(ROOT, 'apps/scopecheck/src'), src), ...walk(join(ROOT, 'apps/packcheck/src'), src)];
const rel = (f: string) => relative(ROOT, f);

describe('ecto is brand, decoration and focus only (HU-16)', () => {
  // Files allowed to use the ecto token, with what they use it for.
  const ALLOWED: Record<string, string> = {
    'packages/ui/src/theme.css': 'generated variables',
    'packages/ui/src/theme-tokens.ts': 'the token',
    'packages/ui/src/ThemeProvider.tsx': 'the mode toggle border',
    'packages/ui/src/Motifs.tsx': 'brand mark and fog edges',
    'packages/ui/src/effects.css': 'fog edges',
  };
  it('appears only in the allowed files', () => {
    const used = files.filter((f) => /sk-ecto|sk-focus|ecto/.test(readFileSync(f, 'utf8')) && /sk-ecto|--sk-ecto|\becto\b/.test(readFileSync(f, 'utf8'))).map(rel);
    for (const f of used) expect(Object.keys(ALLOWED), `${f} uses the ecto token`).toContain(f);
  });
  it('is never used in a badge, finding card, comparison cell or link', () => {
    for (const f of ['packages/ui/src/Badges.tsx', 'packages/ui/src/Workspace.tsx', 'packages/ui/src/Seance.tsx', 'apps/scopecheck/src/ComparisonMatrix.tsx', 'apps/packcheck/src/Checks.tsx']) {
      expect(readFileSync(join(ROOT, f), 'utf8'), f).not.toMatch(/ecto/);
    }
  });
  it('the focus ring is the focus token, not a fixed colour', () => {
    for (const app of ['scopecheck', 'packcheck']) expect(readFileSync(join(ROOT, `apps/${app}/src/index.css`), 'utf8')).toMatch(/:focus-visible\s*\{[^}]*var\(--sk-focus\)/);
  });
});

describe('no sound, nothing third-party, no heavy images (HU-9)', () => {
  it('has no audio element, Audio object or sound file', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/<audio|new Audio\(|AudioContext|\.(mp3|wav|ogg|m4a)\b/i);
  });
  it('loads nothing from another host (no http(s) URL outside comments and the SVG namespace)', () => {
    for (const f of files) {
      const code = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      const urls = (code.match(/https?:\/\/[^\s'"`)]+/g) ?? []).filter((u) => !u.startsWith('http://www.w3.org/'));
      expect(urls, rel(f)).toEqual([]);
    }
  });
  it('has no @font-face or @import url() of a font, and no script tag', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/@font-face|@import url\(|<script/);
  });
  it('ships no image over 20 kB in either app', () => {
    const imgs = [...walk(join(ROOT, 'apps/scopecheck'), (f) => /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(f)), ...walk(join(ROOT, 'apps/packcheck'), (f) => /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(f))];
    for (const f of imgs) expect(statSync(f).size, rel(f)).toBeLessThanOrEqual(20 * 1024);
  });
});
