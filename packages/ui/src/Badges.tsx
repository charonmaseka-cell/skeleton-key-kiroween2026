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

/** Icon shapes: each state has its own shape, so states stay distinct in grayscale (HU-6). Decorative: the text always names the state. */
const SHAPES: Record<BadgeKind, ReactNode> = {
  // bolt
  confirmed: <path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor" />,
  // lantern
  needs_review: (
    <>
      <path d="M9 3h6M12 3v2" fill="none" />
      <path d="M8 7h8l1 10H7z" fill="none" />
      <path d="M7 20h10" fill="none" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </>
  ),
  // ghost with a dashed outline
  not_evaluated: <path d="M6 20V10a6 6 0 0 1 12 0v10l-3-2-3 2-3-2z" fill="none" strokeDasharray="3 2" />,
  agree: <path d="M5 9h14M5 15h14" fill="none" />,
  // check
  validated: <path d="m5 12 4 4 10-10" fill="none" />,
  // pencil
  user_supplied: <path d="m4 20 1-5L16 4l4 4L9 19zM14 6l4 4" fill="none" />,
  unverified: <path d="M5 12c2-4 5-6 7-6s5 2 7 6c-2 4-5 6-7 6s-5-2-7-6z" fill="none" strokeDasharray="3 2" />,
  verified: <path d="M5 12c2-4 5-6 7-6s5 2 7 6c-2 4-5 6-7 6s-5-2-7-6zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" fill="none" />,
  open: <circle cx="12" cy="12" r="6" fill="none" />,
  accepted: <path d="m5 12 4 4 10-10M5 20h14" fill="none" />,
  dismissed: <path d="m6 6 12 12M18 6 6 18" fill="none" />,
  info: <path d="M12 8v.01M12 11v6" fill="none" />,
};

const STYLE: Record<BadgeKind, { label: string; cls: string }> = {
  confirmed: { label: 'Confirmed finding', cls: 'border-sk-danger' },
  needs_review: { label: 'Needs review', cls: 'border-sk-accent' },
  not_evaluated: { label: 'Not evaluated', cls: 'border-sk-border border-dashed' },
  agree: { label: 'Agrees', cls: 'border-sk-ok' },
  validated: { label: 'Validated', cls: 'border-sk-ok' },
  user_supplied: { label: 'User-supplied', cls: 'border-sk-info' },
  unverified: { label: 'Coverage unverified', cls: 'border-sk-accent' },
  verified: { label: 'Coverage confirmed by you', cls: 'border-sk-ok' },
  open: { label: 'Open', cls: 'border-sk-border' },
  accepted: { label: 'Accepted', cls: 'border-sk-ok' },
  dismissed: { label: 'Dismissed', cls: 'border-sk-border' },
  info: { label: 'Info', cls: 'border-sk-info' },
};

export const BADGE_KINDS = Object.keys(STYLE) as BadgeKind[];
/** The icon shape of a state, for the grayscale-distinctness test. */
export const badgeShapeKey = (k: BadgeKind): string => {
  const render = (n: ReactNode): string => JSON.stringify(n, (key, v) => (key === '_owner' || key === '_store' ? undefined : v));
  return render(SHAPES[k]);
};

export function StatusBadge({ kind, label, children }: { kind: BadgeKind; label?: string; children?: ReactNode }) {
  const s = STYLE[kind];
  return (
    <span data-badge={kind} className={`inline-flex max-w-full items-center gap-1 rounded border-2 bg-sk-surface px-2 py-0.5 text-sm font-medium text-sk-text ${s.cls}`}>
      <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        {SHAPES[kind]}
      </svg>
      <span>{label ?? s.label}</span>
      {children}
    </span>
  );
}

/**
 * A mode banner: always visible, never dismissible, never replaced by decoration (haunted-ui HU-7). It is the mode label and ONE plain
 * line, with a Details toggle that is always visible for everything else (the model, the run, the paths). On narrow screens the
 * label is ONE line (the mode, and for live mode that text leaves the device) and the plain line moves behind the same toggle, so
 * only explanatory text is ever folded, never the label.
 */
function Banner({ label, tone, short, full, note, details }: { label: string; tone: string; short: string; full: string; note: string; details?: string[] }) {
  const rest = (
    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
      {(details ?? []).map((d) => (
        <li key={d}>{d}</li>
      ))}
    </ul>
  );
  return (
    <div role="region" aria-label={label} className={`sticky top-0 z-10 border-b-4 px-4 py-2 sm:px-6 ${tone}`}>
      <div className="hidden sm:block">
        <p className="font-semibold">{full}</p>
        <p className="text-sm">{note}</p>
        {details && details.length > 0 && (
          <details data-banner-details="">
            <summary className="cursor-pointer text-sm underline">Details</summary>
            {rest}
          </details>
        )}
      </div>
      <details className="sm:hidden" data-banner-compact="">
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2 text-sm">
          <span className="min-w-0 truncate font-semibold">{short}</span>
          <span className="shrink-0 underline">Details</span>
        </summary>
        <p className="mt-1 text-sm font-semibold">{full}</p>
        <p className="text-sm">{note}</p>
        {details && details.length > 0 && rest}
      </details>
    </div>
  );
}

/** Always-visible notice that this is sample mode. Not dismissible. `note` is one plain line; `details` sit behind the Details toggle. */
export function SampleBanner({ note, details }: { note: string; details?: string[] }) {
  // banner-colours: labelling, not theme (HU-7). Fixed light chips with dark text: 14:1 or better in both modes.
  return <Banner label="Sample mode" tone="border-amber-700 bg-amber-100 text-amber-950" short="SAMPLE MODE: fictional documents" full="SAMPLE MODE: fictional documents. Not a real review." note={note} details={details} />;
}

/** Always-visible notice that documents are being analysed live. Not dismissible. */
export function LiveBanner({ note, details }: { note: string; details?: string[] }) {
  // banner-colours
  return <Banner label="Live mode" tone="border-blue-800 bg-blue-100 text-blue-950" short="LIVE: text sent to an AI service" full="LIVE: your documents. Extracted text was sent to an AI service for analysis; not all processing is local." note={note} details={details} />;
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
