// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOO_COOLDOWN_MS, BOO_MS, FLICKER_MS, IDLE_MS, INK_MS, SNUFF_MS, STORAGE_KEY } from '@skeleton-key/ui';
import { App } from './App';
import { FIXTURES } from './fixtures';

// The signature pass (HU-17 to HU-27) in the full ScopeCheck page. jsdom has no animation, so what is checked is what the page does
// (counts, focus, attributes, timing, what is rendered or not), not how it looks; the look is checked in the browser script.

let reduce = false;
const css = () => readFileSync(resolve(process.cwd(), 'packages/ui/src/effects.css'), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
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

const start = (mode: 'off' | 'on' = 'off', opts: { reduced?: boolean } = {}) => {
  localStorage.setItem(STORAGE_KEY, mode);
  reduce = !!opts.reduced;
  return render(<App />);
};
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const needsReview = () => Number(within(screen.getByLabelText('Summary')).getByText('Needs review').nextElementSibling!.textContent);
const lit = () => document.querySelectorAll('[data-candle][data-lit="true"]').length;
const unlit = () => document.querySelectorAll('[data-candle][data-lit="false"]').length;
const buttonNames = () => [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent).sort();
const confirmCoverage = (doc: 'quote-a' | 'quote-b') => {
  const title = doc === 'quote-a' ? /Hydro-Lab Supplies/ : /Delta Field Instruments/;
  const sum = [...document.querySelectorAll('summary')].find((s) => s.id === `doc-sum-${doc}`)!;
  fireEvent.click(sum);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`confirm coverage of .*${title.source}`) }));
};

