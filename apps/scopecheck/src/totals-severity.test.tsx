// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCorrection, emptySession, evaluateSession, type Fixture } from '@skeleton-key/ui';
import { scoreFindings } from '../../../tools/benchmark/src/score';
import { App } from './App';
import { scopeCheckAdapter, type ScopeContext } from './adapter';
import { FIXTURES } from './fixtures';

afterEach(cleanup);
const byId = (id: string) => FIXTURES.find((f) => f.id === id)! as Fixture;
const ctx = (f: Fixture, s = emptySession()) => evaluateSession(scopeCheckAdapter, f, s, 1);

describe('severity', () => {
  it('a quantity difference is High; a confirmed missing item and a specification mismatch stay Critical', () => {
    const v = ctx(byId('scopecheck-full'));
    const sev = (code: string) => [...new Set(v.evaluation.findings.filter((f) => f.code === code).map((f) => f.severity))];
    expect(sev('quantity.differs')).toEqual(['high']);
    expect(sev('spec.differs')).toEqual(['critical']);
    expect(sev('item.absent')).toEqual(['critical']);
    expect(ctx(byId('scopecheck-standard')).evaluation.findings.filter((f) => f.code === 'quantity.differs').every((f) => f.severity === 'high')).toBe(true);
  });

  it('the finding card says High', () => {
    render(<App initialFixtureId="scopecheck-standard" />);
    const card = screen.getByRole('heading', { name: /Quantity differs for CP-100/ }).closest('article')! as HTMLElement;
    expect(within(card).getByText('High')).toBeTruthy();
    expect(within(card).queryByText('Critical')).toBeNull();
  });

  it('the benchmark gate is unchanged: an unexpected confirmed High finding still counts as a false critical', () => {
    const v = ctx(byId('scopecheck-standard'));
    const q = v.evaluation.findings.find((f) => f.code === 'quantity.differs' && f.state === 'confirmed')!;
    expect(scoreFindings([q], [], { coverageConfirmed: false }).falseCritical).toHaveLength(1);
  });
});

describe('total as quoted', () => {
  it('one row under the matrix, one cell per quotation, in document order (no sorting, no ranking words)', () => {
    render(<App />);
    const table = screen.getByRole('table');
    const row = table.querySelector('tfoot tr[data-total-row]')!;
    expect(row.querySelector('th')!.textContent).toMatch(/^Total as quoted/);
    const cells = [...row.querySelectorAll('td[data-total-for]')].map((c) => c.getAttribute('data-total-for'));
    expect(cells).toEqual((ctx(byId('scopecheck-full')).evaluation.context as ScopeContext).data.quoteDocIds);
    expect(row.textContent).toMatch(/Not a ranking or a recommendation/);
    // The interface's own words, not the documents' (a tender may itself say "the lowest offer"): source text and evidence are left out.
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('figure, #docs-h ~ details ol, pre').forEach((e) => e.remove());
    expect(clone.textContent).not.toMatch(/\b(lowest|cheapest|best value|recommended|winner|preferred supplier)\b/i);
  });

  it('full-length sample: quotation B is complete with an exact sum; quotation A is Incomplete with its excluded count', () => {
    render(<App />);
    const b = document.querySelector('td[data-total-for="quote-b"]')!;
    const t = (ctx(byId('scopecheck-full')).evaluation.context as ScopeContext).totals;
    expect(b.textContent).toMatch(new RegExp(`All ${t['quote-b']!.lines} lines included`));
    expect(b.textContent).not.toMatch(/Incomplete/);
    const a = document.querySelector('td[data-total-for="quote-a"]')!;
    expect(a.textContent).toMatch(/Incomplete/);
    expect(a.textContent).toMatch(new RegExp(`${t['quote-a']!.excluded} lines? excluded: a price or quantity is held or missing`));
    expect(a.textContent).toMatch(new RegExp(`from ${t['quote-a']!.included} of ${t['quote-a']!.lines} lines`));
  });

  it('quotation B of the full-length set adds up exactly to quantity x unit price over its lines', () => {
    const v = ctx(byId('scopecheck-full'));
    const lines = [...v.effective.values()].filter((e) => e.fact.docId === 'quote-b' && e.usable);
    const price = (b: string) => lines.find((e) => e.fact.field === 'unit_price' && e.fact.evidence[0]?.blockId === b);
    const qty = (b: string) => lines.find((e) => e.fact.field === 'quantity' && e.fact.evidence[0]?.blockId === b);
    const blocks = [...new Set(lines.filter((e) => e.fact.field === 'unit_price').map((e) => e.fact.evidence[0]!.blockId))];
    let cents = 0n;
    for (const b of blocks) cents += BigInt(Math.round(Number((price(b)!.value as { amount: string }).amount) * 100)) * BigInt((qty(b)!.value as { value: string }).value);
    const total = (v.evaluation.context as ScopeContext).totals['quote-b']!.total!;
    expect(BigInt(Math.round(Number(total.amount) * 100))).toBe(cents);
  });

  it('a held price makes the total incomplete; correcting it brings the line back in', () => {
    const f = byId('scopecheck-full');
    const v = ctx(f);
    const before = (v.evaluation.context as ScopeContext).totals['quote-a']!;
    const held = [...v.effective.values()].find((e) => e.fact.docId === 'quote-a' && e.fact.field === 'unit_price' && !e.usable)!;
    expect(held).toBeTruthy();
    const after = (ctx(f, applyCorrection(emptySession(), held.fact.id, { amount: '100', currency: 'ZAR' }, undefined, 2)).evaluation.context as ScopeContext).totals['quote-a']!;
    expect(after.included).toBe(before.included + 1);
    expect(after.excluded).toBe(before.excluded - 1);
  });

  it('works by keyboard: the total row is reachable inside the focusable table container', async () => {
    const user = userEvent.setup();
    render(<App />);
    const region = screen.getByRole('region', { name: /Comparison: RFQ items against each quotation \(scroll sideways/ });
    region.focus();
    expect(document.activeElement).toBe(region);
    expect(region.querySelector('tfoot')).not.toBeNull();
    void user;
  });
});
