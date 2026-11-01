import type { EffectiveFact, PlannedComparison, ReviewItem } from '@skeleton-key/engine';
import { StatusBadge, explainReason, showValue, type BadgeKind, type SessionView } from '@skeleton-key/ui';
import { itemIdentityKey, linesOf, type ScopeContext } from './adapter';

// ScopeCheck comparison view: each RFQ item against each quotation. Built from the rules' own outputs
// (match resolutions, the comparison ledger, findings). It is computed on every render from the
// session, so a correction or a coverage confirmation changes it immediately.

type Aspect = { field: 'quantity' | 'specification'; label: string; comparison?: PlannedComparison; finding?: ReviewItem };
type Cell = { quote: string; aspects: Aspect[]; absent?: ReviewItem; matched: boolean };
type Row = { key: string | null; description: string; requested: string; cells: Cell[]; uncertain?: ReviewItem; held?: ReviewItem; heldFactId?: string };

const LABEL = { quantity: 'Quantity', specification: 'Specification' } as const;
const CODE = { quantity: 'quantity.differs', specification: 'spec.differs' } as const;

export function buildMatrix(view: SessionView): { rows: Row[]; uncertainQuoteLines: ReviewItem[]; exclusions: { quote: string; item: ReviewItem; text: string }[]; quotes: string[] } {
  const ctx = view.evaluation.context as ScopeContext | undefined;
  if (!ctx) return { rows: [], uncertainQuoteLines: [], exclusions: [], quotes: [] };
  const { data } = ctx;
  const identities = data.identities;
  const byCode = (code: string, pred: (i: ReviewItem) => boolean) => view.items.find((i) => i.finding.code === code && pred(i));
  const rows: Row[] = [];
  for (const line of linesOf(view.effective, data.rfqDocId)) {
    const item = line.f.item as EffectiveFact | undefined;
    if (!item) continue;
    if (!item.usable) {
      // A requested item whose extraction was held keeps its row; nothing about it is compared.
      rows.push({
        key: null,
        description: 'Requested item could not be validated',
        requested: '',
        held: byCode('item.unverified', (i) => i.finding.responseDocId === data.rfqDocId && i.finding.inputs.some((x) => x.factId === item.fact.id)),
        heldFactId: item.fact.id,
        cells: data.quoteDocIds.map((quote) => ({
          quote,
          matched: false,
          aspects: (['quantity', 'specification'] as const).map((field): Aspect => ({ field, label: LABEL[field], comparison: view.evaluation.comparisons.find((c) => c.id === `${field}:held-${item.fact.id}~${quote}`) })),
        })),
      });
      continue;
    }
    const key = itemIdentityKey(item, identities);
    const q = line.f.quantity;
    const s = line.f.specification;
    const requested = [q?.usable ? showValue(q.value) : '', s?.usable ? showValue(s.value) : ''].filter(Boolean).join(', ');
    const cells: Cell[] = data.quoteDocIds.map((quote) => {
      const aspects = (['quantity', 'specification'] as const).map((field): Aspect => ({
        field,
        label: LABEL[field],
        comparison: key ? view.evaluation.comparisons.find((c) => c.id === `${field}:${key}~${quote}`) : undefined,
        finding: key ? byCode(CODE[field], (i) => i.finding.subjectId === `${key}:${field}` && i.finding.responseDocId === quote) : undefined,
      }));
      const absent = key ? byCode('item.absent', (i) => i.finding.subjectId === key && i.finding.responseDocId === quote) : undefined;
      return { quote, aspects, absent, matched: !!key && !absent };
    });
    rows.push({
      key,
      description: String(item.value ?? ''),
      requested,
      cells,
      uncertain: key === null ? byCode('item.identity_uncertain', (i) => i.finding.responseDocId === data.rfqDocId && i.finding.inputs.some((x) => x.factId === item.fact.id)) : undefined,
    });
  }
  const uncertainQuoteLines = view.items.filter((i) => i.finding.code === 'item.identity_uncertain' && data.quoteDocIds.includes(i.finding.responseDocId ?? ''));
  const exclusions = view.items
    .filter((i) => i.finding.code === 'exclusion.stated')
    .map((i) => ({ quote: i.finding.responseDocId ?? '', item: i, text: showValue(i.finding.inputs[0]?.value) }));
  return { rows, uncertainQuoteLines, exclusions, quotes: data.quoteDocIds };
}

