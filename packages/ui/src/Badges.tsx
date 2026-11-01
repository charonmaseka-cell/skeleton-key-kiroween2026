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
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 text-sm font-medium ${s.cls}`}>
      <span aria-hidden="true" className="font-bold">
        {s.icon}
      </span>
      <span>{label ?? s.label}</span>
      {children}
    </span>
  );
}

/** Always-visible notice that this is sample mode. Not dismissible. */
export function SampleBanner({ note }: { note: string }) {
  return (
    <div role="region" aria-label="Sample mode" className="sticky top-0 z-10 border-b-4 border-amber-700 bg-amber-100 px-6 py-2 text-amber-950">
      <p className="font-semibold">
        SAMPLE MODE: fictional documents. Not a real review.
      </p>
      <p className="text-sm">{note}</p>
    </div>
  );
}
