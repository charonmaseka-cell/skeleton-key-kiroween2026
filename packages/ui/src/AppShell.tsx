import type { ReactNode } from 'react';

type AppShellProps = {
  title: string;
  tagline: string;
  children?: ReactNode;
};

// Shared page frame used by both apps. Includes a skip link and landmarks
// so keyboard access is present from the first interface work (R13.1).
export function AppShell({ title, tagline, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:p-2 focus:text-slate-900 focus:outline focus:outline-2 focus:outline-blue-700"
      >
        Skip to main content
      </a>
      <header className="border-b border-slate-300 px-6 py-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-slate-700">{tagline}</p>
      </header>
      <main id="main" className="px-6 py-6">
        {children}
      </main>
    </div>
  );
}
