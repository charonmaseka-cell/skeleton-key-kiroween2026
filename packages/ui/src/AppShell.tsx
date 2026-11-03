import { useEffect, useState, type ReactNode } from 'react';
import { Candles, GutterFog, HauntProvider, HeaderFog, WhisperLine } from './Haunt';
import { BrandMark, Motifs } from './Motifs';
import type { SessionView } from './session-core';
import { LightsToggle, ThemeProvider, useLights } from './ThemeProvider';

type AppShellProps = {
  title: string;
  tagline: string;
  /** always-visible notice, for example the sample-mode banner */
  banner?: ReactNode;
  /** in-page navigation (anchor links, keyboard operable) */
  nav?: { href: string; label: string }[];
  /** polite announcement for assistive technology after an action */
  announcement?: string;
  /** the session's view: the signature effects (candles, Next finding, whisper ...) are driven by its unresolved items */
  haunt?: { view: SessionView };
  children?: ReactNode;
};

// Shared page frame used by both apps: skip link, landmarks, in-page navigation and a polite live
// region, so keyboard and screen-reader access exists from the first interface work (R13.1).
export function AppShell(props: AppShellProps) {
  return (
    <ThemeProvider>
      <HauntProvider view={props.haunt?.view}>
        <Frame {...props} />
      </HauntProvider>
    </ThemeProvider>
  );
}

function Frame({ title, tagline, banner, nav, announcement, children }: AppShellProps) {
  const lights = useLights();
  // The toggle's message shares the polite live region; a later announcement from the page replaces it.
  const [fromToggle, setFromToggle] = useState(true);
  useEffect(() => setFromToggle(false), [announcement]);
  useEffect(() => {
    if (lights.announcement) setFromToggle(true);
  }, [lights.announcement]);
  const live = fromToggle && lights.announcement ? lights.announcement : announcement;
  return (
    <div className="relative min-h-screen text-sk-text">
      <Motifs />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:bg-sk-surface focus:p-2 focus:text-sk-text focus:outline focus:outline-2 focus:outline-sk-info"
      >
        Skip to main content
      </a>
      {banner}
      <header className="relative border-b border-sk-border px-4 py-4 sm:px-6">
        <LightsToggle />
        <h1 data-display="" className="text-2xl font-semibold">
          <BrandMark />
          {title}
        </h1>
        <p className="text-sk-muted">{tagline}</p>
        <Candles />
        <WhisperLine />
        {nav && (
          <nav aria-label="Sections" className="no-print mt-2">
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {nav.map((n) => (
                <li key={n.href}>
                  <a href={n.href} className="text-sk-link underline">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <HeaderFog />
      </header>
      <div className="relative">
        <GutterFog />
        <main id="main" tabIndex={-1} className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {live}
      </div>
    </div>
  );
}
