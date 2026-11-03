import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { formatValue, processingComplete, type EffectiveFact, type Evidence, type Finding, type PlannedComparison, type ReviewItem, type ValueKind } from '@skeleton-key/engine';
import { StatusBadge } from './Badges';
import { FadingGhost, NextFinding, SeanceArt, WaxSeal, useHaunt } from './Haunt';
import { EmptyState } from './Motifs';
import { Seance } from './Seance';
import { ThemeName } from './ThemeProvider';
import { exportCsv, exportText, parseCorrection, type CorrectionInput, type SessionView } from './session-core';
import type { Session } from './useSession';

// Shared review workspace pieces used by both apps. Keyboard operable: native buttons, links, inputs
// with labels, visible focus (set in each app's CSS), no pointer-only interaction.

/** One formatter for every display of a value (shared with the adapters, from the engine). */
export const showValue = formatValue;

// ---------- evidence ----------

function Highlighted({ text, start, end }: { text: string; start: number; end: number }) {
  return (
    <span className="font-mono text-sm">
      {text.slice(0, start)}
      <mark className="rounded bg-sk-mark-bg px-0.5 text-sk-mark-text outline outline-1 outline-sk-accent">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </span>
  );
}

export function EvidenceView({ evidence, role, view }: { evidence: Evidence; role?: string; view: SessionView }) {
  const block = view.blocksByDoc.get(evidence.docId)?.find((b) => b.id === evidence.blockId);
  const intact = !!block && block.text.slice(evidence.start, evidence.end) === evidence.text;
  return (
    <figure className="rounded border border-sk-border bg-sk-surface p-2">
      <figcaption className="text-sm text-sk-muted">
        {view.docName(evidence.docId)}
        {(() => {
          const n = view.lineNumber(evidence.docId, evidence.blockId);
          return n ? `, line ${n}` : '';
        })()}
        {block?.page ? `, page ${block.page}` : ''}
        {role === 'superseded_original' ? ' (original value, replaced by your correction)' : ''}
        {/* Evidence detail: the block reference is shown here and nowhere else. */}
        <span data-evidence-ref="" className="ml-1 text-xs text-sk-muted">(source reference {evidence.blockId})</span>
      </figcaption>
      {block && intact ? <Highlighted text={block.text} start={evidence.start} end={evidence.end} /> : <p className="text-sm text-sk-danger">Source text not available or changed: this evidence cannot be shown.</p>}
    </figure>
  );
}

// ---------- correction editor ----------

export function ValueEditor({ fact, label, onSave, onCancel }: { fact: EffectiveFact; /** the field's plain label */ label: string; onSave: (value: unknown, note?: string) => void; onCancel: () => void }) {
  const id = useId();
  const kind = fact.fact.kind as ValueKind;
  // The currency is taken from the original value; it is never assumed.
  const original = fact.fact.value as { currency?: string | null } | null;
  const [input, setInput] = useState<CorrectionInput>({ currency: kind === 'money' ? (original?.currency ?? '') : '' });
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
      <input id={`${id}-${k}`} autoFocus={k === first} value={input[k] ?? ''} onChange={set(k)} aria-describedby={error ? `${id}-err` : undefined} className="w-full rounded border border-sk-border px-2 py-1" placeholder={hint} />
    </div>
  );
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded border-2 border-sk-info bg-sk-surface p-3" aria-label={`Correct ${label}`}>
      <p className="text-sm">
        Supply the correct value for <strong>{label}</strong>. The document value ({showValue(fact.fact.value)}) is kept and the new value is labelled user-supplied.
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
        <input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded border border-sk-border px-2 py-1" />
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-sk-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="rounded bg-sk-text px-3 py-1 font-medium text-sk-bg">
          Save correction
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-sk-border px-3 py-1">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------- findings ----------

const SEVERITY: Record<string, string> = { critical: 'Critical', high: 'High', warning: 'Warning', info: 'Info' };