describe('HU-17 candles', () => {
  it('one lit candle per item that needs review, equal to the summary count', () => {
    start();
    expect(needsReview()).toBeGreaterThan(0);
    expect(lit()).toBe(needsReview());
    expect(document.querySelector('[data-candles]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('when an item stops needing review its candle is snuffed with a wisp of smoke, then goes; the lit count follows the summary at every step', async () => {
    start();
    const before = needsReview();
    confirmCoverage('quote-b'); // SP-5302: Needs review -> Confirmed
    expect(needsReview()).toBe(before - 1);
    expect(lit()).toBe(before - 1);
    expect(unlit()).toBe(1);
    expect(document.querySelectorAll('[data-candle][data-lit="false"] [data-smoke]')).toHaveLength(1);
    await advance(SNUFF_MS + 50);
    expect(unlit()).toBe(0);
    expect(document.querySelectorAll('[data-candle]')).toHaveLength(before - 1);
    expect(lit()).toBe(needsReview());
  });

  it('is exact on every sample set', () => {
    start();
    for (const f of FIXTURES) {
      fireEvent.change(screen.getByLabelText('Choose a sample set'), { target: { value: f.id } });
      expect(lit()).toBe(needsReview());
    }
  });
});

describe('HU-18 planchette', () => {
  it('Next finding moves focus to the next open item that needs review, in page order, wrapping round; a pointer glides there', async () => {
    start();
    const ids: string[] = [];
    const total = lit();
    for (let i = 0; i < total; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Next finding' }));
      const a = document.activeElement as HTMLElement;
      expect(a.tagName).toBe('ARTICLE');
      expect(a.id).toMatch(/^finding-/);
      ids.push(a.id);
    }
    expect(new Set(ids).size).toBe(total);
    fireEvent.click(screen.getByRole('button', { name: 'Next finding' }));
    expect((document.activeElement as HTMLElement).id).toBe(ids[0]); // wraps round
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    await advance(400);
    const p = document.querySelector('[data-planchette]')!;
    expect(p.getAttribute('aria-hidden')).toBe('true');
    expect(p.hasAttribute('data-show')).toBe(true);
    await advance(1700);
    expect(document.querySelector('[data-planchette]')!.hasAttribute('data-show')).toBe(false); // fades after the glide and a short dwell
    fireEvent.click(screen.getByRole('button', { name: 'Next finding' }));
    await advance(400);
    expect(document.querySelector('[data-planchette]')!.hasAttribute('data-show')).toBe(true);
    fireEvent.pointerDown(window);
    expect(document.querySelector('[data-planchette]')!.hasAttribute('data-show')).toBe(false); // and goes at the next click or key
  });

  it('skips items already decided, and the button goes when nothing is left open', () => {
    start();
    let guard = 0;
    while (screen.queryByRole('button', { name: 'Next finding' }) && guard++ < 40) {
      fireEvent.click(screen.getByRole('button', { name: 'Next finding' }));
      const card = document.activeElement as HTMLElement;
      fireEvent.click(within(card).getAllByRole('button', { name: /^Dismiss:/ })[0]!);
    }
    expect(guard).toBeLessThan(40);
    expect(screen.queryByRole('button', { name: 'Next finding' })).toBeNull();
    expect(lit()).toBe(needsReview()); // dismissing does not change the Needs review count, so neither does the candle count
  });

  it('with effects off the button works the same (focus moves) and there is no pointer', () => {
    start('on');
    fireEvent.click(screen.getByRole('button', { name: 'Next finding' }));
    expect((document.activeElement as HTMLElement).id).toMatch(/^finding-/);
    expect(document.querySelector('[data-planchette]')).toBeNull();
  });
});

describe('HU-19 idle whisper', () => {
  it('after 45 s with no input one polite line names the next item, is a link to it, and never comes again', async () => {
    start();
    const line = document.querySelector('[data-whisper]')!;
    expect(line.getAttribute('aria-live')).toBe('polite');
    expect(line.textContent).toBe('');
    await advance(IDLE_MS - 1000);
    expect(line.textContent).toBe('');
    await advance(1100);
    const b = within(line as HTMLElement).getByRole('button');
    expect(b.textContent).toMatch(/^A candle still burns: .+\. Go there\.$/);
    fireEvent.click(b);
    expect((document.activeElement as HTMLElement).id).toMatch(/^finding-/);
    await advance(30_000);
    expect(line.textContent).toBe('');
    await advance(IDLE_MS * 3);
    expect(line.textContent).toBe(''); // at most once per session
  });

  it('is put off by any input', async () => {
    start();
    await advance(IDLE_MS - 5000);
    fireEvent.pointerMove(window);
    await advance(IDLE_MS - 5000);
    expect(document.querySelector('[data-whisper]')!.textContent).toBe('');
    fireEvent.keyDown(window, { key: 'x' });
    await advance(IDLE_MS - 1000);
    expect(document.querySelector('[data-whisper]')!.textContent).toBe('');
  });

  it('never speaks while the correction editor is open, and speaks in the next quiet stretch after it closes', async () => {
    start();
    fireEvent.click(screen.getAllByRole('button', { name: /^Correct this value/ })[0]!);
    expect(document.querySelector('form[aria-label^="Correct "]')).toBeTruthy();
    await advance(IDLE_MS * 3);
    expect(document.querySelector('[data-whisper]')!.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    (document.activeElement as HTMLElement | null)?.blur();
    await advance(IDLE_MS + 100);
    expect(document.querySelector('[data-whisper] button')).toBeTruthy();
  });

  it('is silent with effects off', async () => {
    start('on');
    await advance(IDLE_MS * 3);
    expect(document.querySelector('[data-whisper]')!.textContent).toBe('');
  });
});

describe('HU-20 possessed hover and focus', () => {
  const cell = () => document.querySelector('td[data-possessed="spec"]') as HTMLElement;
  const evidence = () => document.getElementById(cell().querySelector('a[href^="#finding-"]')!.getAttribute('href')!.slice(1))!.querySelector('[data-evidence-pair]')!;

  it('marks spec-mismatch cells for the glitch, and the two evidence lines of its finding glow while it is hovered or focused', () => {
    start();
    expect(cell()).toBeTruthy();
    expect(evidence().hasAttribute('data-glow')).toBe(false);
    expect(evidence().querySelectorAll('figure').length).toBeGreaterThanOrEqual(2);
    fireEvent.mouseEnter(cell());
    expect(evidence().hasAttribute('data-glow')).toBe(true);
    fireEvent.mouseLeave(cell());
    expect(evidence().hasAttribute('data-glow')).toBe(false);
    fireEvent.focusIn(cell());
    expect(evidence().hasAttribute('data-glow')).toBe(true);
    fireEvent.focusOut(cell());
    expect(evidence().hasAttribute('data-glow')).toBe(false);
  });

  it('a quantity difference keeps the plain possessed border without the glitch', () => {
    start();
    const plain = [...document.querySelectorAll('td[data-possessed]')].filter((t) => t.getAttribute('data-possessed') === '');
    expect(plain.length).toBeGreaterThan(0);
  });
});

describe('HU-22 wax seal and ghostly fade', () => {
  const firstCard = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Next finding' }));
    return document.activeElement as HTMLElement;
  };

  it('Accept stamps a seal once and it stays while accepted; Reopen takes it away', async () => {
    start();
    const card = firstCard();
    expect(card.querySelector('[data-seal]')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /^Accept:/ }));
    const seal = card.querySelector('[data-seal]')!;
    expect(seal.hasAttribute('data-stamp')).toBe(true);
    expect(seal.getAttribute('aria-hidden')).toBe('true');
    await advance(2000);
    expect(card.querySelector('[data-seal]')!.hasAttribute('data-stamp')).toBe(false);
    fireEvent.click(within(card).getByRole('button', { name: /^Reopen:/ }));
    expect(card.querySelector('[data-seal]')).toBeNull();
  });

  it('Dismiss fades a ghost out once; the card stays in the queue and Reopen restores it', async () => {
    start();
    const card = firstCard();
    const id = card.id;
    fireEvent.click(within(card).getByRole('button', { name: /^Dismiss:/ }));
    expect(card.hasAttribute('data-dismissed')).toBe(true);
    expect(card.querySelector('[data-fade-ghost]')).toBeTruthy();
    await advance(2000);
    expect(card.querySelector('[data-fade-ghost]')).toBeNull();
    expect(document.getElementById(id)).toBe(card);
    expect(within(card).getByRole('button', { name: /^Reopen:/ })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /^Reopen:/ }));
    expect(card.hasAttribute('data-dismissed')).toBe(false);
  });

  it('a card that arrives already decided does not stamp or fade (nothing happens on arrival)', () => {
    start();
    const card = firstCard();
    fireEvent.click(within(card).getByRole('button', { name: /^Accept:/ }));
    fireEvent.change(screen.getByLabelText('Choose a sample set'), { target: { value: 'scopecheck-standard' } });
    fireEvent.change(screen.getByLabelText('Choose a sample set'), { target: { value: 'scopecheck-fulllength' } });
    expect(document.querySelector('[data-seal][data-stamp]')).toBeNull();
  });

  it('nothing is drawn with effects off, and the decision still works', () => {
    start('on');
    const card = firstCard();
    fireEvent.click(within(card).getByRole('button', { name: /^Accept:/ }));
    expect(document.querySelector('[data-seal]')).toBeNull();
    expect(within(card).getByText('Accepted')).toBeTruthy();
  });
});

