import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { readStored, readSystem, resolveMode, watchSystem, writeStored } from './lights';
import type { Mode } from './theme-tokens';

type LightsValue = { mode: Mode; toggle: () => void; /** text for the polite live region after a toggle; '' otherwise */ announcement: string };
const LightsContext = createContext<LightsValue>({ mode: 'on', toggle: () => undefined, announcement: '' });

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
  const mode = resolveMode(stored, system);

  useEffect(() => watchSystem(() => setSystem(readSystem())), []);
  useIsoLayoutEffect(() => {
    document.documentElement.setAttribute('data-lights', mode);
  }, [mode]);

  const toggle = useCallback(() => {
    const next: Mode = mode === 'on' ? 'off' : 'on';
    writeStored(next); // if storage is unavailable the choice still holds for this session
    setStored(next);
    setAnnouncement(next === 'on' ? 'Lights on' : 'Lights off');
  }, [mode]);

  const value = useMemo(() => ({ mode, toggle, announcement }), [mode, toggle, announcement]);
  return <LightsContext.Provider value={value}>{children}</LightsContext.Provider>;
}

/**
 * The mode toggle: a real button, first in the header after the skip link. Its text names the mode it switches TO ("Lights on" while the
 * page is off); aria-pressed is true while Lights on is active. It does not move focus. Hidden in print.
 */
export function LightsToggle() {
  const { mode, toggle } = useLights();
  return (
    <button
      type="button"
      data-lights-toggle
      aria-pressed={mode === 'on'}
      onClick={toggle}
      className="no-print mb-2 min-h-11 rounded border-2 border-sk-ecto bg-sk-surface px-3 py-1 text-sk-text"
    >
      {mode === 'on' ? 'Lights off' : 'Lights on'}
    </button>
  );
}
