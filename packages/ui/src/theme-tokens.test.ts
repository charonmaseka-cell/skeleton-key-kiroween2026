import { describe, expect, it } from 'vitest';
import { contrastRatio, PALETTES, REQUIRED_PAIRS, type Mode } from './theme-tokens';

/** Hue in degrees of #rrggbb. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('haunted interface palettes (both modes keep AA contrast)', () => {
  it('the contrast function matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  for (const mode of ['off', 'on'] as Mode[]) {
    it(`Lights ${mode}: every text pair is at least 4.5:1 and every boundary or focus pair at least 3:1`, () => {
      const p = PALETTES[mode];
      for (const pair of REQUIRED_PAIRS) {
        expect(contrastRatio(p[pair.fg], p[pair.bg]), `${mode}: ${pair.what}`).toBeGreaterThanOrEqual(pair.min);
      }
    });
  }

  it('ectoplasm is the focus ring, passes AA as text and as a ring in both modes, and is a different colour from every state colour', () => {
    for (const mode of ['off', 'on'] as Mode[]) {
      const p = PALETTES[mode];
      expect(p.focus).toBe(p.ecto);
      for (const bg of [p.bg, p.surface]) {
        expect(contrastRatio(p.ecto, bg), `${mode} ecto text`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.focus, bg), `${mode} focus ring`).toBeGreaterThanOrEqual(3);
      }
      for (const state of ['accent', 'danger', 'ok', 'info', 'link'] as const) expect(hue(p.ecto), `${mode} ecto vs ${state}`).not.toBeCloseTo(hue(p[state]), -1);
      // hue distance from the validated green is at least 25 degrees, so the brand colour is not read as "validated"
      const d = Math.abs(hue(p.ecto) - hue(p.ok));
      expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(25);
    }
  });

  it('the two modes are genuinely different (dark versus light)', () => {
    expect(PALETTES.off.bg).not.toBe(PALETTES.on.bg);
    expect(contrastRatio(PALETTES.off.bg, '#000000')).toBeLessThan(contrastRatio(PALETTES.on.bg, '#000000'));
  });
});
