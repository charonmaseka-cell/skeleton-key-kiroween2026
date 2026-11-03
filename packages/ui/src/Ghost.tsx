import { useState } from 'react';
import type { ReviewItem } from '@skeleton-key/engine';

// Ghost rows (HU-11). A CONFIRMED absence is drawn as a ghost: translucent fill, dashed boundary, text at full contrast, and in
// Lights off one short flicker the moment it appears (for example when "Confirm coverage" turns a possible ghost into a confirmed
// one). A Needs-review absence is never a ghost. "Show the evidence" solidifies it (UI state only, not stored) and moves focus to
// its finding. The styling and the flicker are in effects.css; the flicker does not run in Lights on or under reduced motion.

export function useGhosts() {
  const [solid, setSolid] = useState<ReadonlySet<string>>(new Set());
  return {
    /** true while the item is a confirmed absence that has not been solidified */
    isGhost: (item: ReviewItem | undefined): boolean => !!item && item.finding.state === 'confirmed' && !solid.has(item.finding.id),
    solidify: (item: ReviewItem) => {
      setSolid((s) => new Set(s).add(item.finding.id));
      setTimeout(() => document.getElementById(`finding-${item.finding.id}`)?.focus(), 0);
    },
  };
}

export function GhostButton({ item, onSolidify }: { item: ReviewItem; onSolidify: (item: ReviewItem) => void }) {
  return (
    <button type="button" onClick={() => onSolidify(item)} aria-label={`Show the evidence: ${item.finding.message}`} className="rounded border-2 border-sk-border bg-sk-surface px-2 py-0.5 text-sm">
      Show the evidence
    </button>
  );
}
