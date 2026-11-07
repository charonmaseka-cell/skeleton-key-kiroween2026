// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emptySession, evaluateSession, type Fixture } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';
import { checkLinePrice, statedConversion, unitVerdict } from './adapter/arithmetic';
import { FIXTURES } from './fixtures';
import { priceArithmeticDidNotRun } from './ComparisonMatrix';

// 15 November milestone rules (foundation R2.9, R4, R6): unit ambiguity and price arithmetic. Unclear stays Needs review.

describe('unit ambiguity (pure)', () => {
  const rfq = { value: '10', unit: 'each' };
  it('the same unit (any case) is not a unit question', () => {
    expect(unitVerdict(rfq, { value: '8', unit: 'Each' }, []).kind).toBe('same');
  });
  it('a missing unit is unclear', () => {
    expect(unitVerdict(rfq, { value: '8', unit: null }, [])).toMatchObject({ kind: 'unclear', reason: 'unit_missing' });
    expect(unitVerdict({ value: '10', unit: null }, { value: '8', unit: 'each' }, [])).toMatchObject({ kind: 'unclear', reason: 'unit_missing' });
  });
  it.each([
    ['each', 'box of 100'],
    ['m', 'roll'],
  ])('%s vs %s without a stated conversion is unclear (nothing is guessed, "box of 100" is not a conversion)', (a, b) => {
    expect(unitVerdict({ value: '10', unit: a }, { value: '1', unit: b }, ['1 box of 100 each', 'supplied in rolls'])).toMatchObject({ kind: 'unclear', reason: 'unit_differs' });
  });
  it('a conversion the documents state is applied with decimal arithmetic, in either written form', () => {
    expect(unitVerdict({ value: '200', unit: 'each' }, { value: '2', unit: 'box' }, ['1 box = 100 each'])).toMatchObject({ kind: 'converted', quantity: { value: '200', unit: 'each' } });
    expect(unitVerdict({ value: '30', unit: 'm' }, { value: '0.6', unit: 'roll' }, ['50 m per roll'])).toMatchObject({ kind: 'converted', quantity: { value: '30', unit: 'm' } }); // 0.6 x 50, exact in decimal
  });
  it('two different statements of the conversion are not a clear basis', () => {
    expect(statedConversion('box', 'each', ['1 box = 100 each', '1 box = 50 each'])).toBeNull();
  });
});

describe('price arithmetic (pure, decimal.js)', () => {
  const base = { quantity: { value: '8', unit: 'each' }, unitPrice: { amount: '12500', currency: 'ZAR' }, lineTotal: { amount: '100000', currency: 'ZAR' }, discountPercent: null, taxStated: false };
  it('agrees when the total is quantity x unit price', () => expect(checkLinePrice(base)).toMatchObject({ result: 'ok', expected: '100000.00' }));
  it('reports a mismatch with the expected and the stated amounts', () => expect(checkLinePrice({ ...base, lineTotal: { amount: '99000', currency: 'ZAR' } })).toMatchObject({ result: 'mismatch', expected: '100000.00', stated: '99000.00' }));
  it('uses decimal arithmetic: 0.1 x 3 x 0.2 does not drift, and one cent of rounding is not an error', () => {
    expect(checkLinePrice({ ...base, quantity: { value: '3', unit: 'each' }, unitPrice: { amount: '0.1', currency: 'ZAR' }, lineTotal: { amount: '0.30', currency: 'ZAR' } }).result).toBe('ok');
    expect(checkLinePrice({ ...base, quantity: { value: '3', unit: 'each' }, unitPrice: { amount: '3.335', currency: 'ZAR' }, lineTotal: { amount: '10.01', currency: 'ZAR' } }).result).toBe('ok'); // 10.005 -> 10.01 half up
    expect(checkLinePrice({ ...base, lineTotal: { amount: '100000.02', currency: 'ZAR' } }).result).toBe('mismatch');
  });
  it('applies a stated percentage discount', () => {
    expect(checkLinePrice({ ...base, discountPercent: '10', lineTotal: { amount: '90000', currency: 'ZAR' } }).result).toBe('ok');
    expect(checkLinePrice({ ...base, discountPercent: '10' }).result).toBe('mismatch');
  });
  it.each([
    ['currency unknown', { unitPrice: { amount: '12500', currency: null } }, 'currency_unknown'],
    ['currencies differ (no conversion)', { lineTotal: { amount: '100000', currency: 'USD' } }, 'currency_differs'],
    ['unit unknown', { quantity: { value: '8', unit: null } }, 'unit_unknown'],
    ['tax stated', { taxStated: true }, 'tax_basis_unclear'],
    ['discount over 100 %', { discountPercent: '120' }, 'discount_basis_unclear'],
  ])('%s: unclear, never a mismatch', (_n, patch, reason) => {
    expect(checkLinePrice({ ...base, lineTotal: { amount: '1', currency: 'ZAR' }, ...patch })).toEqual({ result: 'unclear', reason });
  });
});

