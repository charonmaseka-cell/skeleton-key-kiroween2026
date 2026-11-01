import { describe, expect, it } from 'vitest';
import { contrastRatio, PALETTES, REQUIRED_PAIRS, type Mode } from './theme-tokens';

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

  it('the two modes are genuinely different (dark versus light)', () => {
    expect(PALETTES.off.bg).not.toBe(PALETTES.on.bg);
    expect(contrastRatio(PALETTES.off.bg, '#000000')).toBeLessThan(contrastRatio(PALETTES.on.bg, '#000000'));
  });
});
