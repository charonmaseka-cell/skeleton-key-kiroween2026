import type { ThemeEntry } from '@skeleton-key/ui';

// Plain labels for everything PackCheck shows a person. Field keys, document IDs and reason codes are internal names; the
// interface and the exports show these instead.

export const PACK_FIELD_LABELS: Record<string, string> = {
  organisation_name: 'Organisation name',
  funding_requested: 'Funding requested',
  total_project_budget: 'Total project budget',
  project_start_date: 'Project start date',
  project_end_date: 'Project end date',
  attachment_title: 'Attachment',
  'funding_requested<=total_project_budget': 'Funding requested within the total budget',
};

export const PACK_ROLE_LABELS: Record<string, string> = {
  requirements: 'Application requirements',
  'application-form': 'Application form',
  budget: 'Budget summary',
  registration: 'Registration certificate',
};

export const PACK_REASONS: Record<string, string> = {};

/** Field label, never the key. */
export const packField = (field: string): string => PACK_FIELD_LABELS[field] ?? field.replace(/_/g, ' ');

/** A document named for a person: its title when known, else its role's label. */
export function packDoc(titles: Record<string, string> | undefined, roles: Record<string, string> | undefined, docId: string): string {
  return titles?.[docId] || PACK_ROLE_LABELS[roles?.[docId] ?? ''] || PACK_ROLE_LABELS[docId] || docId; // the apps always pass titles; the ID is only a fallback for tools (benchmark)
}

/**
 * Second names (Lights off only). The mapping is explicit: Lost page = a required attachment is missing; Doppelgänger = the
 * organisation name differs between documents; Changeling = another value (funding, a date) differs; Bottomless purse = the funding
 * requested exceeds the total project budget. Other rules have none.
 */
export const PACK_THEME: Record<string, ThemeEntry> = {
  'attachment.missing': { name: 'lost page', plural: 'lost pages', review: { name: 'possible lost page', plural: 'possible lost pages' }, plain: 'missing attachment', plainPlural: 'missing attachments' },
  'org.name_differs': { name: 'doppelgänger', plural: 'doppelgängers', plain: 'organisation name difference', plainPlural: 'organisation name differences' },
  'funding.differs': { name: 'changeling', plural: 'changelings', plain: 'other value difference', plainPlural: 'other value differences' },
  'date.differs': { name: 'changeling', plural: 'changelings', plain: 'other value difference', plainPlural: 'other value differences' },
  'funding.exceeds_budget': { name: 'bottomless purse', plural: 'bottomless purses', plain: 'budget overrun', plainPlural: 'budget overruns' },
};
