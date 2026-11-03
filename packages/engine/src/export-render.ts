import type { ExportEntry, ExportModel } from './export';

// Plain-text and CSV renderers for the export model (R7.5). Every state is kept: confirmed
// findings, unresolved Needs-review items, Not-evaluated comparisons (own section), decisions,
// corrections and notes. Sample runs carry an unmissable marker. No network, no files.

export const SAMPLE_MARK = 'SAMPLE (fictional): invented documents, not a real review';

import { formatValue } from './format';

const fmt = formatValue;

/**
 * How a domain names things for people. The engine is domain-neutral: without labels it renders the internal names, which is
 * only right for machine use. The apps always pass labels, so field keys, document IDs and reason codes become plain words.
 * Block IDs are kept only inside the evidence detail (with the line number).
 */
export type ExportLabels = {
  field?: (key: string) => string;
  doc?: (docId: string) => string;
  reason?: (code: string) => string;
  /** a finding ID -> the finding's message */
  finding?: (findingId: string) => string;
  /** 1-based line of a block in its document */
  line?: (docId: string, blockId: string) => number | null;
};
type L = Required<Omit<ExportLabels, 'line'>> & Pick<ExportLabels, 'line'>;
const resolve = (l: ExportLabels = {}): L => ({ field: l.field ?? ((k) => k), doc: l.doc ?? ((d) => d), reason: l.reason ?? ((r) => r), finding: l.finding ?? ((f) => f), line: l.line });
const SEVERITY: Record<string, string> = { critical: 'critical', high: 'high', warning: 'warning', info: 'information' };
const REVIEW: Record<string, string> = { open: 'not decided', accepted: 'accepted', dismissed: 'dismissed' };
const COVERAGE: Record<string, string> = { unverified: 'not confirmed as fully extracted', user_confirmed: 'confirmed by the reviewer', verified: 'verified', processing_incomplete: 'not fully processed' };
const where = (l: L, docId: string, blockId: string) => {
  const n = l.line?.(docId, blockId);
  return `${l.doc(docId)}${n ? `, line ${n}` : ''} (block ${blockId})`;
};

function entryLines(e: ExportEntry, l: L): string[] {
  const out = [`- [${e.state === 'confirmed' ? 'CONFIRMED' : 'NEEDS REVIEW'}] ${e.message} (${SEVERITY[e.severity] ?? e.severity})`];
  if (e.reason) out.push(`    why: ${l.reason(e.reason)}`);
  out.push(`    review: ${REVIEW[e.review] ?? e.review}${e.reopened ? ' (reopened: inputs changed since the earlier decision)' : ''}${e.note ? `; note: ${e.note}` : ''}`);
  for (const u of e.userSupplied) out.push(`    user-supplied value ${fmt(u.value)} replaced the document value ${fmt(u.originalValue)}`);
  for (const ev of e.evidence) out.push(`    evidence (${ev.role === 'superseded_original' ? 'original value, replaced by a correction' : 'document'}): ${where(l, ev.docId, ev.blockId)}, characters ${ev.start}-${ev.end}: "${ev.text}"`);
  return out;
}

