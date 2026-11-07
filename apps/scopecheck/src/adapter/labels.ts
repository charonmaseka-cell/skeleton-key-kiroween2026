import type { ThemeEntry } from '@skeleton-key/ui';
// Plain labels for everything ScopeCheck shows a person. Field keys, document IDs and reason codes are internal names; the
// interface and the exports show these instead.

export const SCOPE_FIELD_LABELS: Record<string, string> = {
  item: 'Item',
  quantity: 'Quantity',
  specification: 'Specification',
  unit_price: 'Unit price',
  line_total: 'Line total',
  discount: 'Discount',
  tax: 'Tax',
  exclusion: 'Exclusion',
};

export const SCOPE_ROLE_LABELS: Record<string, string> = { rfq: 'RFQ', quote: 'Quotation' };

export const SCOPE_REASONS: Record<string, string> = {
  unit_missing: 'A quantity has no unit, so it cannot be compared with the requested quantity.',
  unit_differs: 'The offered unit is not the requested unit, and no conversion between them is stated in the documents. Nothing was converted.',
  tax_basis_unclear: 'Tax is stated on this line, and the documents do not show whether the total includes it, so the total cannot be checked.',
  discount_basis_unclear: 'A discount is stated but not as a percentage between 0 and 100, so the total cannot be checked.',
  currency_unknown: 'The currency of the unit price or the total is not known.',
  currency_differs: 'The unit price and the total are in different currencies; nothing is converted.',
  unit_unknown: 'The unit of the quantity is not known, so no exact price check is made.',
  no_line_total_extracted: 'No line total was in the extraction for this line, so its total cannot be checked against quantity and unit price.',
};

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
  'price.arithmetic': { name: 'phantom maths', plural: 'phantom maths', plain: 'line total difference', plainPlural: 'line total differences' },
};
