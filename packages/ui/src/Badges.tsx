import type { ReactNode } from 'react';

// Status is always shown as text plus an icon, never colour alone (R13.2).
export type BadgeKind =
  | 'confirmed'
  | 'needs_review'
  | 'not_evaluated'
  | 'agree'
  | 'validated'
  | 'user_supplied'
  | 'unverified'
  | 'verified'
  | 'open'
  | 'accepted'
  | 'dismissed'
  | 'info';

const STYLE: Record<BadgeKind, { icon: string; label: string; cls: string }> = {
  confirmed: { icon: '!', label: 'Confirmed finding', cls: 'bg-red-100 text-red-950 border-red-800' },
  needs_review: { icon: '?', label: 'Needs review', cls: 'bg-amber-100 text-amber-950 border-amber-800' },
  not_evaluated: { icon: '–', label: 'Not evaluated', cls: 'bg-slate-100 text-slate-950 border-slate-700 border-dashed' },
  agree: { icon: '=', label: 'Agrees', cls: 'bg-green-100 text-green-950 border-green-800' },
  validated: { icon: '+', label: 'Validated', cls: 'bg-green-100 text-green-950 border-green-800' },
  user_supplied: { icon: 'u', label: 'User-supplied', cls: 'bg-blue-100 text-blue-950 border-blue-800' },
  unverified: { icon: '~', label: 'Coverage unverified', cls: 'bg-amber-100 text-amber-950 border-amber-800' },
  verified: { icon: '+', label: 'Coverage confirmed by you', cls: 'bg-green-100 text-green-950 border-green-800' },
  open: { icon: 'o', label: 'Open', cls: 'bg-white text-slate-950 border-slate-700' },
  accepted: { icon: '+', label: 'Accepted', cls: 'bg-green-100 text-green-950 border-green-800' },
  dismissed: { icon: 'x', label: 'Dismissed', cls: 'bg-slate-100 text-slate-950 border-slate-700' },
  info: { icon: 'i', label: 'Info', cls: 'bg-blue-100 text-blue-950 border-blue-800' },
};

export function StatusBadge({ kind, label, children }: { kind: BadgeKind; label?: string; children?: ReactNode }) {
  const s = STYLE[kind];
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded border px-2 py-0.5 text-sm font-medium ${s.cls}`}>
      <span aria-hidden="true" className="font-bold">
        {s.icon}
      </span>
      <span>{label ?? s.label}</span>
      {children}
    </span>
  );
}

/**
 * A mode banner: always visible, never dismissible, never replaced by decoration (haunted-ui HU-7). On wide screens the label and
 * the explanation are both shown. On narrow screens the label is ONE line (the mode, and for live mode that text leaves the
 * device) with the explanation folded behind a toggle that is always visible on that line, so only the explanatory text is folded.
 */
function Banner({ label, tone, short, full, note }: { label: string; tone: string; short: string; full: string; note: string }) {
  return (
    <div role="region" aria-label={label} className={`sticky top-0 z-10 border-b-4 px-4 py-2 sm:px-6 ${tone}`}>
      <div className="hidden sm:block">
        <p className="font-semibold">{full}</p>
        <p className="text-sm">{note}</p>
      </div>
      <details className="sm:hidden" data-banner-compact="">
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2 text-sm">
          <span className="min-w-0 truncate font-semibold">{short}</span>
          <span className="shrink-0 underline">Details</span>
        </summary>
        <p className="mt-1 text-sm font-semibold">{full}</p>
        <p className="text-sm">{note}</p>
      </details>
    </div>
  );
}

/** Always-visible notice that this is sample mode. Not dismissible. */
export function SampleBanner({ note }: { note: string }) {
  return <Banner label="Sample mode" tone="border-amber-700 bg-amber-100 text-amber-950" short="SAMPLE MODE: fictional documents" full="SAMPLE MODE: fictional documents. Not a real review." note={note} />;
}

/** Always-visible notice that documents are being analysed live. Not dismissible. */
export function LiveBanner({ note }: { note: string }) {
  return <Banner label="Live mode" tone="border-blue-800 bg-blue-100 text-blue-950" short="LIVE: text sent to an AI service" full="LIVE: your documents. Extracted text was sent to an AI service for analysis; not all processing is local." note={note} />;
}

/**
 * Every table sits in its own horizontal scroll container, so a wide table scrolls inside the page and the page itself never
 * scrolls sideways (checked at 375 px). The container is focusable so keyboard users can scroll it, and it is named.
 */
export function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={`${label} (scroll sideways to see every column)`} tabIndex={0} data-scroll-table="" className="scroll-table max-w-full overflow-x-auto">
      {children}
    </div>
  );
}
