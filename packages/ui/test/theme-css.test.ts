import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTES, themeCss } from '../src/theme-tokens';

describe('generated theme.css', () => {
  const css = themeCss();
  it('the committed theme.css is exactly what the tokens generate (regenerate with: npx tsx packages/ui/scripts/write-theme-css.ts)', () => {
    expect(readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8')).toBe(css);
  });
  it('has a variable for every token in both modes, with the exact token values', () => {
    for (const [mode, p] of Object.entries(PALETTES)) {
      const block = css.match(new RegExp(`:root\\[data-lights='${mode}'\\] \\{([^}]*)\\}`))![1]!;
      for (const [k, v] of Object.entries(p)) expect(block, `${mode} ${k}`).toContain(`--sk-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${v};`);
    }
  });
  it('Lights on is the default before the mode is known', () => {
    const base = css.match(/^:root \{([^}]*)\}/m)![1]!;
    expect(base).toContain(`--sk-bg: ${PALETTES.on.bg};`);
  });
  it('print forces the Lights-on variables in both modes and hides the toggle, motifs and theme names', () => {
    const print = css.slice(css.indexOf('@media print'), css.indexOf('@theme inline'));
    expect(print).toContain(`--sk-bg: ${PALETTES.on.bg};`);
    expect(print).toContain(`--sk-text: ${PALETTES.on.text};`);
    expect(print).not.toContain(PALETTES.off.bg);
    expect(print).toMatch(/:root\[data-lights='off'\]/);
    for (const hidden of ['[data-lights-toggle]', '[data-motif]', '[data-theme-name]']) expect(print).toContain(hidden);
  });
});