const aspectBadge = (a: Aspect): { kind: BadgeKind; text: string } => {
  const c = a.comparison;
  if (!c) return { kind: 'not_evaluated', text: 'Not evaluated' };
  if (c.status === 'not_evaluated') return { kind: 'not_evaluated', text: 'Not evaluated' };
  if (c.status === 'agree') return { kind: 'agree', text: 'Agrees' };
  return { kind: a.finding?.finding.state === 'needs_review' ? 'needs_review' : 'confirmed', text: a.finding?.finding.state === 'needs_review' ? 'Needs review' : 'Differs' };
};

export function ComparisonMatrix({ view }: { view: SessionView }) {
  const { rows, uncertainQuoteLines, exclusions, quotes } = buildMatrix(view);
  return (
    <section aria-labelledby="matrix-h" className="space-y-3">
      <h3 id="matrix-h" className="text-xl font-semibold">
        Comparison: RFQ items against each quotation
      </h3>
      <p className="text-sm text-slate-800">Computed now from the validated values by the ScopeCheck rules. Items are matched by item code, recovered from the source text when the extraction left it out.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Each requested item compared with each quotation: quantity and specification, with the status of every comparison</caption>
          <thead>
            <tr className="bg-slate-100">
              <th scope="col" className="border border-slate-400 p-2">
                Requested item
              </th>
              {quotes.map((q) => (
                <th key={q} scope="col" className="border border-slate-400 p-2">
                  {view.titles[q] ?? q}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key ?? r.heldFactId ?? r.description} className="align-top">
                <th scope="row" className="border border-slate-400 p-2 font-normal">
                  <strong>{r.held ? 'Held item' : (r.key ?? 'Identity uncertain')}</strong>
                  <br />
                  {r.description}
                  <br />
                  <span className="text-sm">Requested: {r.requested || 'not extracted'}</span>
                  {r.held && (
                    <>
                      <br />
                      <a className="text-sm text-blue-900 underline" aria-label={`Open the item: ${r.held.finding.message}`} href={`#finding-${r.held.finding.id}`}>
                        Open the item
                      </a>
                    </>
                  )}
                  {r.uncertain && (
                    <>
                      <br />
                      <a className="text-sm text-blue-900 underline" href={`#finding-${r.uncertain.finding.id}`}>
                        Identity needs review
                      </a>
                    </>
                  )}
                </th>
                {r.cells.map((c) => (
                  <td key={c.quote} className="border border-slate-400 p-2">
                    {c.absent ? (
                      <p>
                        <StatusBadge kind={c.absent.finding.state === 'confirmed' ? 'confirmed' : 'needs_review'} label={c.absent.finding.state === 'confirmed' ? 'Not in this quotation' : 'Not found: Needs review'} />
                        <br />
                        <span className="text-sm">{explainReason(c.absent.finding.reason)}</span>{' '}
                        <a className="text-sm text-blue-900 underline" aria-label={`Open the item: ${c.absent.finding.message}`} href={`#finding-${c.absent.finding.id}`}>
                          Open the item
                        </a>
                      </p>
                    ) : null}
                    <ul className="space-y-1">
                      {c.aspects.map((a) => {
                        const b = aspectBadge(a);
                        return (
                          <li key={a.field}>
                            <span className="font-medium">{a.label}: </span>
                            <StatusBadge kind={b.kind} label={b.text} />
                            {a.comparison?.detail && <span className="ml-1 text-sm">{a.comparison.detail}</span>}
                            {!!a.comparison?.userSupplied?.length && (
                              <span className="ml-1">
                                <StatusBadge kind="user_supplied" label="uses a value you supplied" />
                              </span>
                            )}
                            {a.comparison?.status === 'not_evaluated' && <span className="block text-sm">{a.comparison.reason}</span>}
                            {a.finding && (
                              <>
                                {' '}
                                <a className="text-sm text-blue-900 underline" aria-label={`Open the finding: ${a.finding.finding.message}`} href={`#finding-${a.finding.finding.id}`}>
                                  Open the finding
                                </a>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {uncertainQuoteLines.length > 0 && (
        <div>
          <h4 className="font-medium">Quotation lines whose item identity is uncertain</h4>
          <ul className="list-disc pl-5">
            {uncertainQuoteLines.map((i) => (
              <li key={i.finding.id}>
                {view.titles[i.finding.responseDocId ?? ''] ?? i.finding.responseDocId}: {explainReason(i.finding.reason)}{' '}
                <a className="text-blue-900 underline" href={`#finding-${i.finding.id}`}>
                  Open the item
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {exclusions.length > 0 && (
        <div>
          <h4 className="font-medium">Stated exclusions (unpriced)</h4>
          <ul className="list-disc pl-5">
            {exclusions.map((e) => (
              <li key={e.item.finding.id}>
                {view.titles[e.quote] ?? e.quote}: {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