type Claim = { field: string; kind: string; blockId: string; excerpt: string; value: unknown };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const standard = FIXTURES.find((f) => f.id === 'scopecheck-standard')!;
const run = (f: Fixture) => evaluateSession(scopeCheckAdapter, f, emptySession(), 1);
const find = (f: Fixture, code: string) => run(f).items.filter((i) => i.finding.code === code).map((i) => `${i.finding.subjectId}|${i.finding.responseDocId}|${i.finding.state}`);
/** quote-a line p1-l2 (CP-100, 8 units at R 12 500): add text and claims. */
function editQuoteA(f: Fixture, edit: (block: { text: string }, claims: Claim[]) => void): Fixture {
  const out = clone(f);
  const qa = out.docs.find((d) => d.id === 'quote-a')!;
  edit(qa.blocks.find((b) => b.id === 'p1-l2') as { text: string }, qa.claims as Claim[]);
  return out;
}

describe('the unit finding is titled as unclear while it is Needs review', () => {
  it('"Unit unclear for <code>", not a statement about units differing', () => {
    const f = clone(FIXTURES.find((x) => x.id === 'scopecheck-fulllength')!);
    const item = run(f).items.find((i) => i.finding.code === 'unit.ambiguous')!;
    expect(item.finding.state).toBe('needs_review');
    expect(item.finding.message).toMatch(/^Unit unclear for SP-5302 in /);
    expect(item.finding.message).not.toMatch(/differs|missing|conversion/);
  });
});

describe('the rules on the recorded samples: what each finds', () => {
  it('unit ambiguity finds exactly one case, in the full-length sample (SP-5302, Hydro-Lab: the recorded extraction read "1 l" as the offered quantity); none in the other two', () => {
    const found = FIXTURES.map((f) => `${f.id}: ${find(f, 'unit.ambiguous').join(', ') || 'none'}`);
    expect(found).toEqual(['scopecheck-fulllength: SP-5302:quantity|quote-a|needs_review', 'scopecheck-standard: none', 'scopecheck-layout: none']);
  });
  it('price arithmetic finds exactly one case: the planted error in the standard sample (QA-17 PG-6, 20 x R 450 is R 9 000, stated R 9 500); quote-b and the v1 samples have none', () => {
    const found = FIXTURES.map((f) => `${f.id}: ${find(f, 'price.arithmetic').join(', ') || 'none'}`);
    expect(found).toEqual(['scopecheck-fulllength: none', 'scopecheck-standard: quote-a:p1-l4:price|quote-a|confirmed', 'scopecheck-layout: none']);
    for (const f of FIXTURES) expect(find(f, 'price.unclear'), f.id).toEqual([]);
  });
  it('line totals are only in the recording made for them: 5 in the standard sample (all read correctly), none in the v1 recordings; no discount or tax is invented', () => {
    const claims = (id: string) => FIXTURES.find((f) => f.id === id)!.docs.flatMap((d) => d.claims as Claim[]);
    expect(claims('scopecheck-standard').filter((c) => c.field === 'line_total').map((c) => `${c.blockId}:${(c.value as { amount: string }).amount}`).sort()).toEqual(['p1-l2:100000', 'p1-l2:119000', 'p1-l3:15500', 'p1-l3:16000', 'p1-l4:9500']);
    for (const id of ['scopecheck-fulllength', 'scopecheck-layout']) expect(claims(id).filter((c) => ['line_total', 'discount', 'tax'].includes(c.field)), id).toEqual([]);
    expect(claims('scopecheck-standard').filter((c) => ['discount', 'tax'].includes(c.field))).toEqual([]);
  });
});

