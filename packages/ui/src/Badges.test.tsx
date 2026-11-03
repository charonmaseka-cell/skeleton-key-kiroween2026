// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BADGE_KINDS, SampleBanner, LiveBanner, StatusBadge, badgeShapeKey } from './Badges';

describe('state language (HU-6)', () => {
  it('every state has its own icon shape and its own text, so states differ without colour', () => {
    const shapes = BADGE_KINDS.map(badgeShapeKey);
    expect(new Set(shapes).size).toBe(BADGE_KINDS.length);
    const texts = BADGE_KINDS.map((k) => {
      const { container, unmount } = render(<StatusBadge kind={k} />);
      const t = container.textContent;
      unmount();
      return t;
    });
    expect(new Set(texts).size).toBe(BADGE_KINDS.length);
  });
  it('the icon is decorative and the text names the state', () => {
    const { container } = render(<StatusBadge kind="needs_review" />);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Needs review')).toBeTruthy();
  });
  it('the sample and live banners are present and labelled in both modes', () => {
    for (const mode of ['on', 'off']) {
      document.documentElement.setAttribute('data-lights', mode);
      const a = render(<SampleBanner note="n" />);
      expect(screen.getByRole('region', { name: 'Sample mode' })).toBeTruthy();
      a.unmount();
      const b = render(<LiveBanner note="n" />);
      expect(screen.getByRole('region', { name: 'Live mode' })).toBeTruthy();
      b.unmount();
    }
  });
});
