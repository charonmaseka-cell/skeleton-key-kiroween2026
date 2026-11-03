import { describe, expect, it } from 'vitest';
import { readStored, readSystem, resolveMode, STORAGE_KEY, watchSystem, writeStored, type SystemPrefs } from './lights';

const sys = (reducedMotion: boolean, moreContrast: boolean): SystemPrefs => ({ reducedMotion, moreContrast });

describe('resolveMode (HU-8)', () => {
  it('a stored choice always wins, including Lights on, whatever the system asks for', () => {
    for (const rm of [false, true]) for (const mc of [false, true]) {
      expect(resolveMode('on', sys(rm, mc))).toBe('on');
      expect(resolveMode('off', sys(rm, mc))).toBe('off'); // Lights off chosen on purpose stays off even under reduced motion
    }
  });
  it('with no stored choice: Lights off by default; Lights on under reduced motion or under prefers-contrast: more', () => {
    expect(resolveMode(null, sys(false, false))).toBe('off');
    expect(resolveMode(null, sys(true, false))).toBe('on');
    expect(resolveMode(null, sys(false, true))).toBe('on');
    expect(resolveMode(null, sys(true, true))).toBe('on');
  });
  it('anything else stored is ignored as if nothing were stored', () => {
    for (const bad of [undefined, '', 'ON', 'dark', 'true', 1, {}, ['on']]) {
      expect(resolveMode(bad, sys(false, false))).toBe('off');
      expect(resolveMode(bad, sys(false, true))).toBe('on');
    }
  });
});

describe('storage (a single on/off value; never throws)', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('writes exactly one key holding on or off, and reads it back', () => {
    const s = memory();
    expect(readStored(s)).toBeNull();
    expect(writeStored('on', s)).toBe(true);
    expect(writeStored('off', s)).toBe(true);
    expect([...s.m.entries()]).toEqual([[STORAGE_KEY, 'off']]);
    expect(readStored(s)).toBe('off');
  });
  it('a stored value that is not on or off reads as nothing', () => {
    const s = memory();
    s.m.set(STORAGE_KEY, 'sepia');
    expect(readStored(s)).toBeNull();
  });
  it('storage that throws (private mode) falls back to nothing stored, on read and on write', () => {
    const boom = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readStored(boom)).toBeNull();
    expect(writeStored('on', boom)).toBe(false);
    expect(writeStored('on', undefined)).toBe(false);
    expect(readStored(undefined)).toBeNull();
  });
});

describe('system settings', () => {
  const media = (matches: Record<string, boolean>) => {
    const listeners = new Set<() => void>();
    const fn = (q: string) => ({ matches: !!matches[q], addEventListener: (_t: 'change', l: () => void) => void listeners.add(l), removeEventListener: (_t: 'change', l: () => void) => void listeners.delete(l) });
    return { fn, listeners };
  };
  it('reads reduced motion and prefers-contrast: more from the two media queries', () => {
    expect(readSystem(media({ '(prefers-reduced-motion: reduce)': true }).fn)).toEqual({ reducedMotion: true, moreContrast: false });
    expect(readSystem(media({ '(prefers-contrast: more)': true }).fn)).toEqual({ reducedMotion: false, moreContrast: true });
    expect(readSystem(undefined)).toEqual({ reducedMotion: false, moreContrast: false });
  });
  it('watches both queries and unsubscribes', () => {
    const { fn, listeners } = media({});
    let n = 0;
    const stop = watchSystem(() => n++, fn);
    expect(listeners.size).toBe(1); // the same listener function registered on both queries
    [...listeners].forEach((l) => l());
    expect(n).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });
});