describe('the rules in the page logic, on a changed copy of the standard sample', () => {
  const PLANTED = 'quote-a:p1-l4:price|quote-a|confirmed';
  it('as recorded: the three QA-17 totals are checked (two agree, the planted one is a confirmed finding with its evidence) and QB-04 has none', () => {
    const v = run(standard);
    expect(v.evaluation.comparisons.filter((c) => c.field === 'line_total').map((c) => `${c.id} ${c.status}`).sort()).toEqual([
      'line_total:quote-a:p1-l2 agree', 'line_total:quote-a:p1-l3 agree', 'line_total:quote-a:p1-l4 flagged', 'line_total:quote-b:p1-l2 agree', 'line_total:quote-b:p1-l3 agree',
    ]);
    const item = v.items.find((i) => i.finding.code === 'price.arithmetic')!;
    expect(item.finding.message).toContain('expected 9000.00 ZAR, stated 9500.00 ZAR');
    expect(item.finding.evidence.map((e) => e.evidence.text)).toEqual(expect.arrayContaining(['line total R 9 500', 'qty 20 units', 'R 450 each']));
  });
  it('changing a correct total to a wrong one in the source and its claim adds a second confirmed finding; the other lines are unaffected', () => {
    const f = editQuoteA(standard, (b, c) => {
      b.text = b.text.replace('line total R 100 000', 'line total R 99 000');
      const t = c.find((x) => x.field === 'line_total' && x.blockId === 'p1-l2')!;
      t.excerpt = 'line total R 99 000';
      t.value = { amount: '99000', currency: 'ZAR' };
    });
    expect(find(f, 'price.arithmetic')).toEqual(['quote-a:p1-l2:price|quote-a|confirmed', PLANTED]);
  });
  it('a stated tax figure on the line makes the check unclear: Needs review, and the check is Not evaluated, never a mismatch', () => {
    const f = editQuoteA(standard, (b, c) => { b.text += ' | VAT 15 %'; c.push({ field: 'tax', kind: 'text', blockId: 'p1-l2', excerpt: 'VAT 15 %', value: 'VAT 15 %' }); });
    expect(find(f, 'price.arithmetic')).toEqual([PLANTED]);
    expect(find(f, 'price.unclear')).toEqual(['quote-a:p1-l2:price|quote-a|needs_review']);
    expect(run(f).evaluation.comparisons.find((c) => c.id === 'line_total:quote-a:p1-l2')).toMatchObject({ status: 'not_evaluated', blocked: { reason: 'tax_basis_unclear' } });
  });
  it('a stated discount cannot yet be validated (the engine has no percentage value kind): it is held, so the check is unclear, not a mismatch', () => {
    const f = editQuoteA(standard, (b, c) => { b.text += ' | discount 10 %'; c.push({ field: 'discount', kind: 'quantity', blockId: 'p1-l2', excerpt: 'discount 10 %', value: { value: '10', unit: '%' } }); });
    expect(find(f, 'price.arithmetic')).toEqual([PLANTED]);
    expect(find(f, 'price.unclear')).toEqual(['quote-a:p1-l2:price|quote-a|needs_review']);
  });
  it('a missing unit on the offer is a unit.ambiguous finding in Needs review, and the quantity comparison is not called a difference', () => {
    const f = editQuoteA(standard, (b, c) => {
      b.text = b.text.replace('qty 8 units', 'qty 8');
      const q = c.find((x) => x.field === 'quantity' && x.blockId === 'p1-l2')!;
      q.excerpt = 'qty 8';
      q.value = { value: '8', unit: null };
    });
    expect(find(f, 'unit.ambiguous')).toEqual(['CP-100:quantity|quote-a|needs_review']);
    expect(find(f, 'quantity.differs').filter((x) => x.includes('CP-100'))).toEqual([]);
  });
  it('a different unit with a conversion the offer states is converted: equal quantities agree, unequal ones are a confirmed difference', () => {
    const convert = (qty: string) =>
      editQuoteA(standard, (b, c) => {
        b.text = b.text.replace('qty 8 units', `qty ${qty} box`).replace('316 stainless steel casing', '316 stainless steel casing, 1 box = 5 units');
        const q = c.find((x) => x.field === 'quantity' && x.blockId === 'p1-l2')!;
        q.excerpt = `qty ${qty} box`;
        q.value = { value: qty, unit: 'box' };
        const s = c.find((x) => x.field === 'specification' && x.blockId === 'p1-l2')!;
        s.excerpt = '316 stainless steel casing, 1 box = 5 units';
        s.value = '316 stainless steel casing, 1 box = 5 units';
      });
    const agree = convert('2'); // 2 boxes = 10 units = the RFQ's 10 units
    expect(find(agree, 'unit.ambiguous')).toEqual([]);
    expect(find(agree, 'quantity.differs').filter((x) => x.includes('CP-100'))).toEqual([]);
    expect(run(agree).evaluation.comparisons.find((c) => c.id === 'quantity:CP-100~quote-a')).toMatchObject({ status: 'agree' });
    const differ = convert('1'); // 1 box = 5 units, the RFQ asks 10
    expect(find(differ, 'quantity.differs').filter((x) => x.includes('CP-100'))).toEqual(['CP-100:quantity|quote-a|confirmed']);
  });
});

