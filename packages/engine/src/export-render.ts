import type { ExportEntry, ExportModel } from './export';

// Plain-text and CSV renderers for the export model (R7.5). Every state is kept: confirmed
// findings, unresolved Needs-review items, Not-evaluated comparisons (own section), decisions,
// corrections and notes. Sample runs carry an unmissable marker. No network, no files.

const SAMPLE_MARK = 'SAMPLE (fictional): invented documents, not a real review';

const fmt = (v: unknown): string => (v === null || v === undefined ? 'unknown' : typeof v === 'string' ? v : JSON.stringify(v));

function entryLines(e: ExportEntry): string[] {
  const out = [`- [${e.state === 'confirmed' ? 'CONFIRMED' : 'NEEDS REVIEW'}] ${e.message} (${e.code}, ${e.severity})`];
  if (e.reason) out.push(`    reason: ${e.reason}`);
  out.push(`    review: ${e.review}${e.reopened ? ' (reopened: inputs changed since the earlier decision)' : ''}${e.note ? `; note: ${e.note}` : ''}`);
  for (const u of e.userSupplied) out.push(`    user-supplied value ${fmt(u.value)} replaced the document value ${fmt(u.originalValue)}`);
  for (const ev of e.evidence) out.push(`    evidence (${ev.role === 'superseded_original' ? 'original value, replaced by a correction' : 'document'}): ${ev.docId} / ${ev.blockId} [${ev.start}-${ev.end}] "${ev.text}"`);
  return out;
}

export function renderText(m: ExportModel): string {
  const L: string[] = [];
  if (m.sample) L.push(SAMPLE_MARK, '');
  const c = m.comparisons;
  L.push(`Comparisons planned: ${c.planned}; agree: ${c.agree}; flagged: ${c.flagged}; NOT EVALUATED: ${c.notEvaluated}`, '');
  L.push(`CONFIRMED FINDINGS (${m.findings.length})`, ...(m.findings.length ? m.findings.flatMap(entryLines) : ['(none)']), '');
  L.push(`NEEDS REVIEW, UNRESOLVED (${m.unresolved.length})`, ...(m.unresolved.length ? m.unresolved.flatMap(entryLines) : ['(none)']), '');
  L.push(
    `NOT EVALUATED (${m.notEvaluated.length}): these comparisons did NOT run; they are not "no difference"`,
    ...(m.notEvaluated.length
      ? m.notEvaluated.flatMap((n) => [`- ${n.field} [${n.docs.join(' vs ')}]: ${n.reason}`, ...(n.blocked ? [`    blocked input: ${n.blocked.field} in ${n.blocked.docId} (${n.blocked.reason})`] : [])])
      : ['(none)']),
    '',
  );
  L.push(`USER DECISIONS (${m.decisions.length})`, ...(m.decisions.length ? m.decisions.map((d) => `- ${d.findingId}: ${d.status} at ${new Date(d.at).toISOString()}${d.note ? `; ${d.note}` : ''}`) : ['(none)']), '');
  L.push(`CORRECTIONS (${m.corrections.length}): original values are preserved`, ...(m.corrections.length ? m.corrections.map((x) => `- ${x.field} (${x.factId}): ${fmt(x.originalValue)} -> ${fmt(x.correctedValue)}${x.note ? `; ${x.note}` : ''}`) : ['(none)']), '');
  L.push(`NOTES (${m.notes.length})`, ...(m.notes.length ? m.notes.map((n) => `- ${n.findingId}: ${n.note}`) : ['(none)']));
  return L.join('\n') + '\n';
}

/** Neutralise spreadsheet formula injection and enclose CSV fields where needed. */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function renderCsv(m: ExportModel): string {
  const head = ['section', 'sample', 'state', 'id', 'code_or_check', 'severity', 'review', 'reopened', 'message_or_field', 'reason', 'documents', 'blocked_input', 'evidence', 'note'];
  const rows: unknown[][] = [];
  const sample = m.sample ? 'SAMPLE (fictional)' : '';
  const entry = (section: string, e: ExportEntry) =>
    rows.push([section, sample, e.state, e.findingId, e.code, e.severity, e.review, e.reopened, e.message, e.reason, '', '', e.evidence.map((x) => `${x.docId}/${x.blockId}[${x.start}-${x.end}]: ${x.text}`).join(' | '), e.note]);
  m.findings.forEach((e) => entry('confirmed_finding', e));
  m.unresolved.forEach((e) => entry('needs_review', e));
  m.notEvaluated.forEach((n) => rows.push(['not_evaluated', sample, 'not_evaluated', n.id, n.check, '', '', '', n.field, n.reason, n.docs.join(' vs '), n.blocked ? `${n.blocked.field} in ${n.blocked.docId} (${n.blocked.reason})` : '', '', '']));
  m.decisions.forEach((d) => rows.push(['decision', sample, '', d.findingId, d.status, '', '', '', '', '', '', '', '', d.note]));
  m.corrections.forEach((x) => rows.push(['correction', sample, 'user_supplied', x.factId, x.field, '', '', '', `${fmt(x.originalValue)} -> ${fmt(x.correctedValue)}`, '', '', '', '', x.note]));
  m.notes.forEach((n) => rows.push(['note', sample, '', n.findingId, '', '', '', '', '', '', '', '', '', n.note]));
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
