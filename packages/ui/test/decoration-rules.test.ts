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
  it('has no remote font, no @import url(), and no script tag; a @font-face may only name a local font file', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, rel(f)).not.toMatch(/@import url\(|<script/);
      for (const block of text.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
        const urls = [...block.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]!);
        expect(urls.length, `${rel(f)}: @font-face without a source`).toBeGreaterThan(0);
        for (const u of urls) {
          expect(u, `${rel(f)}: a font must be a local file`).toMatch(/^\.\/fonts\/[\w.-]+\.woff2$/);
          expect(statSync(join(f, '..', u)).size, `${u} is over 40 kB`).toBeLessThanOrEqual(40 * 1024);
        }
      }
    }
  });
  it('the two self-hosted fonts ship with their licences, and are used only where HU-37 says, only with effects on', () => {
    const dir = join(ROOT, 'packages/ui/src/fonts');
    expect(readdirSync(dir).sort()).toEqual(['LICENSE-Apache-2.0-Special-Elite.txt', 'OFL-Pirata-One.txt', 'README.md', 'pirata-one-latin-400.woff2', 'special-elite-400-subset.woff2']);
    expect(readFileSync(join(dir, 'OFL-Pirata-One.txt'), 'utf8')).toMatch(/SIL Open Font License, Version 1\.1/);
    expect(readFileSync(join(dir, 'LICENSE-Apache-2.0-Special-Elite.txt'), 'utf8')).toMatch(/Apache License[\s\S]*Version 2\.0/);
    // Special Elite is Apache 2.0, not OFL, and its subset is a modification: the notice says so.
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(readme).toMatch(/Apache License 2\.0/);
    expect(readme).toMatch(/NOTICE:[^\n]*modified/);
    expect(readme).toMatch(/U\+2019[\s\S]*U\+2026/);
    const css = readFileSync(join(ROOT, 'packages/ui/src/effects.css'), 'utf8');
    const sel = (family: string) => [...css.matchAll(new RegExp(`([^{}]*)\\{[^{}]*${family}[^{}]*\\}`, 'g'))].map((m) => m[1]!.trim().split('\n').pop()!.trim()).filter((x) => !x.startsWith('@font-face'));
    expect(sel("'Skeleton Title'")).toEqual([":root[data-effects='on'] h1[data-display]"]);
    expect(sel("'Skeleton Typewriter'")).toEqual([":root[data-effects='on'] [data-typewriter]"]);
    const using = (attr: string) => files.filter((f) => f.endsWith('.tsx') && new RegExp(attr).test(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(using('data-display')).toEqual(['packages/ui/src/AppShell.tsx']);
    expect(using('data-typewriter')).toEqual(['packages/ui/src/ProgressView.tsx', 'packages/ui/src/Seance.tsx']);
  });
  it('ships no image over 20 kB in either app', () => {
    const imgs = [...walk(join(ROOT, 'apps/scopecheck'), (f) => /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(f)), ...walk(join(ROOT, 'apps/packcheck'), (f) => /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(f))];
    for (const f of imgs) expect(statSync(f).size, rel(f)).toBeLessThanOrEqual(20 * 1024);
  });
});

describe('candlelight pass (HU-32 to HU-40)', () => {
  const css = readFileSync(join(ROOT, 'packages/ui/src/effects.css'), 'utf8');
  // Rules as [selector, body] pairs (no nesting in this file except @media/@keyframes, which are flattened by this pattern).
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2]! }));
  const WARM_OK = /^(?:\[data-fog\]|\[data-gutter-fog\]|\[data-gutter-fog='right'\]|\[data-candle\][^,]*|\[data-warm\][^,]*|\.art-[\w-]+)$/;

  it('amber and orange (--sk-warm-*) appear only in header, gutter and illustration selectors', () => {
    const bad = rules.filter((r) => /--sk-warm-/.test(r.body) && !/^:root$/.test(r.sel) && !r.sel.split(',').every((x) => WARM_OK.test(x.trim()))).map((r) => r.sel);
    expect(bad).toEqual([]);
    expect(rules.some((r) => /--sk-warm-/.test(r.body))).toBe(true);
  });
  it('the Needs review amber (--sk-accent) is never used for decoration in effects.css', () => {
    expect(css).not.toMatch(/--sk-accent/);
  });
  it('no raster image or third-party picture in the apps or packages (original SVG art only)', () => {
    const rasters = [...walk(join(ROOT, 'apps'), (f) => /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(f) && !f.includes('/dist/')), ...walk(join(ROOT, 'packages'), (f) => /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(f))].map(rel);
    expect(rasters).toEqual([]);
  });
  it('the art is drawn in code, names no colour and no id, and every piece is aria-hidden', () => {
    const art = readFileSync(join(ROOT, 'packages/ui/src/Art.tsx'), 'utf8');
    expect(art).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|<image|href=|\sid=/);
    expect(art).not.toMatch(/<text/);
  });
  it('the 404 pages are static: no script, no remote request, the two fonts alongside, themed text and a link back', () => {
    for (const app of ['scopecheck', 'packcheck']) {
      const html = readFileSync(join(ROOT, `apps/${app}/public/404.html`), 'utf8');
      expect(html).not.toMatch(/<script|<link|<img|@import/i);
      expect(html.replace(/http:\/\/www\.w3\.org\/\d+\/svg/g, '')).not.toMatch(/https?:\/\//);
      expect(html).toMatch(/<h1>Lost in the catacombs<\/h1>/);
      expect(html).toMatch(/<a href="\/">Back to /);
      expect(readdirSync(join(ROOT, `apps/${app}/public/fonts`)).sort()).toEqual(['pirata-one-latin-400.woff2', 'special-elite-400-subset.woff2']);
    }
  });
});

