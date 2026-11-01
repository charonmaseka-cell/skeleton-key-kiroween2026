import type { PlannedComparison, ReviewItem } from '@skeleton-key/engine';
import { StatusBadge, explainReason, type BadgeKind, type SessionView } from '@skeleton-key/ui';

// PackCheck check tables, built from the comparison ledger the rules produce on every run.
// Attachment checks: what the call requires against what the application form lists.
// Field checks: the same fact across documents (name, funding, dates) and funding against budget.

const badge = (c: PlannedComparison, f?: ReviewItem): { kind: BadgeKind; text: string } => {
  if (c.status === 'not_evaluated') return { kind: 'not_evaluated', text: 'Not evaluated' };
  if (c.status === 'agree') return { kind: 'agree', text: 'Agrees' };
  return f?.finding.state === 'confirmed' ? { kind: 'confirmed', text: 'Differs' } : { kind: 'needs_review', text: 'Needs review' };
};

function findingFor(view: SessionView, c: PlannedComparison): ReviewItem | undefined {
  const resp = c.docs[1];
  return view.items.find((i) => {
    const f = i.finding;
    if (c.check === 'attachment_listed') return f.code === 'attachment.missing' && c.id === `attachment_listed:${f.subjectId}`;
    if (c.check === 'funding_within_budget') return f.code === 'funding.exceeds_budget' && f.responseDocId === resp;
    return f.contextId === 'form-vs-supporting' && f.subjectId === c.field && f.responseDocId === resp;
  });
}

function Table({ title, id, rows, view, cols }: { title: string; id: string; rows: PlannedComparison[]; view: SessionView; cols: [string, string] }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h3 id={id} className="text-xl font-semibold">
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="bg-slate-100">
              <th scope="col" className="border border-slate-400 p-2">
                {cols[0]}
              </th>
              <th scope="col" className="border border-slate-400 p-2">
                {cols[1]}
              </th>
              <th scope="col" className="border border-slate-400 p-2">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const f = findingFor(view, c);
              const b = badge(c, f);
              return (
                <tr key={c.id} className="align-top">
                  <th scope="row" className="border border-slate-400 p-2 font-normal">
                    {c.field.replace(/_/g, ' ')}
                    <br />
                    <span className="text-sm">{c.docs.map((d) => view.titles[d] ?? d).join(' vs ')}</span>
                  </th>
                  <td className="border border-slate-400 p-2">{c.detail ?? <span className="text-sm">{c.reason}</span>}</td>
                  <td className="border border-slate-400 p-2">
                    <StatusBadge kind={b.kind} label={b.text} />
                    {c.status === 'not_evaluated' && <span className="block text-sm">{c.reason}</span>}
                    {c.status === 'flagged' && c.reason && <span className="block text-sm">{explainReason(c.reason)}</span>}
                    {f && (
                      <a className="text-sm text-blue-900 underline" href={`#finding-${f.finding.id}`}>
                        Open the item
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Checks({ view }: { view: SessionView }) {
  const all = view.evaluation.comparisons;
  const attach = all.filter((c) => c.check === 'attachment_listed');
  const fields = all.filter((c) => c.check !== 'attachment_listed');
  return (
    <div className="space-y-8">
      <Table title="Attachment checks: required against listed" id="attach-h" rows={attach} view={view} cols={['Required attachment', 'Result detail']} />
      <Table title="Field checks: the same value across documents" id="fields-h" rows={fields} view={view} cols={['Field', 'Values compared']} />
    </div>
  );
}
