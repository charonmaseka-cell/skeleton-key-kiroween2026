import { describe, expect, it } from 'vitest';
import { sameSpec, stripLeadingConnectors } from './rules';

// Leading procurement connectors ("with", "c/w", "complete with", "incl.") introduce a specification; they are not part of it.
// Only a prefix is removed. Everything that can make two specifications genuinely differ must survive.

describe('stripLeadingConnectors removes a prefix only', () => {
  it.each([
    ['with DOL, IP55 enclosure', 'DOL, IP55 enclosure', ['with']],
    ['With ultrasonic, IP67', 'ultrasonic, IP67', ['with']],
    ['c/w spare gasket', 'spare gasket', ['c/w']],
    ['C/W 2 spare seals', '2 spare seals', ['c/w']],
    ['complete with 2 spare seals', '2 spare seals', ['complete with']],
    ['incl. mounting bracket', 'mounting bracket', ['incl.']],
    ['incl mounting bracket', 'mounting bracket', ['incl']],
    ['  with   0-16 bar, 4-20 mA ', '0-16 bar, 4-20 mA', ['with']],
  ])('%s', (input, rest, removed) => {
    expect(stripLeadingConnectors(input)).toEqual({ text: rest, removed });
  });

  it.each([
    'without seal', // a different word
    'withstands 16 bar',
    'including flange', // not one of the four
    'includes flange',
    'HDPE, with bund', // not a prefix
    'IP55 with DOL',
    'complete with', // nothing follows: left alone
    'with',
    'c/wire 2.5 mm2',
    'incl.5 mm', // not a whole word
  ])('leaves %j unchanged', (input) => {
    expect(stripLeadingConnectors(input).text).toBe(input.trim());
    expect(stripLeadingConnectors(input).removed).toEqual([]);
  });

  it('keeps negation after the connector', () => {
    expect(stripLeadingConnectors('with no bund').text).toBe('no bund');
    expect(stripLeadingConnectors('with out seal').text).toBe('out seal');
  });
});

describe('the four reproduced false criticals are no longer differences', () => {
  // The saved quotation B values that were reported as confirmed critical differences on 2026-11-01.
  it.each([
    ['DOL, IP55 enclosure', 'with DOL, IP55 enclosure'], // MT-310
    ['ultrasonic, IP67', 'with ultrasonic, IP67'], // SN-401
    ['0-16 bar, 4-20 mA', 'with 0-16 bar, 4-20 mA'], // SN-402
  ])('%s equals %s', (rfq, quote) => {
    expect(sameSpec(rfq, quote).same).toBe(true);
    expect(sameSpec(rfq, quote).removed).toEqual(['with']);
  });

  it('the fourth (SN-403) is NOT a connector case: the model put the item name into the specification, and it stays a difference', () => {
    expect(sameSpec('electromagnetic, IP68', 'DN50 SN-403 with electromagnetic, IP68').same).toBe(false);
  });
});

describe('genuine specification differences are still detected', () => {
  it.each([
    ['IE3, 4 pole, IP55', 'with IE2, 4 pole, IP55'], // MT-301 grade
    ['ultrasonic, IP67', 'with ultrasonic, IP65'], // protection rating
    ['PVC head, 0-20 l/h', 'with PVC head, 0-30 l/h'], // range
    ['2.5 mm2, armoured', 'with 2.5 mm2, unarmoured'], // CB-501
    ['316 stainless steel casing', 'with 304 stainless steel casing'], // grade
    ['HDPE, with bund', 'with HDPE, bund'], // a moved qualifier
    ['carbon steel, PN16', 'with carbon steel, PN10'], // pressure class
    ['seal', 'with no seal'], // negation
    ['2 spare seals', 'complete with 4 spare seals'], // number
    ['SANS 1200', 'c/w SANS 1201'], // standard
    ['0-16 bar', 'incl. 0-16 mbar'], // unit
    ['flanged PN16', 'with flanged'], // dropped qualifier
  ])('%s vs %s', (a, b) => {
    expect(sameSpec(a, b).same).toBe(false);
  });

  it('a connector on both sides, or on the requirement side, is also ignored', () => {
    expect(sameSpec('with DOL, IP55', 'c/w DOL, IP55').same).toBe(true);
    expect(sameSpec('complete with DOL', 'DOL').same).toBe(true);
  });
});
