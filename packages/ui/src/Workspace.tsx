import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { EffectiveFact, Evidence, Finding, PlannedComparison, ReviewItem, ValueKind } from '@skeleton-key/engine';
import { StatusBadge } from './Badges';
import { exportCsv, exportText, explainReason, parseCorrection, type CorrectionInput, type SessionView } from './session-core';
import type { Session } from './useSession';

// Shared review workspace pieces used by both apps. Keyboard operable: native buttons, links, inputs
// with labels, visible focus (set in each app's CSS), no pointer-only interaction.

export const showValue = (v: unknown): string => {
  if (v === null || v === undefined) return 'unknown';
  if (typeof v === 'string') return v;
  const o = v as Record<string, unknown>;
  if ('amount' in o) return `${o.currency ?? '?'} ${String(Number(o.amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
  if ('value' in o) return `${o.value}${o.unit ? ` ${o.unit}` : ''}`;
  return JSON.stringify(v);
};

// ---------- evidence ----------

function Highlighted({ text, start, end }: { text: string; start: number; end: number }) {
  return (
    <span className="font-mono text-sm">
      {text.slice(0, start)}
      <mark className="rounded bg-yellow-200 px-0.5 text-slate-950 outline outline-1 outline-yellow-700">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </span>
  );
}

export function EvidenceView({ evidence, role, view }: { evidence: Evidence; role?: string; view: SessionView }) {
  const block = view.blocksByDoc.get(evidence.docId)?.find((b) => b.id === evidence.blockId);
  const intact = !!block && block.text.slice(evidence.start, evidence.end) === evidence.text;
  return (
    <figure className="rounded border border-slate-300 bg-slate-50 p-2">
      <figcaption className="text-sm text-slate-800">
        {view.titles[evidence.docId] ?? evidence.docId}, block {evidence.blockId}
        {block?.page ? `, page ${block.page}` : ''}
        {role === 'superseded_original' ? ' (original value, replaced by your correction)' : ''}
      </figcaption>
      {block && intact ? <Highlighted text={block.text} start={evidence.start} end={evidence.end} /> : <p className="text-sm text-red-900">Source text not available or changed: this evidence cannot be shown.</p>}
    </figure>
  );
}

// ---------- correction editor ----------

export function ValueEditor({ fact, onSave, onCancel }: { fact: EffectiveFact; onSave: (value: unknown, note?: string) => void; onCancel: () => void }) {
  const id = useId();
  const kind = fact.fact.kind as ValueKind;
  const [input, setInput] = useState<CorrectionInput>({ currency: 'ZAR' });
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const set = (k: keyof CorrectionInput) => (e: { target: { value: string } }) => setInput((p) => ({ ...p, [k]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = parseCorrection(kind, input);
    if (!r.ok) return setError(r.error);
    onSave(r.value, note.trim() || undefined);
  };
  // Keyboard users: opening the editor moves focus to its first field.
  const first: keyof CorrectionInput = kind === 'money' ? 'amount' : kind === 'quantity' ? 'value' : 'text';
  const field = (k: keyof CorrectionInput, label: string, hint?: string) => (
    <div>
      <label htmlFor={`${id}-${k}`} className="block text-sm font-medium">
        {label}
      </label>
      <input id={`${id}-${k}`} autoFocus={k === first} value={input[k] ?? ''} onChange={set(k)} aria-describedby={error ? `${id}-err` : undefined} className="w-full rounded border border-slate-600 px-2 py-1" placeholder={hint} />
    </div>
  );
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded border-2 border-blue-800 bg-blue-50 p-3" aria-label={`Correct ${fact.fact.field}`}>
      <p className="text-sm">
        Supply the correct value for <strong>{fact.fact.field}</strong>. The document value ({showValue(fact.fact.value)}) is kept and the new value is labelled user-supplied.
      </p>
      {kind === 'money' && (
        <div className="grid grid-cols-2 gap-2">
          {field('amount', 'Amount', 'for example 1600000')}
          {field('currency', 'Currency code', 'ZAR')}
        </div>
      )}
      {kind === 'quantity' && (
        <div className="grid grid-cols-2 gap-2">
          {field('value', 'Quantity', 'for example 10')}
          {field('unit', 'Unit (optional)', 'units')}
        </div>
      )}
      {kind === 'date' && field('text', 'Date', 'YYYY-MM-DD')}
      {kind !== 'money' && kind !== 'quantity' && kind !== 'date' && field('text', 'Value')}
      <div>
        <label htmlFor={`${id}-note`} className="block text-sm font-medium">
          Note (optional)
        </label>
        <input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded border border-slate-600 px-2 py-1" />
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-red-900">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="rounded bg-blue-800 px-3 py-1 font-medium text-white">
          Save correction
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-slate-700 px-3 py-1">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------- findings ----------

const SEVERITY: Record<string, string> = { critical: 'Critical', warning: 'Warning', info: 'Info' };

export function FactLine({ fact, session, view }: { fact: EffectiveFact; session: Session; view: SessionView }) {
  const [editing, setEditing] = useState(false);
  const user = fact.provenance === 'user_supplied';
  return (
    <li className="py-1">
      <span className="font-medium">{fact.fact.field}</span>: <span>{showValue(fact.value)}</span>{' '}
      {user ? <StatusBadge kind="user_supplied" /> : fact.status === 'validated' ? <StatusBadge kind="validated" /> : <StatusBadge kind="needs_review" label={`Held: ${explainReason(fact.fact.reason)}`} />}
      {user && <span className="ml-1 text-sm">(document said {showValue(fact.fact.value)})</span>}{' '}
      <button type="button" onClick={() => setEditing((e) => !e)} aria-expanded={editing} className="text-sm underline">
        {editing ? 'Close' : user ? 'Change correction' : 'Correct this value'}
      </button>
      {user && (
        <>
          {' '}
          <button type="button" onClick={() => session.revert(fact.fact.id)} className="text-sm underline">
            Revert to document value
          </button>
        </>
      )}
      {editing && (
        <ValueEditor
          fact={fact}
          onCancel={() => setEditing(false)}
          onSave={(v, n) => {
            session.correct(fact.fact.id, v, n);
            setEditing(false);
          }}
        />
      )}
      {view.titles[fact.fact.docId] && <span className="sr-only"> in {view.titles[fact.fact.docId]}</span>}
    </li>
  );
}

export function FindingCard({ item, session, view }: { item: ReviewItem; session: Session; view: SessionView }) {
  const { finding, review } = item;
  const [note, setNote] = useState(review.note ?? '');
  const noteId = useId();
  const inputs = finding.inputs.map((i) => view.effective.get(i.factId)).filter((x): x is EffectiveFact => !!x);
  return (
    <article id={`finding-${finding.id}`} aria-labelledby={`h-${finding.id}`} className="space-y-2 rounded border border-slate-400 bg-white p-4">
      <h4 id={`h-${finding.id}`} className="text-lg font-semibold">
        {finding.message}
      </h4>
      <p className="flex flex-wrap items-center gap-2">
        <StatusBadge kind={finding.state === 'confirmed' ? 'confirmed' : 'needs_review'} />
        <span className="rounded border border-slate-700 px-2 py-0.5 text-sm">{SEVERITY[finding.severity] ?? finding.severity}</span>
        <StatusBadge kind={review.status} />
        {review.reopened && <StatusBadge kind="needs_review" label="Reopened: inputs changed since your earlier decision" />}
      </p>
      {finding.reason && <p className="text-sm">Why this is not a confirmed finding: {explainReason(finding.reason)}</p>}
      {inputs.length > 0 && (
        <section aria-label="Values used">
          <h5 className="font-medium">Values used</h5>
          <ul className="divide-y divide-slate-200">
            {inputs.map((f) => (
              <FactLine key={f.fact.id} fact={f} session={session} view={view} />
            ))}
          </ul>
        </section>
      )}
      {finding.evidence.length > 0 && (
        <section aria-label="Source evidence" className="space-y-1">
          <h5 className="font-medium">Source evidence</h5>
          {finding.evidence.map((e, i) => (
            <EvidenceView key={`${e.factId}-${i}`} evidence={e.evidence} role={e.role} view={view} />
          ))}
        </section>
      )}
      <section aria-label="Review decision" className="space-y-1 border-t border-slate-300 pt-2">
        <label htmlFor={noteId} className="block text-sm font-medium">
          Note for this item (optional)
        </label>
        <input id={noteId} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded border border-slate-600 px-2 py-1" />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => session.decide(finding, 'accepted', note)} className="rounded bg-green-800 px-3 py-1 text-white">
            Accept
          </button>
          <button type="button" onClick={() => session.decide(finding, 'dismissed', note)} className="rounded bg-slate-800 px-3 py-1 text-white">
            Dismiss
          </button>
          <button type="button" onClick={() => session.decide(finding, 'open', note)} className="rounded border border-slate-700 px-3 py-1">
            Reopen
          </button>
        </div>
        {review.history.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm">Decision history ({review.history.length})</summary>
            <ul className="list-disc pl-5 text-sm">
              {review.history.map((h, i) => (
                <li key={i}>
                  {h.event}: {h.status}
                  {h.note ? ` (${h.note})` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </article>
  );
}

export function ReviewQueue({ session, view }: { session: Session; view: SessionView }) {
  const confirmed = view.items.filter((i) => i.finding.state === 'confirmed');
  const needs = view.items.filter((i) => i.finding.state === 'needs_review');
  const group = (title: string, items: ReviewItem[], id: string, blurb: string) => (
    <section aria-labelledby={id} className="space-y-3">
      <h3 id={id} className="text-xl font-semibold">
        {title} ({items.length})
      </h3>
      <p className="text-sm text-slate-800">{blurb}</p>
      {items.length === 0 ? <p>None.</p> : items.map((i) => <FindingCard key={i.finding.id} item={i} session={session} view={view} />)}
    </section>
  );
  return (
    <div className="space-y-6">
      {group('Confirmed findings', confirmed, 'confirmed-h', 'Rules ran on validated values and found a difference or stated fact.')}
      {group('Needs review', needs, 'needs-h', 'Uncertain: nothing here is stated as fact until you decide or supply a value. Absences stay here until coverage is confirmed.')}
    </div>
  );
}

// ---------- not evaluated ----------

export function NotEvaluatedList({ comparisons, session, view }: { comparisons: PlannedComparison[]; session: Session; view: SessionView }) {
  const items = comparisons.filter((c) => c.status === 'not_evaluated');
  return (
    <section aria-labelledby="ne-h" className="space-y-3">
      <h3 id="ne-h" className="text-xl font-semibold">
        Not evaluated ({items.length})
      </h3>
      <p className="text-sm text-slate-800">These comparisons did NOT run. That is not the same as "no difference". Each one waits on the input shown.</p>
      {items.length === 0 ? (
        <p>Every planned comparison ran.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => {
            const fact = c.blocked?.factId ? view.effective.get(c.blocked.factId) : undefined;
            return (
              <li key={c.id} className="rounded border border-dashed border-slate-700 bg-slate-50 p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <StatusBadge kind="not_evaluated" />
                  <strong>{c.field.replace(/_/g, ' ')}</strong> <span>({c.docs.map((d) => view.titles[d] ?? d).join(' vs ')})</span>
                </p>
                <p className="text-sm">Reason: {c.reason}</p>
                {c.blocked && (
                  <p className="text-sm">
                    Blocked input: <strong>{c.blocked.field.replace(/_/g, ' ')}</strong> in {view.titles[c.blocked.docId] ?? c.blocked.docId}. {explainReason(c.blocked.reason)}
                  </p>
                )}
                {fact && <ul className="mt-1"><FactLine fact={fact} session={session} view={view} /></ul>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------- documents and facts ----------

export function DocumentsPanel({ session, view }: { session: Session; view: SessionView }) {
  return (
    <section aria-labelledby="docs-h" className="space-y-4">
      <h3 id="docs-h" className="text-xl font-semibold">
        Documents, extracted values and coverage
      </h3>
      {session.fixture.docs.map((d) => {
        const ext = view.documents.get(d.id)!;
        const facts = [...view.effective.values()].filter((f) => f.fact.docId === d.id);
        const unciting = view.uncovered[d.id] ?? [];
        const confirmed = ext.coverage.state !== 'unverified';
        return (
          <details key={d.id} className="rounded border border-slate-400 p-3">
            <summary className="cursor-pointer text-lg font-medium">
              {d.title} <StatusBadge kind={confirmed ? 'verified' : 'unverified'} />
            </summary>
            <p className="mt-2 text-sm">
              Profile {d.profile}. {d.claims.length} recorded claims, {facts.filter((f) => f.usable).length} usable values.
            </p>
            <h4 className="mt-2 font-medium">Source text</h4>
            <ol className="font-mono text-sm">
              {d.blocks.map((b) => (
                <li key={b.id} className="border-b border-slate-200 py-0.5">
                  <span className="mr-2 text-slate-700">{b.id}</span>
                  {b.text}
                </li>
              ))}
            </ol>
            <h4 className="mt-2 font-medium">Extracted values</h4>
            <ul className="divide-y divide-slate-200">
              {facts.map((f) => (
                <FactLine key={f.fact.id} fact={f} session={session} view={view} />
              ))}
            </ul>
            <div className="mt-2 rounded border border-amber-800 bg-amber-50 p-2">
              <p className="text-sm">
                A successful extraction does not prove every item was found. {confirmed ? 'You confirmed this document.' : 'Until you confirm coverage, anything not found stays Needs review.'}
                {unciting.length > 0 && ` Text no extracted value cites: ${unciting.join(', ')}.`}
              </p>
              {!confirmed && (
                <button type="button" onClick={() => session.confirmCoverage(d.id)} className="mt-1 rounded border border-slate-800 px-3 py-1">
                  I checked this document: confirm coverage
                </button>
              )}
            </div>
          </details>
        );
      })}
    </section>
  );
}

// ---------- export ----------

function download(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportPanel({ view, baseName }: { view: SessionView; baseName: string }) {
  const m = view.exportModel;
  return (
    <section aria-labelledby="exp-h" className="space-y-2">
      <h3 id="exp-h" className="text-xl font-semibold">
        Export
      </h3>
      <p className="text-sm">
        Exports keep every state: {m.findings.length} confirmed, {m.unresolved.length} Needs review, {m.notEvaluated.length} Not evaluated, {m.decisions.length} decisions, {m.corrections.length} corrections. Marked SAMPLE (fictional).
      </p>
      <div className="no-print flex flex-wrap gap-2">
        <button type="button" onClick={() => download(`${baseName}-sample.csv`, 'text/csv', exportCsv(view))} className="rounded bg-blue-800 px-3 py-1 text-white">
          Download CSV
        </button>
        <button type="button" onClick={() => download(`${baseName}-sample.txt`, 'text/plain', exportText(view))} className="rounded bg-blue-800 px-3 py-1 text-white">
          Download text draft
        </button>
        <button type="button" onClick={() => window.print()} className="rounded border border-slate-800 px-3 py-1">
          Print or save as PDF
        </button>
      </div>
      <details>
        <summary className="cursor-pointer">Preview of the text export</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-3 text-sm">{exportText(view)}</pre>
      </details>
    </section>
  );
}

// ---------- summary and workspace ----------

export function SummaryBar({ view }: { view: SessionView }) {
  const c = view.exportModel.comparisons;
  return (
    <dl className="flex flex-wrap gap-4 rounded border border-slate-400 bg-slate-50 p-3" aria-label="Summary">
      {[
        ['Confirmed findings', view.exportModel.findings.length],
        ['Needs review', view.exportModel.unresolved.length],
        ['Not evaluated', c.notEvaluated],
        ['Comparisons agree', c.agree],
        ['Comparisons planned', c.planned],
      ].map(([k, v]) => (
        <div key={String(k)}>
          <dt className="text-sm">{k}</dt>
          <dd className="text-2xl font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Everything common to both apps below the domain-specific view. */
export function ReviewWorkspace({ session, baseName, children }: { session: Session; baseName: string; children?: ReactNode }) {
  const { view } = session;
  return (
    <div className="space-y-8">
      <SummaryBar view={view} />
      {children}
      <ReviewQueue session={session} view={view} />
      <NotEvaluatedList comparisons={view.evaluation.comparisons} session={session} view={view} />
      <DocumentsPanel session={session} view={view} />
      <ExportPanel view={view} baseName={baseName} />
    </div>
  );
}

export type { Finding };
