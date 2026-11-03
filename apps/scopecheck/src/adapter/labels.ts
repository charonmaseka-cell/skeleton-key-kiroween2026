import type { ThemeEntry } from '@skeleton-key/ui';
// Plain labels for everything ScopeCheck shows a person. Field keys, document IDs and reason codes are internal names; the
// interface and the exports show these instead.

export const SCOPE_FIELD_LABELS: Record<string, string> = {
  item: 'Item',
  quantity: 'Quantity',
  specification: 'Specification',
  unit_price: 'Unit price',
  exclusion: 'Exclusion',
};

export const SCOPE_ROLE_LABELS: Record<string, string> = { rfq: 'RFQ', quote: 'Quotation' };

export const SCOPE_REASONS: Record<string, string> = {};

export const scopeField = (field: string): string => SCOPE_FIELD_LABELS[field] ?? field.replace(/_/g, ' ');

/** A document named for a person: its title when known, else its role's label. */
export function scopeDoc(titles: Record<string, string> | undefined, roles: Record<string, string> | undefined, docId: string): string {
  return titles?.[docId] || SCOPE_ROLE_LABELS[roles?.[docId] ?? ''] || docId; // the apps always pass titles; the ID is only a fallback for tools (benchmark)
}

/**
 * Second names (Lights off only; the plain wording is always shown). Rules not listed here have none. Item identity and allocation
 * findings are uncertainties, not verdicts, so they get no name.
 */
export const SCOPE_THEME: Record<string, ThemeEntry> = {
  'item.absent': { name: 'ghost', plural: 'ghosts', review: { name: 'possible ghost', plural: 'possible ghosts' }, plain: 'missing item', plainPlural: 'missing items' },
  'quantity.differs': { name: 'miscount', plural: 'miscounts', plain: 'quantity difference', plainPlural: 'quantity differences' },
  'spec.differs': { name: 'curse', plural: 'curses', plain: 'specification difference', plainPlural: 'specification differences' },
  'exclusion.stated': { name: 'fine-print spectre', plural: 'fine-print spectres', plain: 'stated exclusion', plainPlural: 'stated exclusions' },
};
