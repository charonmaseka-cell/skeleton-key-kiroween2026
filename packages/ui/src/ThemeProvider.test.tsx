// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';
import { STORAGE_KEY } from './lights';

type Mq = { matches: boolean; listeners: Set<() => void> };
let mq: Record<string, Mq>;
const setMedia = (q: string, matches: boolean) => {
  mq[q]!.matches = matches;
  act(() => mq[q]!.listeners.forEach((l) => l()));
};
const RM = '(prefers-reduced-motion: reduce)';
const MC = '(prefers-contrast: more)';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-lights');
  mq = { [RM]: { matches: false, listeners: new Set() }, [MC]: { matches: false, listeners: new Set() } };
  window.matchMedia = ((q: string) => ({
    get matches() { return mq[q]?.matches ?? false; },
    addEventListener: (_t: string, l: () => void) => void mq[q]?.listeners.add(l),
    removeEventListener: (_t: string, l: () => void) => void mq[q]?.listeners.delete(l),
  })) as never;
});
afterEach(cleanup);

const shell = () => render(<AppShell title="T" tagline="x" announcement="">content</AppShell>);
const lights = () => document.documentElement.getAttribute('data-lights');

describe('mode toggle and ThemeProvider (HU-3, HU-8)', () => {
  it('with nothing stored the page starts in Lights off, and the toggle offers Lights on', () => {
    shell();
    expect(lights()).toBe('off');
    const b = screen.getByRole('button', { name: 'Lights on' });
    expect(b.getAttribute('aria-pressed')).toBe('false');
  });

  it('is a real button, the first control after the skip link, inside the header', async () => {
    const user = userEvent.setup();
    shell();
    const b = screen.getByRole('button', { name: 'Lights on' });
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('type')).toBe('button');
    expect(b.closest('header')).toBeTruthy();
    expect(b.closest('header')!.firstElementChild).toBe(b);
    await user.tab();
    expect(document.activeElement?.textContent).toBe('Skip to main content');
    await user.tab();
    expect(document.activeElement).toBe(b);
  });

  it('switching changes the label, aria-pressed and data-lights, remembers the single value, announces politely, and does not move focus', async () => {
    const user = userEvent.setup();
    shell();
    const b = screen.getByRole('button', { name: 'Lights on' });
    b.focus();
    await user.keyboard('{Enter}');
    expect(lights()).toBe('on');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('on');
    expect(document.activeElement).toBe(b);
    expect(b.textContent).toBe('Lights on');
    expect(b.querySelector('svg')!.getAttribute('data-lights-icon')).toBe('on');
    expect(b.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(b.getAttribute('aria-pressed')).toBe('true');
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Lights on');
    await user.keyboard(' ');
    expect(lights()).toBe('off');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('off');
    expect(document.activeElement).toBe(b);
    expect(live.textContent).toBe('Lights off');
    expect(b.textContent).toBe('Lights on');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.querySelector('svg')!.getAttribute('data-lights-icon')).toBe('off');
    expect(localStorage.length).toBe(1);
  });

  it('a remembered choice wins on the next load, including Lights on, and Lights off even under reduced motion', () => {
    localStorage.setItem(STORAGE_KEY, 'on');
    shell();
    expect(lights()).toBe('on');
    cleanup();
    localStorage.setItem(STORAGE_KEY, 'off');
    mq[RM]!.matches = true;
    shell();
    expect(lights()).toBe('off');
  });

  it('with nothing stored, reduced motion or prefers-contrast: more gives Lights on, and the page follows the system while nothing is stored', () => {
    mq[RM]!.matches = true;
    shell();
    expect(lights()).toBe('on');
    setMedia(RM, false);
    expect(lights()).toBe('off');
    setMedia(MC, true);
    expect(lights()).toBe('on');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); // the automatic choice is never stored
  });

  it('after a choice with the toggle, a later system change no longer overrides it', async () => {
    const user = userEvent.setup();
    shell();
    await user.click(screen.getByRole('button', { name: 'Lights on' }));
    setMedia(RM, true);
    setMedia(RM, false);
    expect(lights()).toBe('on');
  });

  it('storage that throws: the page still works, the choice holds for the session, nothing is stored', async () => {
    const user = userEvent.setup();
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = () => { throw new Error('denied'); };
    Storage.prototype.setItem = () => { throw new Error('denied'); };
    try {
      shell();
      expect(lights()).toBe('off');
      await user.click(screen.getByRole('button', { name: 'Lights on' }));
      expect(lights()).toBe('on');
    } finally {
      Storage.prototype.getItem = get;
      Storage.prototype.setItem = set;
    }
  });

  it('a later announcement from the page replaces the toggle message in the live region', () => {
    const { rerender } = shell();
    act(() => screen.getByRole('button', { name: 'Lights on' }).click());
    expect(screen.getByRole('status').textContent).toBe('Lights on');
    rerender(<AppShell title="T" tagline="x" announcement="Decision saved: accepted.">content</AppShell>);
    expect(screen.getByRole('status').textContent).toBe('Decision saved: accepted.');
  });
});