describe('HU-23 ink drip', () => {
  it('runs once when a critical finding becomes confirmed, not for those already confirmed, not again for the same one, and goes', async () => {
    start();
    expect(document.querySelector('[data-ink]')).toBeNull(); // the set opened with confirmed findings: no drip
    confirmCoverage('quote-b'); // SP-5302 (critical) is now confirmed
    expect(document.querySelectorAll('[data-ink]')).toHaveLength(1);
    expect(document.querySelector('[data-ink]')!.getAttribute('aria-hidden')).toBe('true');
    await advance(INK_MS + 100);
    expect(document.querySelector('[data-ink]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Withdraw my coverage confirmation for .*Delta Field Instruments/ }));
    confirmCoverage('quote-b');
    expect(document.querySelector('[data-ink]')).toBeNull(); // the same finding: once
  });

  it('does not run when the coverage confirmed changes nothing critical, nor when another set is opened', () => {
    start();
    confirmCoverage('quote-a'); // FD-4215 and CL-6401 stay Needs review
    expect(document.querySelector('[data-ink]')).toBeNull();
    fireEvent.change(screen.getByLabelText('Choose a sample set'), { target: { value: 'scopecheck-standard' } });
    expect(document.querySelector('[data-ink]')).toBeNull();
  });

  it('is not red: ink and ectoplasm only (the stylesheet)', () => {
    const sheet = css();
    const ink = stripComments(sheet.slice(sheet.indexOf('HU-23 ink drip'), sheet.indexOf('HU-24 fog')));
    expect(ink).not.toMatch(/danger|\bred\b|#f00\b|#ff0000\b/i);
    expect(ink).toMatch(/--sk-ecto/);
  });
});

describe('HU-24 fog and mist', () => {
  it('fog sits behind the header (negative z-index, no text, hidden from assistive technology)', () => {
    start();
    const fog = document.querySelector('header [data-fog]') as HTMLElement;
    expect(fog.getAttribute('aria-hidden')).toBe('true');
    expect(fog.style.zIndex).toBe('-1');
    expect(fog.textContent).toBe('');
  });

  it('mist puffs follow the pointer, at most ten at a time, behind the page, and remove themselves', async () => {
    start();
    const host = document.querySelector('[data-motif="mist"]') as HTMLElement;
    expect(host.style.zIndex).toBe('-1');
    for (let i = 0; i < 15; i++) {
      await advance(50);
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10 * i, clientY: 20 }));
    }
    expect(host.childElementCount).toBeGreaterThan(0);
    expect(host.childElementCount).toBeLessThanOrEqual(10);
    host.firstElementChild!.dispatchEvent(new Event('animationend'));
    expect(host.childElementCount).toBeLessThanOrEqual(9);
  });

  it('touch does not leave a trail, and Lights on has neither fog nor mist', async () => {
    start();
    const host = document.querySelector('[data-motif="mist"]') as HTMLElement;
    const ev = new MouseEvent('pointermove', { clientX: 5, clientY: 5 });
    Object.defineProperty(ev, 'pointerType', { value: 'touch' });
    await advance(50);
    window.dispatchEvent(ev);
    expect(host.childElementCount).toBe(0);
    cleanup();
    start('on');
    expect(document.querySelector('[data-fog], [data-motif="mist"]')).toBeNull();
  });
});