export function renderText(m: ExportModel, labels?: ExportLabels): string {
  const l = resolve(labels);
  const L: string[] = [];
  if (m.sample) L.push(SAMPLE_MARK, '');
  const c = m.comparisons;
  L.push(`Comparisons planned: ${c.planned}; agree: ${c.agree}; flagged: ${c.flagged}; NOT EVALUATED: ${c.notEvaluated}`, '');
  L.push(`CONFIRMED FINDINGS (${m.findings.length})`, ...(m.findings.length ? m.findings.flatMap((e) => entryLines(e, l)) : ['(none)']), '');
  L.push(`NEEDS REVIEW, UNRESOLVED (${m.unresolved.length})`, ...(m.unresolved.length ? m.unresolved.flatMap((e) => entryLines(e, l)) : ['(none)']), '');
  L.push(
    `NOT EVALUATED (${m.notEvaluated.length}): these comparisons did NOT run; they are not "no difference"`,
    ...(m.notEvaluated.length
      ? m.notEvaluated.flatMap((n) => [`- ${l.field(n.field)} (${n.docs.map(l.doc).join(' vs ')}): ${l.reason(n.reason)}`, ...(n.blocked ? [`    blocked input: ${l.field(n.blocked.field)} in ${l.doc(n.blocked.docId)}: ${l.reason(n.blocked.reason)}`] : [])])
      : ['(none)']),
    '',
  );
  L.push(
    `COVERAGE OF EACH DOCUMENT (${m.coverage.length}): an absence is only stated as fact against a document whose extraction is confirmed`,
    ...(m.coverage.length ? m.coverage.map((c) => `- ${l.doc(c.docId)}: ${COVERAGE[c.state] ?? c.state}${c.confirmedByUser ? ' (asserted by the reviewer, not checked by the tool)' : ''}`) : ['(not recorded)']),
    '',
  );
  L.push(`USER DECISIONS (${m.decisions.length})`, ...(m.decisions.length ? m.decisions.map((d) => `- ${l.finding(d.findingId)}: ${decision(d.status)} at ${new Date(d.at).toISOString()}${d.note ? `; ${d.note}` : ''}`) : ['(none)']), '');
  L.push(`CORRECTIONS (${m.corrections.length}): original values are preserved`, ...(m.corrections.length ? m.corrections.map((x) => `- ${l.field(x.field)}${x.docId ? ` in ${l.doc(x.docId)}` : ''}: ${fmt(x.originalValue)} -> ${fmt(x.correctedValue)}${x.reverted ? ' (REVERTED)' : ''}${x.note ? `; ${x.note}` : ''}`) : ['(none)']), '');
  L.push(`NOTES (${m.notes.length})`, ...(m.notes.length ? m.notes.map((n) => `- ${l.finding(n.findingId)}: ${n.note}`) : ['(none)']));
  return L.join('\n') + '\n';
}

/** "decided:accepted" -> "accepted"; "reopened:open" -> "reopened" */
function decision(status: string): string {
  const [event, st] = status.split(':');
  if (event === 'reopened') return 'reopened';
  return REVIEW[st ?? ''] ?? status;
}

/** Neutralise spreadsheet formula injection and enclose CSV fields where needed. */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV: every column is in plain words (no internal IDs); block references appear only inside the evidence detail. */
export function renderCsv(m: ExportModel, labels?: ExportLabels): string {
  const l = resolve(labels);
  const head = ['Section', 'Sample', 'State', 'Description', 'Severity', 'Review', 'Reopened', 'Field', 'Why', 'Documents', 'Blocked input', 'Evidence', 'Note'];
  const rows: unknown[][] = [];
  const sample = m.sample ? 'SAMPLE (fictional)' : '';
  const entry = (section: string, e: ExportEntry) =>
    rows.push([section, sample, e.state === 'confirmed' ? 'confirmed' : 'needs review', e.message, SEVERITY[e.severity] ?? e.severity, REVIEW[e.review] ?? e.review, e.reopened ? 'yes' : 'no', '', e.reason ? l.reason(e.reason) : '', '', '', e.evidence.map((x) => `${where(l, x.docId, x.blockId)}, characters ${x.start}-${x.end}: ${x.text}`).join(' | '), e.note]);
  m.findings.forEach((e) => entry('confirmed finding', e));
  m.unresolved.forEach((e) => entry('needs review', e));
  m.notEvaluated.forEach((n) => rows.push(['not evaluated', sample, 'not evaluated', `${l.field(n.field)} was not compared`, '', '', '', l.field(n.field), l.reason(n.reason), n.docs.map(l.doc).join(' vs '), n.blocked ? `${l.field(n.blocked.field)} in ${l.doc(n.blocked.docId)}: ${l.reason(n.blocked.reason)}` : '', '', '']));
  m.coverage.forEach((c) => rows.push(['coverage', sample, COVERAGE[c.state] ?? c.state, c.confirmedByUser ? 'asserted by the reviewer' : 'not confirmed by the reviewer', '', '', '', '', '', l.doc(c.docId), '', '', '']));
  m.decisions.forEach((d) => rows.push(['decision', sample, '', l.finding(d.findingId), '', decision(d.status), '', '', '', '', '', '', d.note]));
  m.corrections.forEach((x) => rows.push(['correction', sample, 'user supplied', `${fmt(x.originalValue)} -> ${fmt(x.correctedValue)}${x.reverted ? ' (REVERTED)' : ''}`, '', '', '', l.field(x.field), '', x.docId ? l.doc(x.docId) : '', '', '', x.note]));
  m.notes.forEach((n) => rows.push(['note', sample, '', l.finding(n.findingId), '', '', '', '', '', '', '', '', n.note]));
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
