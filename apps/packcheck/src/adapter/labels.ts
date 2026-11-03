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
