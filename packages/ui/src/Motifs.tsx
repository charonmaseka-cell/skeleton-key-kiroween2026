import type { ReactNode } from 'react';
import { useLights } from './ThemeProvider';

// Decoration (haunted-ui HU-2, HU-5, HU-9, HU-16). Inline SVG and CSS only: no image files, no fonts, no scripts, no audio, no third
// party. Everything here is `aria-hidden`, carries no text and never sits behind or over text, evidence or a control. The brand
// mark is the only decoration present in Lights on; the cobwebs and the fog exist only in Lights off. `ecto` is used here for the
// brand mark and decoration edges only (a test scans for every use of the ecto token).

/** The skeleton-key glyph beside the app name, in the brand colour. Present in both modes. */
export function BrandMark() {
  return (
    <svg data-brand-mark="" aria-hidden="true" focusable="false" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 inline-block shrink-0 align-middle text-sk-ecto">
      <circle cx="7.5" cy="7.5" r="3.5" />
      <path d="M10 10l9 9M16 16l2-2M13 13l2-2" />
    </svg>
  );
}

/** Fog in the two page margins (inside the page padding, where no text is). One short drift on arrival, then still. Lights off only. */
export function Motifs() {
  const { mode } = useLights();
  if (mode !== 'off') return null;
  return (
    <>
      <div data-motif="fog" aria-hidden="true" className="no-print pointer-events-none fixed inset-y-0 left-0 w-2" style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--sk-ecto) 28%, transparent), transparent)' }} />
      <div data-motif="fog" aria-hidden="true" className="no-print pointer-events-none fixed inset-y-0 right-0 w-2" style={{ background: 'linear-gradient(to left, color-mix(in srgb, var(--sk-ecto) 28%, transparent), transparent)' }} />
    </>
  );
}

/** A cobweb in the top-right corner of an empty state. The text has its own space (right padding); Lights off only. */
export function EmptyState({ children }: { children: ReactNode }) {
  const { mode } = useLights();
  const off = mode === 'off';
  return (
    <div className={off ? 'relative pr-12' : undefined}>
      {off && (
        <svg data-motif="cobweb" aria-hidden="true" focusable="false" width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1" className="no-print pointer-events-none absolute right-0 top-0 text-sk-muted">
          <path d="M40 0 0 0M40 0 40 40M40 0 12 28M40 0 28 36M40 0 36 12M40 0 24 4" />
          <path d="M40 10c-6 0-12 6-12 12M40 20c-8 0-18 8-18 18" strokeDasharray="2 2" />
        </svg>
      )}
      {children}
    </div>
  );
}
