import type { PlannedComparison, ReviewItem } from '@skeleton-key/engine';
import { ScrollTable, StatusBadge, showValue, type BadgeKind, type SessionView } from '@skeleton-key/ui';
import { requirementsOf, type ScopeContext } from './adapter';
import type { Line } from './adapter/rules';

// ScopeCheck comparison view: each RFQ item against each quotation. Built from the rules' own outputs
// (match resolutions, the comparison ledger, findings). It is computed on every render from the
// session, so a correction or a coverage confirmation changes it immediately.

type Aspect = { field: 'quantity' | 'specification'; label: string; comparison?: PlannedComparison; finding?: ReviewItem };
type Cell = { quote: string; aspects: Aspect[]; absent?: ReviewItem; ambiguous?: ReviewItem; matched: boolean };
type Row = { /** unique per requirement line, even when two lines name the same item */ rowId: string; key: string | null; description: string; requested: string; cells: Cell[]; uncertain?: ReviewItem; held?: ReviewItem; heldFactId?: string };

const LABEL = { quantity: 'Quantity', specification: 'Specification' } as const;
const CODE = { quantity: 'quantity.differs', specification: 'spec.differs' } as const;

export function buildMatrix(view: SessionView): { rows: Row[]; uncertainQuoteLines: ReviewItem[]; exclusions: { quote: string; item: ReviewItem; text: string }[]; quotes: string[] } {
  const ctx = view.evaluation.context as ScopeContext | undefined;
  if (!ctx) return { rows: [], uncertainQuoteLines: [], exclusions: [], quotes: [] };
  const { data } = ctx;
  const byCode = (code: string, pred: (i: ReviewItem) => boolean) => view.items.find((i) => i.finding.code === code && pred(i));
  const ledger = (id: string) => view.evaluation.comparisons.find((c) => c.id === id);
  const { reqs, multi, held } = requirementsOf(view.effective, data);
  const rows: Row[] = [];

  // Requested lines that could not be used keep their row; nothing about them is compared.
  const blocked = (line: Line, tag: string, description: string, code: string): Row => {
    const first = (line.all.item ?? [line.f.item!])[0]!;
    return {
      rowId: `${tag}`,
      key: null,
      description,
      requested: '',
      held: byCode(code, (i) => i.finding.responseDocId === data.rfqDocId && i.finding.inputs.some((x) => x.factId === first.fact.id)),
      heldFactId: first.fact.id,
      cells: data.quoteDocIds.map((quote) => ({
        quote,
        matched: false,
        aspects: (['quantity', 'specification'] as const).map((field): Aspect => ({ field, label: LABEL[field], comparison: ledger(`${field}:${tag}~${quote}`) })),
      })),
    };
  };
  for (const l of held) rows.push(blocked(l, `held-${l.f.item!.fact.id}`, 'Requested item could not be validated', 'item.unverified'));
  for (const l of multi) rows.push(blocked(l, `multi-${l.blockId}`, 'Several items were extracted from one requested line', 'item.multiple_items'));

  for (const r of reqs) {
    const item = r.line.f.item!;
    const q = r.line.f.quantity;
    const sp = r.line.f.specification;
    const requested = [q?.usable ? showValue(q.value) : '', sp?.usable ? showValue(sp.value) : ''].filter(Boolean).join(', ');
    const cells: Cell[] = data.quoteDocIds.map((quote) => {
      const aspects = (['quantity', 'specification'] as const).map((field): Aspect => ({
        field,
        label: LABEL[field],
        comparison: r.key ? ledger(`${field}:${r.reqId}~${quote}`) : undefined,
        finding: r.key ? byCode(CODE[field], (i) => i.finding.subjectId === `${r.reqId}:${field}` && i.finding.responseDocId === quote) : undefined,
      }));
      const absent = r.key ? byCode('item.absent', (i) => i.finding.subjectId === r.reqId && i.finding.responseDocId === quote) : undefined;
      const ambiguous = r.key ? byCode('item.allocation_ambiguous', (i) => i.finding.subjectId === r.reqId && i.finding.responseDocId === quote) : undefined;
      return { quote, aspects, absent, ambiguous, matched: !!r.key && !absent && !ambiguous };
    });
    rows.push({
      rowId: r.reqId,
      key: r.key,
      description: String(item.value ?? ''),
      requested,
      cells,
      uncertain: r.key === null ? byCode('item.identity_uncertain', (i) => i.finding.subjectId === r.reqId) : undefined,
    });
  }
  const uncertainQuoteLines = view.items.filter((i) => ['item.identity_uncertain', 'item.multiple_items'].includes(i.finding.code) && data.quoteDocIds.includes(i.finding.responseDocId ?? ''));
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
  const totals = (view.evaluation.context as ScopeContext | undefined)?.totals;
  return (
    <section aria-labelledby="matrix-h" className="space-y-3">
      <h3 id="matrix-h" className="text-xl font-semibold">
        Comparison: RFQ items against each quotation
      </h3>
      <p className="text-sm text-slate-800">Computed now from the validated values by the ScopeCheck rules. Items are matched by item code, recovered from the source text when the extraction left it out.</p>
      <ScrollTable label="Comparison: RFQ items against each quotation">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Each requested item compared with each quotation: quantity and specification, with the status of every comparison</caption>
          <thead>
            <tr className="bg-slate-100">
              <th scope="col" className="border border-slate-400 p-2">
                Requested item
              </th>
              {quotes.map((q) => (
                <th key={q} scope="col" className="border border-slate-400 p-2">
                  {view.docName(q)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowId} className="align-top">
                <th scope="row" className="border border-slate-400 p-2 font-normal">
                  <strong>{r.held ? 'Held item' : (r.key ?? 'Identity uncertain')}</strong>
                  {r.key && r.rowId !== r.key && (() => {
                    const n = view.lineNumber(view.evaluation.context ? (view.evaluation.context as ScopeContext).data.rfqDocId : '', r.rowId.split('@')[1] ?? '');
                    return <span className="text-sm"> ({n ? `requirement on line ${n}` : 'one of several requirement lines'})</span>;
                  })()}
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
                    {c.ambiguous && (
                      <p>
                        <StatusBadge kind="needs_review" label="Allocation unclear: Needs review" />
                        <br />
                        <span className="text-sm">{view.reasonText('ambiguous_allocation')}</span>{' '}
                        <a className="text-sm text-blue-900 underline" aria-label={`Open the item: ${c.ambiguous.finding.message}`} href={`#finding-${c.ambiguous.finding.id}`}>
                          Open the item
                        </a>
                      </p>
                    )}
                    {c.absent ? (
                      <p>
                        <StatusBadge kind={c.absent.finding.state === 'confirmed' ? 'confirmed' : 'needs_review'} label={c.absent.finding.state === 'confirmed' ? 'Not in this quotation' : 'Not found: Needs review'} />
                        <br />
                        <span className="text-sm">{view.reasonText(c.absent.finding.reason)}</span>{' '}
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
                            {a.comparison?.status === 'not_evaluated' && <span className="block text-sm">{view.reasonText(a.comparison.reason)}</span>}
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
          {totals && (
            <tfoot>
              <tr className="align-top bg-slate-50" data-total-row="">
                <th scope="row" className="border border-slate-400 p-2 font-normal">
                  <strong>Total as quoted</strong>
                  <br />
                  <span className="text-sm">Quantity × unit price for each line, added up from validated values. Not a ranking or a recommendation.</span>
                </th>
                {quotes.map((q) => {
                  const t = totals[q];
                  if (!t) return <td key={q} className="border border-slate-400 p-2" />;
                  const excluded = t.excluded;
                  return (
                    <td key={q} className="border border-slate-400 p-2" data-total-for={q}>
                      {t.complete && t.total ? (
                        <>
                          <span className="font-semibold">{showValue(t.total)}</span>
                          <span className="block text-sm">All {t.lines} line{t.lines === 1 ? '' : 's'} included.</span>
                        </>
                      ) : (
                        <>
                          <StatusBadge kind="needs_review" label="Incomplete" />
                          {t.total && (
                            <span className="block">
                              <span className="font-semibold">{showValue(t.total)}</span> <span className="text-sm">from {t.included} of {t.lines} lines</span>
                            </span>
                          )}
                          <span className="block text-sm">
                            {t.reason === 'currency_differs'
                              ? 'The lines are in different currencies, so they are not added up.'
                              : t.reason === 'unknown_currency'
                                ? 'A line has no known currency, so the lines are not added up.'
                                : t.reason === 'no_lines'
                                  ? 'No priced lines were extracted.'
                                  : `${excluded} line${excluded === 1 ? '' : 's'} excluded: a price or quantity is held or missing${t.excludedLines.some((x) => x.why === 'several_items') ? ', or one line carries several items' : ''}. The total covers only the lines included.`}
                          </span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </ScrollTable>
      {uncertainQuoteLines.length > 0 && (
        <div>
          <h4 className="font-medium">Quotation lines whose item identity is uncertain or that carry several items</h4>
          <ul className="list-disc pl-5">
            {uncertainQuoteLines.map((i) => (
              <li key={i.finding.id}>
                {view.docName(i.finding.responseDocId ?? '')}: {view.reasonText(i.finding.reason) || 'Needs review.'}{' '}
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
                {view.docName(e.quote)}: {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
