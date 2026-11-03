// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_MS, STORAGE_KEY } from '@skeleton-key/ui';
import { App } from './App';

// The signature pass in PackCheck: the same behaviour as ScopeCheck, with PackCheck's own wording for the whisper.
let reduce = false;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  reduce = false;
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduced-motion') ? reduce : false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const start = (mode: 'off' | 'on' = 'off', reduced = false) => {
  localStorage.setItem(STORAGE_KEY, mode);
  reduce = reduced;
  return render(<App />);
};
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const needsReview = () => Number(within(screen.getByLabelText('Summary')).getByText('Needs review').nextElementSibling!.textContent);
const lit = () => document.querySelectorAll('[data-candle][data-lit="true"]').length;

describe('PackCheck signature pass', () => {
  it('one lit candle per item that needs review, equal to the summary count; none in Lights on or under reduced motion', () => {
    start();
    expect(needsReview()).toBeGreaterThan(0);
    expect(lit()).toBe(needsReview());
    cleanup();
    start('on');
    expect(document.querySelectorAll('[data-motif]')).toHaveLength(0);
    cleanup();
    start('off', true);
    expect(document.querySelectorAll('[data-candle]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Next finding' })).toBeTruthy(); // the function stays; the decoration goes
  });

  it('Next finding moves focus to the next open item and a pointer glides there', async () => {
    start();
    fireEvent.click(screen.getByRole('button', { name: 'Next finding' }));
    expect((document.activeElement as HTMLElement).id).toMatch(/^finding-/);
    await advance(400);
    expect(document.querySelector('[data-planchette][data-show]')).toBeTruthy();
  });

  it('the idle whisper uses PackCheck\'s own words, not ScopeCheck\'s', async () => {
    start();
    await advance(IDLE_MS + 100);
    const b = document.querySelector('[data-whisper] button')!;
    expect(b.textContent).toMatch(/^The pack is not at rest: .+\. Go there\.$/);
    expect(b.textContent).not.toMatch(/candle/i);
  });

  it('a confirmed difference marks its row for the glitch, and its evidence glows while the row is hovered', () => {
    start();
    const row = document.querySelector('tr[data-possessed="spec"]') as HTMLElement;
    expect(row).toBeTruthy();
    const id = row.querySelector('a[href^="#finding-"]')!.getAttribute('href')!.slice(1);
    const pair = document.getElementById(id)!.querySelector('[data-evidence-pair]')!;
    fireEvent.mouseEnter(row);
    expect(pair.hasAttribute('data-glow')).toBe(true);
    fireEvent.mouseLeave(row);
    expect(pair.hasAttribute('data-glow')).toBe(false);
  });

  it('Accept stamps a seal; fog sits behind the header', () => {
    start();
    fireEvent.click(screen.getByRole('button', { name: 'Next finding' }));
    const card = document.activeElement as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: /^Accept:/ }));
    expect(card.querySelector('[data-seal][data-stamp]')).toBeTruthy();
    expect((document.querySelector('header [data-fog]') as HTMLElement).style.zIndex).toBe('-1');
  });
});