describe('HU-25 Lights flicker', () => {
  it('Lights on flickers twice first (overlay), then applies; focus stays on the button', async () => {
    start();
    const b = screen.getByRole('button', { name: 'Lights on' });
    b.focus();
    fireEvent.click(b);
    expect(document.documentElement.getAttribute('data-lights')).toBe('off');
    expect(document.querySelector('[data-lights-flicker]')).toBeTruthy();
    expect(document.querySelector('[data-lights-flicker]')!.getAttribute('aria-hidden')).toBe('true');
    await advance(FLICKER_MS - 50);
    expect(document.documentElement.getAttribute('data-lights')).toBe('off');
    await advance(100);
    expect(document.documentElement.getAttribute('data-lights')).toBe('on');
    expect(document.querySelector('[data-lights-flicker]')).toBeNull();
    expect(document.activeElement).toBe(b);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('on');
  });

  it('the flicker is two dips in under a second (under three flashes a second)', () => {
    const sheet = css();
    const kf = sheet.match(/@keyframes lights-flicker \{([^}]*(?:\}[^}]*)*?)\}\n/)![1]!;
    const peaks = [...kf.matchAll(/(\d+)% \{ opacity: ([0-9.]+); \}/g)].map((m) => Number(m[2]));
    let flashes = 0;
    for (let i = 1; i < peaks.length; i++) if (peaks[i]! > 0 && peaks[i - 1] === 0) flashes++;
    expect(flashes).toBe(2);
    expect(FLICKER_MS).toBeLessThanOrEqual(1000);
    expect(flashes / (FLICKER_MS / 1000)).toBeLessThan(3);
  });

  it('under reduced motion, and from Lights on to Lights off, it applies at once', () => {
    start('off', { reduced: true });
    fireEvent.click(screen.getByRole('button', { name: 'Lights on' }));
    expect(document.documentElement.getAttribute('data-lights')).toBe('on');
    expect(document.querySelector('[data-lights-flicker]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lights on' }));
    expect(document.documentElement.getAttribute('data-lights')).toBe('off');
  });
});

