import { describe, expect, it } from 'vitest';
import { emptySession, evaluateSession, type Fixture } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';
import { checkLinePrice, statedConversion, unitVerdict } from './adapter/arithmetic';
import { FIXTURES } from './fixtures';

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
const total = (text: string, amount: string): Claim => ({ field: 'line_total', kind: 'money', blockId: 'p1-l2', excerpt: text, value: { amount, currency: 'ZAR' } });

describe('the rules on the recorded samples: what each finds', () => {
  it('unit ambiguity finds exactly one case, in the full-length sample (SP-5302, Hydro-Lab: the recorded extraction read "1 l" as the offered quantity); none in the other two', () => {
    const found = FIXTURES.map((f) => `${f.id}: ${find(f, 'unit.ambiguous').join(', ') || 'none'}`);
    expect(found).toEqual(['scopecheck-fulllength: SP-5302:quantity|quote-a|needs_review', 'scopecheck-standard: none', 'scopecheck-layout: none']);
  });
  it('price arithmetic finds nothing on any sample: no recorded claim states a line total, discount or tax (and none is invented)', () => {
    for (const f of FIXTURES) {
      expect(find(f, 'price.arithmetic'), f.id).toEqual([]);
      expect(find(f, 'price.unclear'), f.id).toEqual([]);
      expect(f.docs.flatMap((d) => d.claims as Claim[]).filter((c) => ['line_total', 'discount', 'tax'].includes(c.field)), f.id).toEqual([]);
    }
  });
});

describe('the rules in the page logic, on a changed copy of the standard sample', () => {
  it('a line total that equals quantity x unit price agrees; one that does not is a confirmed price.arithmetic finding with its evidence', () => {
    const ok = editQuoteA(standard, (b, c) => { b.text += ' | line total R 100 000'; c.push(total('line total R 100 000', '100000')); });
    expect(find(ok, 'price.arithmetic')).toEqual([]);
    expect(run(ok).evaluation.comparisons.find((c) => c.id === 'line_total:quote-a:p1-l2')).toMatchObject({ status: 'agree' });
    const bad = editQuoteA(standard, (b, c) => { b.text += ' | line total R 99 000'; c.push(total('line total R 99 000', '99000')); });
    expect(find(bad, 'price.arithmetic')).toEqual(['quote-a:p1-l2:price|quote-a|confirmed']);
    const item = run(bad).items.find((i) => i.finding.code === 'price.arithmetic')!;
    expect(item.finding.message).toContain('expected 100000.00 ZAR, stated 99000.00 ZAR');
    expect(item.finding.evidence.map((e) => e.evidence.text)).toEqual(expect.arrayContaining(['line total R 99 000', 'qty 8 units', 'R 12 500 each']));
  });
  it('a stated tax figure on the line makes the check unclear: Needs review, and the check is Not evaluated, never a mismatch', () => {
    const f = editQuoteA(standard, (b, c) => { b.text += ' | line total R 99 000 | VAT 15 %'; c.push(total('line total R 99 000', '99000'), { field: 'tax', kind: 'text', blockId: 'p1-l2', excerpt: 'VAT 15 %', value: 'VAT 15 %' }); });
    expect(find(f, 'price.arithmetic')).toEqual([]);
    expect(find(f, 'price.unclear')).toEqual(['quote-a:p1-l2:price|quote-a|needs_review']);
    expect(run(f).evaluation.comparisons.find((c) => c.id === 'line_total:quote-a:p1-l2')).toMatchObject({ status: 'not_evaluated', blocked: { reason: 'tax_basis_unclear' } });
  });
  it('a stated discount cannot yet be validated (the engine has no percentage value kind): it is held, so the check is unclear, not a mismatch', () => {
    const f = editQuoteA(standard, (b, c) => { b.text += ' | line total R 90 000 | discount 10 %'; c.push(total('line total R 90 000', '90000'), { field: 'discount', kind: 'quantity', blockId: 'p1-l2', excerpt: 'discount 10 %', value: { value: '10', unit: '%' } }); });
    expect(find(f, 'price.arithmetic')).toEqual([]);
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
