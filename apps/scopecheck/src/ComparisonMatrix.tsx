import type { PlannedComparison, ReviewItem } from '@skeleton-key/engine';
import { ScrollTable, StatusBadge, showValue, type BadgeKind, type SessionView } from '@skeleton-key/ui';
import { requirementsOf, type ScopeContext } from './adapter';
import type { Line } from './adapter/rules';
import { EXCLUDED_TEXT, formatAmount, totalsFor, type QuoteTotal } from './totals';

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

const money = (t: QuoteTotal, fixed2: string) => `${t.currency ? `${t.currency} ` : ''}${formatAmount(fixed2)}${t.currency ? '' : ' (currency not stated)'}`;

/** "Total as quoted", one row per quotation, under the matrix. A number per quotation only: no ranking, no recommendation. */
export function TotalsTable({ view }: { view: SessionView }) {
  const ctx = view.evaluation.context as ScopeContext | undefined;
  if (!ctx) return null;
  const totals = totalsFor(view.effective, ctx.data.quoteDocIds);
  return (
    <div className="space-y-2">
      <h4 id="totals-h" className="font-medium">
        Total as quoted
      </h4>
      <p className="text-sm text-slate-800">
        Each quotation line&apos;s validated unit price times its validated quantity, added up in code. A line with a price or quantity that is held for review or missing is left out and counted, and the total is then shown as incomplete. Quotations are not ranked or compared here.
      </p>
      <ScrollTable label="Total as quoted for each quotation">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Total as quoted for each quotation, with the number of lines counted and left out</caption>
          <thead>
            <tr className="bg-slate-100">
              <th scope="col" className="border border-slate-400 p-2">Quotation</th>
              <th scope="col" className="border border-slate-400 p-2">Total as quoted</th>
              <th scope="col" className="border border-slate-400 p-2">Lines counted</th>
              <th scope="col" className="border border-slate-400 p-2">Lines excluded</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.quote} className="align-top" data-testid={`total-${t.quote}`}>
                <th scope="row" className="border border-slate-400 p-2 font-normal">{view.docName(t.quote)}</th>
                <td className="border border-slate-400 p-2">
                  {t.state === 'complete' && <strong>{money(t, t.sum!)}</strong>}
                  {t.state === 'incomplete' && (
                    <>
                      <StatusBadge kind="needs_review" label={`Incomplete: ${t.excluded.length} ${t.excluded.length === 1 ? 'line' : 'lines'} excluded`} />
                      <br />
                      <span className="text-sm">Sum of the {t.counted.length} counted {t.counted.length === 1 ? 'line' : 'lines'} only, not the quotation total: {money(t, t.sum!)}</span>
                    </>
                  )}
                  {t.state === 'none' && (
                    <>
                      <StatusBadge kind="needs_review" label={`Incomplete: ${t.excluded.length} ${t.excluded.length === 1 ? 'line' : 'lines'} excluded`} />
                      <br />
                      <span className="text-sm">No line has both a validated unit price and a validated quantity, so there is nothing to add up.</span>
                    </>
                  )}
                  {t.state === 'mixed_currency' && (
                    <>
                      <StatusBadge kind="needs_review" label="Not totalled: more than one currency" />
                      <br />
                      <span className="text-sm">The counted lines use different currencies ({t.currencies.map((c) => c ?? 'not stated').join(', ')}), so they are not added together.</span>
                    </>
                  )}
                </td>
                <td className="border border-slate-400 p-2">{t.counted.length}</td>
                <td className="border border-slate-400 p-2">
                  {t.excluded.length}
                  {t.excluded.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-blue-900 underline">Show which lines</summary>
                      <ul className="list-disc pl-5">
                        {t.excluded.map((x) => {
                          const n = view.lineNumber(t.quote, x.blockId);
                          return (
                            <li key={x.blockId}>
                              {n ? `Line ${n}` : 'A line'}: {x.reasons.map((r) => EXCLUDED_TEXT[r]).join('; ')}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
    </div>
  );
}

export function ComparisonMatrix({ view }: { view: SessionView }) {
  const { rows, uncertainQuoteLines, exclusions, quotes } = buildMatrix(view);
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
        </table>
      </ScrollTable>
      <TotalsTable view={view} />
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
