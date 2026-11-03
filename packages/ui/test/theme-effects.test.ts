import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTES, contrastRatio } from '../src/theme-tokens';

// HU-T3/T4: the effects stylesheet. Contrast is measured on the RENDERED colour (the translucent ghost fill composited over the page
// and over a card), not on the token. The flicker runs only in Lights off and never under reduced motion.
const css = readFileSync(new URL('../src/effects.css', import.meta.url), 'utf8');
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
const mix = (fg: string, alpha: number, over: string) => toHex(hex(fg).map((v, i) => v * alpha + hex(over)[i]! * (1 - alpha)));

describe('ghost fill contrast (design section 7)', () => {
  for (const mode of ['on', 'off'] as const) {
    const p = PALETTES[mode];
    for (const over of ['bg', 'surface'] as const) {
      it(`Lights ${mode}: text on the ghost fill over ${over} is at least 4.5:1, and the dashed boundary at least 3:1`, () => {
        const fill = mix(p.danger, 0.35, p[over]);
        expect(contrastRatio(p.text, fill)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.danger, p[over])).toBeGreaterThanOrEqual(3);
      });
    }
  }
  it('the stylesheet uses 35 percent, the figure that was measured', () => expect(css).toMatch(/color-mix\(in srgb, var\(--sk-danger\) 35%, var\(--sk-bg\)\)/));
});

describe('effects are guarded (HU-5)', () => {
  it('the ghost flicker is applied only in Lights off and is switched off under reduced motion', () => {
    const uses = [...css.matchAll(/([^{}]+)\{[^{}]*animation:\s*ghost-flicker[^{}]*\}/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const m of uses) expect(m[1]).toMatch(/data-lights='off'/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
  });
  it('the flicker runs once, lasts under a second and dips at most twice (under 3 flashes per second)', () => {
    expect(css).toMatch(/animation: ghost-flicker 0\.9s 1;/);
    const kf = css.match(/@keyframes ghost-flicker \{([\s\S]*?)\n\}/)![1]!;
    const dips = [...kf.matchAll(/opacity:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
    let down = 0;
    for (let i = 1; i < dips.length; i++) if (dips[i]! < dips[i - 1]!) down++;
    expect(down).toBeLessThanOrEqual(2);
  });
  it('the possessed boundary changes the outline only, never text', () => {
    const block = css.match(/\[data-possessed\]:hover[\s\S]*?\}/)![0];
    expect(block).not.toMatch(/color:|font|text-/);
  });
});
