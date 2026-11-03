import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EffectiveFact } from '@skeleton-key/engine';
import { applyCorrection, emptySession, evaluateSession, withReconciledStore } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';
import { formatAmount, totalFor, totalsFor } from './totals';

// "Total as quoted": computed with decimal.js from validated unit prices and quantities; held or missing prices make it incomplete.

let n = 0;
const fact = (block: string, field: string, value: unknown, over: Partial<EffectiveFact> = {}): EffectiveFact => ({
  fact: { id: `f${++n}`, docId: 'q', field, kind: field === 'unit_price' ? 'money' : field === 'quantity' ? 'quantity' : 'text', value, evidence: [{ docId: 'q', blockId: block, start: 0, end: 1, text: 'x' }], status: 'validated' } as never,
  value,
  provenance: 'document',
  status: 'validated',
  usable: true,
  ...over,
});
const held = (block: string, field: string, value: unknown) => fact(block, field, value, { usable: false, status: 'needs_review' });
const mk = (...fs: EffectiveFact[]) => new Map(fs.map((f) => [f.fact.id, f]));
const price = (b: string, amount: string, currency: string | null = 'ZAR') => fact(b, 'unit_price', { amount, currency });
const qty = (b: string, value: string) => fact(b, 'quantity', { value, unit: 'each' });
const item = (b: string, v = 'Thing') => fact(b, 'item', v);

describe('totalFor', () => {
  it('adds exactly, with decimal arithmetic (0.1 + 0.2 is 0.30, not 0.30000000000000004)', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the floating-point trap this avoids
    const t = totalFor(mk(item('b1'), price('b1', '0.1'), qty('b1', '1'), item('b2'), price('b2', '0.2'), qty('b2', '1')), 'q');
    expect(t).toMatchObject({ state: 'complete', sum: '0.30', currency: 'ZAR' });
    const big = totalFor(mk(price('b1', '19.99'), qty('b1', '3'), price('b2', '1234567.89'), qty('b2', '7')), 'q');
    expect(big.sum).toBe('8642035.20'); // 59.97 + 8641975.23
  });

  it('a held unit price excludes the line, counts it, and marks the total incomplete', () => {
    const t = totalFor(mk(price('b1', '100'), qty('b1', '2'), item('b1'), held('b2', 'unit_price', { amount: '18.20', currency: 'ZAR' }), qty('b2', '5'), item('b2')), 'q');
    expect(t.state).toBe('incomplete');
    expect(t.excluded).toEqual([{ blockId: 'b2', reasons: ['price_held'] }]);
    expect(t.counted).toHaveLength(1);
    expect(t.sum).toBe('200.00'); // the counted lines only; the interface labels it as not the quotation total
  });

  it('a missing unit price (item and quantity present) excludes the line; so does a missing or held quantity', () => {
    const t = totalFor(mk(item('b1'), qty('b1', '4'), item('b2'), price('b2', '9'), item('b3'), price('b3', '9'), held('b3', 'quantity', { value: '2', unit: 'each' }), price('b4', '5'), qty('b4', '2')), 'q');
    expect(Object.fromEntries(t.excluded.map((x) => [x.blockId, x.reasons]))).toEqual({ b1: ['price_missing'], b2: ['quantity_missing'], b3: ['quantity_held'] });
    expect(t).toMatchObject({ state: 'incomplete', sum: '10.00' });
  });

  it('more than one price, quantity or item on a line is ambiguous: excluded, never the first one', () => {
    const t = totalFor(mk(price('b1', '5'), price('b1', '6'), qty('b1', '2')), 'q');
    expect(t.excluded).toEqual([{ blockId: 'b1', reasons: ['ambiguous_values'] }]);
    expect(t.state).toBe('none');
    expect(t.sum).toBeNull();
  });

  it('lines with no counted line give no sum; exclusions and specification-only lines are not lines', () => {
    const t = totalFor(mk(fact('b9', 'exclusion', 'Installation not included'), fact('b8', 'specification', 'IP68'), item('b1'), qty('b1', '2')), 'q');
    expect(t.excluded).toHaveLength(1);
    expect(t).toMatchObject({ state: 'none', sum: null });
  });

  it('different currencies are never added together', () => {
    const t = totalFor(mk(price('b1', '5', 'ZAR'), qty('b1', '1'), price('b2', '5', 'USD'), qty('b2', '1')), 'q');
    expect(t).toMatchObject({ state: 'mixed_currency', sum: null, currency: null });
  });

  it('a value the reviewer supplied counts, and is marked as supplied', () => {
    const p = fact('b1', 'unit_price', { amount: '7', currency: 'ZAR' }, { provenance: 'user_supplied', status: 'user_supplied' });
    const t = totalFor(mk(p, qty('b1', '3')), 'q');
    expect(t.counted[0]).toMatchObject({ lineTotal: '21', supplied: true });
  });

  it('formats amounts with a space for thousands and two decimals', () => {
    expect(formatAmount('375250.00')).toBe('375 250.00');
    expect(formatAmount('0.50')).toBe('0.50');
    expect(formatAmount('1234567.80')).toBe('1 234 567.80');
  });
});