describe('the plain line where price arithmetic would appear', () => {
  const LINE = "Price arithmetic didn't run on this sample: it was recorded before line totals were extracted.";
  it('is shown for samples recorded under the first quotation profile (v1) and not for the v2 recording; no price row is added and no recording is relabelled', () => {
    for (const f of FIXTURES) {
      const v1 = f.docs.filter((d) => d.role === 'quote').some((d) => d.profile === 'scopecheck.quote.v1');
      expect(priceArithmeticDidNotRun(run(f)), f.id).toBe(v1);
      if (v1) expect(run(f).evaluation.comparisons.filter((c) => c.field === 'line_total'), f.id).toEqual([]);
    }
    expect(FIXTURES.filter((f) => priceArithmeticDidNotRun(run(f))).map((f) => f.id)).toEqual(['scopecheck-fulllength', 'scopecheck-layout']);
    expect(priceArithmeticDidNotRun(run(FIXTURES.find((f) => f.id === 'scopecheck-standard')!))).toBe(false);
  });
  it('appears in the page for the default (v1) sample and disappears when the v2 sample is chosen', async () => {
    const { render, screen, cleanup } = await import('@testing-library/react');
    const { default: userEvent } = await import('@testing-library/user-event');
    const { createElement } = await import('react');
    const { App } = await import('./App');
    render(createElement(App));
    expect(document.querySelector('[data-price-note]')?.textContent).toBe(LINE);
    await userEvent.setup().selectOptions(screen.getByLabelText('Choose a sample set'), 'scopecheck-standard');
    expect(document.querySelector('[data-price-note]')).toBeNull();
    cleanup();
  });
});