/** `context` names the place the value is shown in (a finding, a Not-evaluated item), so repeated controls for one value stay distinguishable. */
export function FactLine({ fact, session, view, context }: { fact: EffectiveFact; session: Session; view: SessionView; context?: string }) {
  const [editing, setEditing] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const user = fact.provenance === 'user_supplied';
  const where = view.docName(fact.fact.docId);
  const label = view.fieldLabel(fact.fact.field);
  // The control that had focus is replaced by the result of the action; put focus back on a stable button.
  // If the whole item disappears (the correction resolved it), focus goes to the main region, never to the document body.
  const refocus = () =>
    setTimeout(() => {
      if (toggle.current && document.contains(toggle.current)) toggle.current.focus();
      else document.getElementById('main')?.focus();
    }, 0);
  const tail = context ? ` (${context})` : '';
  return (
    <li className="py-1">
      <span className="font-medium">{label}</span>: <span className="break-words">{showValue(fact.value)}</span>{' '}
      {user ? <StatusBadge kind="user_supplied" /> : fact.status === 'validated' ? <StatusBadge kind="validated" /> : <StatusBadge kind="needs_review" label="Held" />}
      {!user && fact.status !== 'validated' && <span className="ml-1 text-sm">{view.reasonText(fact.fact.reason)}</span>}
      {user && <span className="ml-1 text-sm">(document said {showValue(fact.fact.value)})</span>}{' '}
      <button ref={toggle} type="button" onClick={() => setEditing((e) => !e)} aria-expanded={editing} aria-label={`${editing ? 'Close' : user ? 'Change correction' : 'Correct this value'}: ${label} (${formatValue(fact.value)}) in ${where}${tail}`} className="text-sm underline">
        {editing ? 'Close' : user ? 'Change correction' : 'Correct this value'}
      </button>
      {user && (
        <>
          {' '}
          <button type="button" aria-label={`Revert to document value: ${label} (${formatValue(fact.value)}) in ${where}${tail}`} onClick={() => { session.revert(fact.fact.id); refocus(); }} className="text-sm underline">
            Revert to document value
          </button>
        </>
      )}
      {editing && (
        <ValueEditor
          fact={fact}
          label={label}
          onCancel={() => { setEditing(false); refocus(); }}
          onSave={(v, n) => {
            session.correct(fact.fact.id, v, n);
            setEditing(false);
            refocus();
          }}
        />
      )}
    </li>
  );
}

