import { describe, expect, it } from 'vitest';
import { checkSupport, compareNames, validateClaim } from '../src';
import { block } from './helpers';

const money = (excerpt: string, amount: string, currency: string | null, hints?: string[]) =>
  checkSupport({ kind: 'money', claimed: { amount, currency }, excerpt, hints });

describe('value support: amounts', () => {
  it('parses "R1.6 million" by code', () => {
    const r = money('Funding requested: R1.6 million', '1600000', 'ZAR');
    expect(r).toMatchObject({ status: 'supported', resolved: { amount: '1600000', currency: 'ZAR' } });
  });

  it('rejects a claimed value that is not in the excerpt', () => {
    expect(money('Funding requested: R1.6 million', '2000000', 'ZAR')).toMatchObject({ status: 'unsupported' });
    expect(money('ZAR 500', '500', 'USD')).toMatchObject({ status: 'unsupported', reason: 'currency_mismatch' });
  });

  it('several amounts without context stays Needs review', () => {
    const text = 'Funding requested: R1.6 million. Total budget: R2 million.';
    expect(money(text, '1600000', 'ZAR')).toMatchObject({ status: 'needs_review', reason: 'multiple_candidates_no_context' });
  });

  it('a preceding field label identifies the intended amount', () => {
    const text = 'Funding requested: R1.6 million. Total budget: R2 million.';
    expect(money(text, '1600000', 'ZAR', ['funding requested'])).toMatchObject({ status: 'supported' });
    expect(money(text, '2000000', 'ZAR', ['total budget'])).toMatchObject({ status: 'supported' });
    // wrong claim for the labelled field is unsupported, not silently accepted
    expect(money(text, '2000000', 'ZAR', ['funding requested'])).toMatchObject({ status: 'unsupported' });
    // a label that does not match exactly one candidate is not enough context
    expect(money(text, '1600000', 'ZAR', ['amount'])).toMatchObject({ status: 'needs_review', reason: 'ambiguous_candidates' });
  });

  it('a bare "$" or decimal comma is not guessed', () => {
    expect(money('Total $500', '500', 'USD')).toMatchObject({ status: 'needs_review', reason: 'currency_ambiguous' });
    expect(money('R1,6 million', '1600000', 'ZAR')).toMatchObject({ status: 'needs_review', reason: 'number_format_ambiguous' });
  });
});

describe('value support: dates and quantities', () => {
  const date = (excerpt: string, claimed: string, hints?: string[]) => checkSupport({ kind: 'date', claimed, excerpt, hints });
  it('supports unambiguous dates and flags ambiguous numeric ones', () => {
    expect(date('Starts 1 March 2026', '2026-03-01')).toMatchObject({ status: 'supported' });
    expect(date('Starts 13/02/2026', '2026-02-13')).toMatchObject({ status: 'supported' });
    expect(date('Starts 01/02/2026', '2026-02-01')).toMatchObject({ status: 'needs_review', reason: 'date_format_ambiguous' });
  });
  it('requires context when several dates appear', () => {
    const t = 'Start: 1 March 2026, end: 28 February 2027';
    expect(date(t, '2026-03-01')).toMatchObject({ status: 'needs_review' });
    expect(date(t, '2027-02-28', ['end'])).toMatchObject({ status: 'supported' });
  });

  const qty = (excerpt: string, value: string, unit: string | null, hints?: string[]) =>
    checkSupport({ kind: 'quantity', claimed: { value, unit }, excerpt, hints });
  it('does not mistake a price for a quantity and keeps unknown units unknown', () => {
    expect(qty('10 pumps at R500 each', '10', null)).toMatchObject({ status: 'supported', resolved: { value: '10', unit: null } });
    expect(qty('10 pumps at R500 each', '10', 'pumps')).toMatchObject({ status: 'supported', resolved: { unit: 'pumps' } });
    expect(qty('10 pumps', '10', 'kg')).toMatchObject({ status: 'needs_review', reason: 'unit_not_in_excerpt', resolved: { unit: null } });
  });
  it('several plain numbers need a label', () => {
    expect(qty('Qty 10 of 20 listed', '10', null)).toMatchObject({ status: 'needs_review' });
    expect(qty('Qty 10 of 20 listed', '10', null, ['qty'])).toMatchObject({ status: 'supported' }); // label precedes exactly one number
    expect(qty('Qty 10 of 20 listed', '20', null, ['qty'])).toMatchObject({ status: 'unsupported' }); // labelled value is 10, not 20
  });
});

describe('organisation names keep meaningful differences', () => {
  it('ignores only case, punctuation and spacing', () => {
    expect(compareNames('Acme (Pty) Ltd', 'ACME Pty. Ltd.')).toBe('same');
    expect(compareNames('Smith & Sons', 'Smith and Sons')).toBe('same');
  });
  it('reports legal-form differences separately and never treats other differences as equal', () => {
    expect(compareNames('Acme Trading', 'Acme Trading (Pty) Ltd')).toBe('legal_form_differs');
    expect(compareNames('Green Valley Trust', 'Green Valley Foundation')).toBe('different');
    expect(compareNames('Acme Holdings', 'Acme Holding')).toBe('different');
    expect(compareNames('The Green Trust', 'Green Trust')).toBe('different');
  });
});

describe('pipeline: ambiguity and unsupported values stay Needs review', () => {
  const b = block('d1', 'b1', 'Funding requested: R1.6 million. Total budget: R2 million.');
  const claim = (value: object) => ({ field: 'funding', kind: 'money', blockId: 'b1', excerpt: b.text, value });
  it('ambiguous excerpt without hints is not validated', () => {
    const f = validateClaim(claim({ amount: '1600000', currency: 'ZAR' }), { docId: 'd1', blocks: [b] });
    expect(f.status).toBe('needs_review');
    expect(f.reason).toBe('multiple_candidates_no_context');
  });
  it('adapter hints make it validated', () => {
    const f = validateClaim(claim({ amount: '1600000', currency: 'ZAR' }), { docId: 'd1', blocks: [b], hintsByField: { funding: ['funding requested'] } });
    expect(f.status).toBe('validated');
    expect(f.value).toEqual({ amount: '1600000', currency: 'ZAR' });
  });
  it('quote exists but value is unsupported -> Needs review with null value', () => {
    const f = validateClaim(claim({ amount: '9999', currency: 'ZAR' }), { docId: 'd1', blocks: [b], hintsByField: { funding: ['funding requested'] } });
    expect(f).toMatchObject({ status: 'needs_review', reason: 'value_not_in_excerpt', value: null });
  });
  it('missing block, absent excerpt and malformed claims never validate', () => {
    expect(validateClaim({ ...claim({}), blockId: 'nope' }, { docId: 'd1', blocks: [b] }).reason).toBe('block_missing');
    expect(validateClaim({ ...claim({}), excerpt: 'not in block' }, { docId: 'd1', blocks: [b] }).reason).toBe('excerpt_not_found');
    expect(validateClaim({ field: 'x' }, { docId: 'd1', blocks: [b] }).reason).toBe('claim_schema_invalid');
  });
});