describe('Total as quoted on the full-length recorded sample', () => {
  const fx = FIXTURES.find((f) => f.id === 'scopecheck-fulllength')!;
  const run = (s = emptySession(), at = 1) => evaluateSession(scopeCheckAdapter, fx, s, at);
  const totals = (v: ReturnType<typeof run>) => Object.fromEntries(totalsFor(v.effective, ['quote-a', 'quote-b']).map((t) => [t.quote, t]));

  it('quotation B: all 11 lines have a validated price and quantity, so the total is complete (checked independently with Python decimals: 375250.00)', () => {
    expect(totals(run())['quote-b']).toMatchObject({ state: 'complete', sum: '375250.00', currency: 'ZAR' });
    expect(totals(run())['quote-b']!.counted).toHaveLength(11);
  });

  it('quotation A: 2 prices are held for review and 3 were never extracted, so it is incomplete with 5 lines excluded (6 counted, 204000.00)', () => {
    const a = totals(run())['quote-a']!;
    expect(a).toMatchObject({ state: 'incomplete', sum: '204000.00' });
    expect(a.counted).toHaveLength(6);
    expect(a.excluded.map((x) => x.reasons.join())).toEqual(['price_held', 'price_held', 'price_missing', 'price_missing', 'price_missing']);
  });

  it('correcting a held price brings the line into the total, and the original value is kept', () => {
    const v0 = run();
    const held = [...v0.effective.values()].find((e) => e.fact.docId === 'quote-a' && e.fact.field === 'unit_price' && !e.usable && e.fact.evidence[0]?.blockId === 'p1-l11')!;
    const s = withReconciledStore(applyCorrection(emptySession(), held.fact.id, { amount: '18200', currency: 'ZAR' }, 'checked against the PDF', 2), run(emptySession(), 2));
    const a = totals(run(s, 2))['quote-a']!;
    expect(a.counted).toHaveLength(7);
    expect(a.excluded).toHaveLength(4);
    expect(a.sum).toBe('295000.00'); // 204000 + 5 x 18200
    expect(a.counted.some((c) => c.supplied)).toBe(true);
  });

  it('the total does not depend on the RFQ or on the matching, and no ranking is produced', () => {
    const t = Object.values(totals(run()));
    expect(t.every((x) => !('rank' in x) && !('best' in x))).toBe(true);
  });
});

describe('the full-length recorded sample file', () => {
  it('full-length sample: keeps the recorded claims unchanged and carries no saved findings', () => {
    const fx = JSON.parse(readFileSync(new URL('../../../samples/fixtures/scopecheck-fulllength.json', import.meta.url), 'utf8')) as { sample: boolean; label: string; docs: { claims: unknown[] }[] };
    expect(fx).toMatchObject({ sample: true, label: 'Sample (fictional)' });
    expect(fx.docs.reduce((n, d) => n + d.claims.length, 0)).toBe(123);
    expect(JSON.stringify(fx)).not.toMatch(/"findings"|"expectedFindings"|"comparisons"/);
  });

  it('full-length sample: the rules reproduce the documented result: every labelled finding, in its labelled state, plus the one documented unexpected finding', () => {
    const m = JSON.parse(readFileSync(new URL('../../../samples/scopecheck-fresh/sample.json', import.meta.url), 'utf8')) as { expectedFindings: { code: string; subject: string; response: string; state: string }[] };
    const v = evaluateSession(scopeCheckAdapter, FIXTURES[0]!, emptySession(), 1);
    const got = new Map(v.items.map((i) => [`${i.finding.code}|${i.finding.subjectId}|${i.finding.responseDocId}`, i.finding.state]));
    for (const e of m.expectedFindings) expect(got.get(`${e.code}|${e.subject}|${e.response}`), `${e.code} ${e.subject}`).toBe(e.state);
    expect(got.size - m.expectedFindings.length).toBe(1);
    expect(got.get('quantity.differs|SP-5302:quantity|quote-a')).toBe('needs_review');
  });
});
