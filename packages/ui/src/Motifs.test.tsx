// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';
import { EmptyState } from './Motifs';
import { STORAGE_KEY } from './lights';

beforeEach(() => localStorage.clear());
afterEach(cleanup);
const shell = () => render(<AppShell title="T" tagline="t" banner={<div />} announcement=""><EmptyState><p>None.</p></EmptyState></AppShell>);

describe('motifs (HU-2, HU-5, HU-9)', () => {
  it('Lights on has no decorative DOM except the brand mark', () => {
    localStorage.setItem(STORAGE_KEY, 'on');
    const { container } = shell();
    expect(container.querySelectorAll('[data-motif]').length).toBe(0);
    expect(container.querySelectorAll('[data-brand-mark]').length).toBe(1);
  });
  it('Lights off adds fog in the margins and a cobweb on the empty state; all decoration is hidden from assistive technology and ignores the pointer', () => {
    localStorage.setItem(STORAGE_KEY, 'off');
    const { container } = shell();
    const motifs = [...container.querySelectorAll('[data-motif]')];
    expect(motifs.map((m) => m.getAttribute('data-motif')).sort()).toEqual(['cobweb', 'fog', 'fog']);
    for (const m of motifs) {
      expect(m.getAttribute('aria-hidden')).toBe('true');
      expect(m.textContent).toBe('');
      expect(m.getAttribute('class')).toMatch(/pointer-events-none/);
    }
    expect(container.querySelector('[data-brand-mark]')!.getAttribute('aria-hidden')).toBe('true');
  });
  it('switching to Lights on removes the motifs at once', async () => {
    localStorage.setItem(STORAGE_KEY, 'off');
    const { container } = shell();
    expect(container.querySelectorAll('[data-motif]').length).toBe(3);
    await userEvent.setup().click(container.querySelector('[data-lights-toggle]')!);
    expect(container.querySelectorAll('[data-motif]').length).toBe(0);
  });
  it('the empty-state text keeps its own space beside the cobweb', () => {
    localStorage.setItem(STORAGE_KEY, 'off');
    const { container } = shell();
    expect(container.querySelector('[data-motif="cobweb"]')!.parentElement!.className).toMatch(/pr-12/);
  });
});