describe('HU-26 easter egg', () => {
  const type = (s: string, target: Element | Window = window) => {
    for (const k of s) fireEvent.keyDown(target, { key: k });
  };

  it('typing "boo" shows the ghosts behind the page for about two and a half seconds, then they go', async () => {
    start();
    expect(document.querySelector('[data-boo]')).toBeNull();
    type('boo');
    const boo = document.querySelector('[data-boo]') as HTMLElement;
    expect(boo.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3);
    expect(boo.getAttribute('aria-hidden')).toBe('true');
    expect(boo.style.zIndex).toBe('-1');
    await advance(BOO_MS + 50);
    expect(document.querySelector('[data-boo]')).toBeNull();
  });

  it('at most once every five seconds, and nothing else triggers it', async () => {
    start();
    type('boo');
    await advance(BOO_MS + 50);
    type('boo');
    expect(document.querySelector('[data-boo]')).toBeNull();
    await advance(BOO_COOLDOWN_MS);
    type('bxoo');
    type('obo'); // the stream "bxooobo" has no "boo" in it
    expect(document.querySelector('[data-boo]')).toBeNull();
    type('boo');
    expect(document.querySelector('[data-boo]')).toBeTruthy();
  });

  it('is ignored in a text field, in the correction editor, and with a modifier key', () => {
    start();
    const note = document.querySelector('input[id]:not([type=file])') as HTMLInputElement;
    type('boo', note);
    expect(document.querySelector('[data-boo]')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /^Correct this value/ })[0]!);
    const field = document.querySelector('form[aria-label^="Correct "] input') as HTMLInputElement;
    type('boo', field);
    expect(document.querySelector('[data-boo]')).toBeNull();
    for (const k of 'boo') fireEvent.keyDown(window, { key: k, ctrlKey: true });
    expect(document.querySelector('[data-boo]')).toBeNull();
  });

  it('does nothing with effects off', () => {
    start('on');
    type('boo');
    expect(document.querySelector('[data-boo]')).toBeNull();
  });
});

describe('rules for all of them (HU-27)', () => {
  it('Lights on and reduced motion draw no decoration and no animation hook, and the page keeps the same controls', () => {
    start();
    const withEffects = buttonNames().filter((n) => n !== 'Lights on');
    cleanup();
    start('on');
    expect(document.querySelectorAll('[data-motif]')).toHaveLength(0);
    expect(document.documentElement.getAttribute('data-effects')).toBe('off');
    expect(buttonNames().filter((n) => n !== 'Lights on')).toEqual(withEffects);
    cleanup();
    start('off', { reduced: true });
    expect(document.documentElement.getAttribute('data-lights')).toBe('off');
    expect(document.documentElement.getAttribute('data-effects')).toBe('off');
    expect([...document.querySelectorAll('[data-motif]')].map((m) => m.getAttribute('data-motif')).filter((m) => m !== 'fog')).toEqual(['fog'].slice(1));
    expect(buttonNames().filter((n) => n !== 'Lights on')).toEqual(withEffects);
  });

  it('every decorative element is hidden from assistive technology, ignores the pointer, and carries no text', async () => {
    start();
    confirmCoverage('quote-b');
    fireEvent.click(screen.getByRole('button', { name: 'Next finding' }));
    const card = document.activeElement as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: /^Accept:/ }));
    for (const k of 'boo') fireEvent.keyDown(window, { key: k });
    await advance(60);
    const deco = [...document.querySelectorAll('[data-motif]')];
    expect(deco.length).toBeGreaterThanOrEqual(6);
    for (const d of deco) {
      expect(d.getAttribute('aria-hidden'), d.getAttribute('data-motif')!).toBe('true');
      expect(d.textContent).toBe('');
      expect(`${d.getAttribute('class')}`, d.getAttribute('data-motif')!).toMatch(/pointer-events-none/);
    }
  });

  it('no sound and no red anywhere in the effects', () => {
    const signature = css().slice(css().indexOf('The signature pass')).replace(/^[\s\S]*?\*\//, ''); // from after the heading comment; // the ghost row's status tint (HU-11) is older and is not decoration
    const files = stripComments([readFileSync(resolve(process.cwd(), 'packages/ui/src/Haunt.tsx'), 'utf8'), signature].join('\n'));
    expect(files).not.toMatch(/<audio|new Audio|AudioContext|\.mp3|\.wav|\.ogg/);
    expect(files).not.toMatch(/\bred\b|crimson|--sk-danger|#f00\b|#ff0000\b|#dc143c\b|#b22222\b|#8b0000\b/i);
  });
});