export function FindingCard({ item, session, view }: { item: ReviewItem; session: Session; view: SessionView }) {
  const { finding, review } = item;
  const [note, setNote] = useState(review.note ?? '');
  const noteId = useId();
  // A reopen clears the stored note; the input must follow it.
  useEffect(() => setNote(review.note ?? ''), [review.note, review.history.length]);
  const inputs = finding.inputs.map((i) => view.effective.get(i.factId)).filter((x): x is EffectiveFact => !!x);
  const pair = /differs$/.test(finding.code) && new Set(finding.evidence.map((e) => e.evidence.docId)).size >= 2;
  const haunt = useHaunt();
  // HU-22: a seal stamps and a ghost fades only when a decision is made here, not when the card arrives already decided. "Just now"
  // is a short-lived state, so an unrelated re-render a moment later does not cut the effect short.
  const prevStatus = useRef(review.status);
  const [justNow, setJustNow] = useState<string | null>(null);
  useEffect(() => {
    if (prevStatus.current === review.status) return;
    prevStatus.current = review.status;
    setJustNow(review.status);
    const t = setTimeout(() => setJustNow(null), 1800);
    return () => clearTimeout(t);
  }, [review.status]);
  const dismissed = haunt.effects && review.status === 'dismissed';
  return (
    <article id={`finding-${finding.id}`} tabIndex={-1} aria-labelledby={`h-${finding.id}`} data-dismissed={dismissed ? '' : undefined} className="relative space-y-2 rounded border border-sk-border bg-sk-surface p-4">
      {dismissed && justNow === 'dismissed' && <FadingGhost />}
      <h4 id={`h-${finding.id}`} className="break-words text-lg font-semibold">
        {finding.message}
        <ThemeName entry={view.theme[finding.code]} state={finding.state} />
      </h4>
      <p className="flex flex-wrap items-center gap-2">
        <StatusBadge kind={finding.state === 'confirmed' ? 'confirmed' : 'needs_review'} />
        <span className="rounded border border-sk-border px-2 py-0.5 text-sm">{SEVERITY[finding.severity] ?? finding.severity}</span>
        <StatusBadge kind={review.status} />
        {review.reopened && <StatusBadge kind="needs_review" label="Reopened: inputs changed since your earlier decision" />}
      </p>
      {finding.reason && <p className="text-sm">{finding.state === 'confirmed' ? 'Note' : 'Why this is not a confirmed finding'}: {view.reasonText(finding.reason)}</p>}
      {inputs.length > 0 && (
        <div role="group" aria-label="Values used">
          <h5 className="font-medium">Values used</h5>
          <ul className="divide-y divide-sk-border">
            {inputs.map((f) => (
              <FactLine key={f.fact.id} fact={f} session={session} view={view} context={finding.message} />
            ))}
          </ul>
        </div>
      )}
      {finding.evidence.length > 0 && (
        <div role="group" aria-label="Source evidence" className="space-y-1">
          <h5 className="font-medium">Source evidence</h5>
          {/* A difference between two documents shows both source lines side by side (stacked on narrow screens), each with the cited words marked. */}
          <div data-evidence="" data-evidence-pair={pair ? '' : undefined} data-glow={haunt.glowId === finding.id ? '' : undefined} className={pair ? 'grid gap-2 sm:grid-cols-2' : 'space-y-1'}>
            {finding.evidence.map((e, i) => (
              <EvidenceView key={`${e.factId}-${i}`} evidence={e.evidence} role={e.role} view={view} />
            ))}
          </div>
        </div>
      )}
      <div role="group" aria-label="Review decision" className="space-y-1 border-t border-sk-border pt-2">
        <label htmlFor={noteId} className="block text-sm font-medium">
          Note for this item (optional)<span className="sr-only">: {finding.message}</span>
        </label>
        <input id={noteId} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded border border-sk-border px-2 py-1" />
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-label={`Accept: ${finding.message}`} onClick={() => session.decide(finding, 'accepted', note)} className="rounded bg-sk-ok px-3 py-1 text-sk-bg">
            Accept
          </button>
          <button type="button" aria-label={`Dismiss: ${finding.message}`} onClick={() => session.decide(finding, 'dismissed', note)} className="rounded bg-sk-muted px-3 py-1 text-sk-bg">
            Dismiss
          </button>
          <button type="button" aria-label={`Reopen: ${finding.message}`} onClick={() => session.decide(finding, 'open', note)} className="rounded border border-sk-border px-3 py-1">
            Reopen
          </button>
          {review.status === 'accepted' && <WaxSeal fresh={justNow === 'accepted'} />}
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
      </div>
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
      <p className="text-sm text-sk-muted">{blurb}</p>
      {items.length === 0 ? <EmptyState><p>None.</p></EmptyState> : items.map((i) => <FindingCard key={i.finding.id} item={i} session={session} view={view} />)}
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
      <p className="text-sm text-sk-muted">These comparisons did NOT run. That is not the same as "no difference". Each one waits on the input shown.</p>
      {items.length === 0 ? (
        <EmptyState><p>Every planned comparison ran.</p></EmptyState>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => {
            const fact = c.blocked?.factId ? view.effective.get(c.blocked.factId) : undefined;
            return (
              <li key={c.id} className="rounded border border-dashed border-sk-border bg-sk-surface p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <StatusBadge kind="not_evaluated" />
                  <strong>{view.fieldLabel(c.field)}</strong> <span>({c.docs.map(view.docName).join(' vs ')})</span>
                </p>
                <p className="text-sm">Reason: {view.reasonText(c.reason)}</p>
                {c.blocked && (
                  <p className="text-sm">
                    Blocked input: <strong>{view.fieldLabel(c.blocked.field)}</strong> in {view.docName(c.blocked.docId)}. {view.reasonText(c.blocked.reason)}
                  </p>
                )}
                {fact && <ul className="mt-1"><FactLine fact={fact} session={session} view={view} context={`blocking: ${view.fieldLabel(c.field)}`} /></ul>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------- documents and facts ----------

/** Beside a document whose coverage is unverified: what confirming does, and what it does not. */
export const COVERAGE_HINT = 'Confirm coverage after checking every page. This lets us confirm missing items where the match is clear.';

export function DocumentsPanel({ session, view }: { session: Session; view: SessionView }) {
  return (
    <section aria-labelledby="docs-h" className="space-y-4">
      <h3 id="docs-h" className="text-xl font-semibold">
        Documents, extracted values and coverage
      </h3>
      {session.fixture.docs.map((d) => {
        const ext = view.documents.get(d.id)!;
        const facts = [...view.effective.values()].filter((f) => f.fact.docId === d.id);
        const unciting = new Set(view.uncovered[d.id] ?? []);
        const confirmed = ext.coverage.state !== 'unverified';
        const complete = processingComplete(ext);
        const failedBlocks = new Set((d.chunks ?? []).filter((c) => c.status === 'failed').flatMap((c) => c.blockIds));
        const focusSummary = () => setTimeout(() => document.getElementById(`doc-sum-${d.id}`)?.focus(), 0);
        return (
          <details key={d.id} className="rounded border border-sk-border p-3">
            <summary id={`doc-sum-${d.id}`} className="cursor-pointer text-lg font-medium">
              {d.title} <StatusBadge kind={confirmed ? 'verified' : 'unverified'} label={!complete ? 'Part of the document was not processed' : undefined} />
              {d.note && (
                <span data-doc-note="" className="mt-1 block text-sm font-normal">
                  {d.note}
                </span>
              )}
              {/* Shown only where confirming is possible: a document with a part that was not processed cannot be confirmed (its own note below says so). */}
              {complete && !confirmed && (
                <span data-coverage-hint="" className="mt-1 block text-sm font-normal">
                  {COVERAGE_HINT}
                </span>
              )}
            </summary>
            <p className="mt-2 text-sm">
              {d.claims.length} extracted values recorded, {facts.filter((f) => f.usable).length} usable.
            </p>
            <h4 className="mt-2 font-medium">Source text</h4>
            <ol className="list-decimal pl-8 font-mono text-sm">
              {d.blocks.map((b) => (
                <li key={b.id} className="break-words border-b border-sk-border py-0.5">
                  {b.text}
                  {failedBlocks.has(b.id) ? <span className="ml-2 font-sans text-xs font-medium">(not processed)</span> : unciting.has(b.id) ? <span className="ml-2 font-sans text-xs">(no extracted value cites this line)</span> : null}
                </li>
              ))}
            </ol>
            <h4 className="mt-2 font-medium">Extracted values</h4>
            <ul className="divide-y divide-sk-border">
              {facts.map((f) => (
                <FactLine key={f.fact.id} fact={f} session={session} view={view} />
              ))}
            </ul>
            <div className="mt-2 rounded border border-sk-accent bg-sk-surface p-2">
              <p className="text-sm">
                A successful extraction does not prove every item was found. {confirmed ? 'You confirmed this document.' : 'Until you confirm coverage, anything not found stays Needs review.'}
                {unciting.size > 0 && ` ${unciting.size} line${unciting.size === 1 ? '' : 's'} of source text ${unciting.size === 1 ? 'is' : 'are'} not cited by any extracted value (marked in the source text).`}
              </p>
              {!complete && (
                <p role="note" className="mt-1 text-sm font-medium">
                  Extraction of this document is incomplete{failedBlocks.size ? ` (${failedBlocks.size} line${failedBlocks.size === 1 ? '' : 's'} not processed, marked in the source text)` : ''}. Coverage cannot be confirmed, so nothing absent from it can be stated as fact.
                </p>
              )}
              {complete && !confirmed && (
                <button type="button" aria-label={`I checked this document: confirm coverage of ${d.title}`} onClick={() => { session.confirmCoverage(d.id); focusSummary(); }} className="mt-1 rounded border border-sk-border px-3 py-1">
                  I checked this document: confirm coverage
                </button>
              )}
              {confirmed && (
                <button type="button" aria-label={`Withdraw my coverage confirmation for ${d.title}`} onClick={() => { session.withdrawCoverage(d.id); focusSummary(); }} className="mt-1 rounded border border-sk-border px-3 py-1">
                  Withdraw my coverage confirmation
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

export function download(name: string, mime: string, content: string) {
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
        <button type="button" onClick={() => download(`${baseName}-sample.csv`, 'text/csv', exportCsv(view))} className="rounded bg-sk-text px-3 py-1 text-sk-bg">
          Download CSV
        </button>
        <button type="button" onClick={() => download(`${baseName}-sample.txt`, 'text/plain', exportText(view))} className="rounded bg-sk-text px-3 py-1 text-sk-bg">
          Download text draft
        </button>
        <button type="button" onClick={() => window.print()} className="rounded border border-sk-border px-3 py-1">
          Print or save as PDF
        </button>
      </div>
      <details>
        <summary className="cursor-pointer">Preview of the text export</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-sk-surface p-3 text-sm">{exportText(view)}</pre>
      </details>
    </section>
  );
}

// ---------- summary and workspace ----------

export function SummaryBar({ view }: { view: SessionView }) {
  const c = view.exportModel.comparisons;
  return (
    <dl className="flex flex-wrap gap-4 rounded border border-sk-border bg-sk-surface p-3" aria-label="Summary">
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
  const haunt = useHaunt();
  return (
    <div className="space-y-8">
      <div className={`grid gap-4 ${haunt.effects ? 'md:grid-cols-[1fr_1fr_auto]' : 'md:grid-cols-2'}`}>
        <Seance view={view} />
        <SummaryBar view={view} />
        <SeanceArt />
      </div>
      <NextFinding />
      {children}
      <ReviewQueue session={session} view={view} />
      <NotEvaluatedList comparisons={view.evaluation.comparisons} session={session} view={view} />
      <DocumentsPanel session={session} view={view} />
      <ExportPanel view={view} baseName={baseName} />
    </div>
  );
}

export type { Finding };
