import type { Mode } from './theme-tokens';

// Lights on / Lights off: which mode applies (haunted-ui HU-8, design section 3). Pure functions plus thin browser adapters.

export const STORAGE_KEY = 'skeleton-key-lights';

/** What the system asks for. Read from matchMedia; not stored. */
export type SystemPrefs = { reducedMotion: boolean; moreContrast: boolean };

/**
 * A stored choice ('on' or 'off') always wins and is remembered. With no (valid) stored choice: Lights on when the system asks for
 * reduced motion or more contrast; otherwise Lights off.
 */
export function resolveMode(stored: unknown, system: SystemPrefs): Mode {
  if (stored === 'on' || stored === 'off') return stored;
  return system.reducedMotion || system.moreContrast ? 'on' : 'off';
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const browserStorage = (): StorageLike | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage; // reading the property can itself throw
  } catch {
    return undefined;
  }
};

/** The stored choice, or null (nothing stored, something else stored, or storage unavailable). Never throws. */
export function readStored(storage: StorageLike | undefined = browserStorage()): Mode | null {
  try {
    const v = storage?.getItem(STORAGE_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

/** Remember a choice made with the toggle: a single 'on' or 'off', nothing else. Returns false when storage is unavailable. Never throws. */
export function writeStored(mode: Mode, storage: StorageLike | undefined = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

type MediaLike = (query: string) => { matches: boolean; addEventListener?: (t: 'change', l: () => void) => void; removeEventListener?: (t: 'change', l: () => void) => void; addListener?: (l: () => void) => void; removeListener?: (l: () => void) => void };
const browserMedia = (): MediaLike | undefined => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? (window.matchMedia.bind(window) as MediaLike) : undefined);

export const readSystem = (media: MediaLike | undefined = browserMedia()): SystemPrefs => ({
  reducedMotion: !!media?.('(prefers-reduced-motion: reduce)').matches,
  moreContrast: !!media?.('(prefers-contrast: more)').matches,
});

/** Calls `onChange` when either setting changes; returns the unsubscribe function. */
export function watchSystem(onChange: () => void, media: MediaLike | undefined = browserMedia()): () => void {
  if (!media) return () => undefined;
  const lists = ['(prefers-reduced-motion: reduce)', '(prefers-contrast: more)'].map((q) => media(q));
  for (const l of lists) {
    if (l.addEventListener) l.addEventListener('change', onChange);
    else l.addListener?.(onChange);
  }
  return () => {
    for (const l of lists) {
      if (l.removeEventListener) l.removeEventListener('change', onChange);
      else l.removeListener?.(onChange);
    }
  };
}
