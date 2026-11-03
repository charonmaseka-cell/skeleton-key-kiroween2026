import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThemeEntry } from './session-core';
import { readStored, readSystem, resolveMode, watchSystem, writeStored } from './lights';
import type { Mode } from './theme-tokens';

type LightsValue = {
  mode: Mode;
  toggle: () => void;
  /** text for the polite live region after a toggle; '' otherwise */
  announcement: string;
  /**
   * Animated effects (haunted-ui HU-17 to HU-27) run only when this is true: Lights off AND the system does not ask for reduced motion
   * (and the browser can tell: without matchMedia nothing animates). The same switch is `<html data-effects>` for the stylesheet.
   */
  effects: boolean;
};
const LightsContext = createContext<LightsValue>({ mode: 'on', toggle: () => undefined, announcement: '', effects: false });

/** How long the page flickers before Lights on applies (two dips, under 3 flashes a second). */
export const FLICKER_MS = 800;

/** The resolved mode and the toggle. Outside a ThemeProvider: Lights on, and the toggle does nothing. */
export const useLights = () => useContext(LightsContext);

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Holds the resolved mode (stored choice, else the system setting, else Lights off), sets `<html data-lights>` before paint, and follows
 * the system setting while nothing is stored. The automatic result is never stored; only a choice made with the toggle is. It never
 * moves focus.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState(() => readStored());
  const [system, setSystem] = useState(() => readSystem());
  const [announcement, setAnnouncement] = useState('');
  const [flickering, setFlickering] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mode = resolveMode(stored, system);
  const canTellMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const effects = mode === 'off' && canTellMotion && !system.reducedMotion;

  useEffect(() => watchSystem(() => setSystem(readSystem())), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useIsoLayoutEffect(() => {
    document.documentElement.setAttribute('data-lights', mode);
    document.documentElement.setAttribute('data-effects', effects ? 'on' : 'off');
  }, [mode, effects]);

  const apply = useCallback((next: Mode) => {
    writeStored(next); // if storage is unavailable the choice still holds for this session
    setStored(next);
    setAnnouncement(next === 'on' ? 'Lights on' : 'Lights off');
  }, []);

  const toggle = useCallback(() => {
    if (flickering) return;
    if (mode === 'off' && effects) {
      // HU-25: the lights flicker twice, then Lights on applies. Focus does not move; the mode changes after the flicker.
      setFlickering(true);
      timer.current = setTimeout(() => {
        setFlickering(false);
        apply('on');
      }, FLICKER_MS);
      return;
    }
    apply(mode === 'on' ? 'off' : 'on');
  }, [mode, effects, flickering, apply]);

  const value = useMemo(() => ({ mode, toggle, announcement, effects }), [mode, toggle, announcement, effects]);
  return (
    <LightsContext.Provider value={value}>
      {children}
      {flickering && <div data-lights-flicker="" aria-hidden="true" className="no-print pointer-events-none fixed inset-0 z-50" />}
    </LightsContext.Provider>
  );
}

/**
 * The mode toggle: a real button, first in the header after the skip link. Its name is constant, "Lights on" (WAI-ARIA: a toggle
 * button keeps one name and `aria-pressed` carries the state: true while Lights on is active). The icon shows the state visually
 * (a lit bulb while on, an unlit one while off) and is decorative (`aria-hidden`). It does not move focus. Hidden in print.
 */
export function LightsToggle() {
  const { mode, toggle } = useLights();
  const on = mode === 'on';
  return (
    <button
      type="button"
      data-lights-toggle
      aria-pressed={on}
      onClick={toggle}
      className="no-print mb-2 inline-flex min-h-11 items-center gap-2 rounded border-2 border-sk-ecto bg-sk-surface px-3 py-1 text-sk-text"
    >
      <svg data-lights-icon={on ? 'on' : 'off'} aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6M10 21h4" />
        <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" fill={on ? 'currentColor' : 'none'} />
        {on ? <path d="M12 0.5v1M3.5 4l.7.7M20.5 4l-.7.7M1 11h1M22 11h1" /> : <path d="M5 5l14 14" />}
      </svg>
      <span>Lights on</span>
    </button>
  );
}

/**
 * The second name of a finding (HU-10): shown after the plain message, in Lights off only, hidden from assistive technology (the
 * plain wording is heard once) and from print. A code without an entry, or a finding that only Needs review without a review name,
 * shows nothing extra. Never used for a Not-evaluated comparison.
 */
export function ThemeName({ entry, state }: { entry: ThemeEntry | undefined; state: 'confirmed' | 'needs_review' }) {
  const { mode } = useLights();
  if (mode !== 'off' || !entry) return null;
  const text = state === 'confirmed' ? entry.name : entry.review?.name;
  if (!text) return null;
  return (
    <span data-theme-name="" aria-hidden="true" className="no-print ml-2 text-sm italic text-sk-muted">
      {text[0]!.toUpperCase() + text.slice(1)}
    </span>
  );
}
