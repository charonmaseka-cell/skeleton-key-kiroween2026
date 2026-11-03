import type { ReactNode } from 'react';

type AppShellProps = {
  title: string;
  tagline: string;
  /** always-visible notice, for example the sample-mode banner */
  banner?: ReactNode;
  /** in-page navigation (anchor links, keyboard operable) */
  nav?: { href: string; label: string }[];
  /** polite announcement for assistive technology after an action */
  announcement?: string;
  children?: ReactNode;
};

// Shared page frame used by both apps: skip link, landmarks, in-page navigation and a polite live
// region, so keyboard and screen-reader access exists from the first interface work (R13.1).
export function AppShell({ title, tagline, banner, nav, announcement, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:bg-white focus:p-2 focus:text-slate-900 focus:outline focus:outline-2 focus:outline-blue-700"
      >
        Skip to main content
      </a>
      {banner}
      <header className="border-b border-slate-300 px-4 py-4 sm:px-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-slate-800">{tagline}</p>
        {nav && (
          <nav aria-label="Sections" className="no-print mt-2">
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {nav.map((n) => (
                <li key={n.href}>
                  <a href={n.href} className="text-blue-900 underline">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
        {children}
      </main>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
