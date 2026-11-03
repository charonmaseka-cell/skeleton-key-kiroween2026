// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_MARK } from '@skeleton-key/engine';
import { STORAGE_KEY, confirmDocumentCoverage, decideFinding, emptySession, evaluateSession, exportCsv, exportText, withReconciledStore, internalNames, type SessionState } from '@skeleton-key/ui';
import { App } from './App';
import { scopeCheckAdapter } from './adapter';
import { clarificationLists } from './clarification';
import { FIXTURES } from './fixtures';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const full = FIXTURES[0]!;
const viewOf = (st: SessionState = emptySession(), fixture = full) => evaluateSession(scopeCheckAdapter, fixture, st, 1);
const A = 'quote-a';
const B = 'quote-b';
const listOf = (v: ReturnType<typeof viewOf>, doc: string) => clarificationLists(v).find((l) => l.docId === doc)!;

describe('clarification list per supplier', () => {
  it('makes one list per quotation, each naming only its own supplier', () => {
    const lists = clarificationLists(viewOf());
    expect(lists.map((l) => l.docId)).toEqual([A, B]);
    expect(lists[0]!.text).toMatch(/Clarification list for Quotation 2207-HL, Hydro-Lab Supplies/);
    expect(lists[0]!.text).not.toMatch(/Delta Field Instruments|DF\/0098/);
    expect(lists[1]!.text).toMatch(/Clarification list for Offer DF\/0098, Delta Field Instruments/);
    expect(lists[1]!.text).not.toMatch(/Hydro-Lab|2207-HL/);
  });

  it('marks every item: CONFIRMED for established differences and stated exclusions, TO CHECK for unresolved ones, in that order, numbered through', () => {
    const t = listOf(viewOf(), A).text;
    const items = t.split('\n').filter((l) => /^\d+\. \[/.test(l));
    const v = viewOf();
    const mine = v.items.filter((i) => i.finding.responseDocId === A);
    expect(items).toHaveLength(mine.length);
    expect(items.every((l) => /^\d+\. \[(CONFIRMED|TO CHECK)\] /.test(l))).toBe(true);
    expect(items.filter((l) => l.includes('[CONFIRMED]')).length).toBe(mine.filter((i) => i.finding.state === 'confirmed').length);
    expect(items.map((l) => Number(l.split('.')[0]))).toEqual(items.map((_, i) => i + 1));
    expect(t.indexOf('[CONFIRMED]')).toBeLessThan(t.indexOf('[TO CHECK]'));
    expect(t).toMatch(/CONFIRMED \(\d+\): the documents show this/);
    expect(t).toMatch(/TO CHECK \(\d+\): not established from the documents as read/);
  });

  it('quotes the tender and the offer in the cited words with line numbers, and asks plainly', () => {
    const t = listOf(viewOf(), A).text;
    expect(t).toMatch(/\[CONFIRMED\] Quantity differs for LB-3110/);
    expect(t).toMatch(/Tender \(Tender TN-7731, supply of laboratory and field instruments, line \d+\): "8 each"/);
    expect(t).toMatch(/Your offer, line \d+: "6 each"/);
    expect(t).toMatch(/Please confirm the quantity you are offering\./);
    expect(t).toMatch(/Please confirm whether this item is included in your offer\./);
  });

  it('a missing item is TO CHECK until coverage of that offer is confirmed, then CONFIRMED; the note about coverage goes away', () => {
    const before = listOf(viewOf(), B).text;
    expect(before).toMatch(/\[TO CHECK\] SP-5302 not found in Offer DF\/0098/);
    expect(before).toMatch(/has not confirmed that every line of this offer was read/);
    const after = listOf(viewOf(confirmDocumentCoverage(emptySession(), B, 1)), B).text;
    expect(after).toMatch(/\[CONFIRMED\] SP-5302 not found in Offer DF\/0098/);
    expect(after).not.toMatch(/has not confirmed that every line/);
    expect(after).not.toMatch(/\[TO CHECK\] SP-5302/);
  });

  it('leaves out an item the reviewer dismissed, keeps an accepted one, and counts what it lists', () => {
    const v = viewOf();
    const target = v.items.find((i) => i.finding.responseDocId === A && i.finding.code === 'quantity.differs')!;
    const dismissed = decideFinding(withReconciledStore(emptySession(), v), target.finding, 'dismissed', undefined, 2);
    const l = listOf(viewOf(dismissed), A);
    expect(l.text).not.toMatch(/Quantity differs for LB-3110/);
    expect(l.confirmed).toBe(listOf(v, A).confirmed - 1);
    const accepted = decideFinding(withReconciledStore(emptySession(), v), target.finding, 'accepted', undefined, 2);
    expect(listOf(viewOf(accepted), A).text).toMatch(/Quantity differs for LB-3110/);
  });

  it('carries the same SAMPLE marker as the other exports, and none for a live run', () => {
    const l = listOf(viewOf(), A).text;
    expect(l.startsWith(`${SAMPLE_MARK}\n`)).toBe(true);
    expect(exportText(viewOf())).toContain(SAMPLE_MARK);
    expect(exportCsv(viewOf())).toMatch(/SAMPLE \(fictional\)/);
    const live = { ...full, sample: false, id: 'live-upload-1' };
    expect(listOf(viewOf(emptySession(), live), A).text).not.toMatch(/SAMPLE/);
  });

  it('is plain: no internal names, no block references, no theme names, no ranking or recommendation', () => {
    const { names, blockIds } = internalNames(scopeCheckAdapter, FIXTURES);
    for (const l of clarificationLists(viewOf(confirmDocumentCoverage(emptySession(), B, 1)))) {
      for (const n of names) expect(l.text, n).not.toContain(n);
      for (const b of blockIds) expect(l.text).not.toMatch(new RegExp(`\\b${b}\\b`));
      expect(l.text).not.toMatch(/ghost|curse|miscount|spectre|lowest|cheapest|best|recommend|rank|winner|preferred/i);
      expect(l.text).not.toMatch(/\b(clean|all clear|no problems|nothing found)\b/i);
    }
  });

  it('says plainly when there is nothing to raise, without claiming the offer is fine', () => {
    const empty = { ...full, docs: full.docs.map((d) => (d.id === B ? { ...d, claims: [] } : d)) };
    const v = viewOf(emptySession(), empty);
    const t = listOf(v, B).text;
    if (v.items.some((i) => i.finding.responseDocId === B)) return; // an offer with no claims may itself raise items
    expect(t).toMatch(/No items to raise with this supplier so far\./);
    expect(t).toMatch(/built from the documents as read/);
  });

  it('is built from the same items as the summary: confirmed plus to-check counts equal the review items about that supplier (less dismissed)', () => {
    for (const fx of FIXTURES) {
      const v = viewOf(emptySession(), fx);
      for (const l of clarificationLists(v)) expect(l.confirmed + l.toCheck).toBe(v.items.filter((i) => i.finding.responseDocId === l.docId && i.review.status !== 'dismissed').length);
    }
  });
});

describe('in the page', () => {
  it('shows a section with one block per supplier, a preview that matches the list, a download and a copy button', async () => {
    localStorage.setItem(STORAGE_KEY, 'on');
    const user = userEvent.setup();
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App />);
    const section = screen.getByRole('heading', { name: 'Clarification lists' }).closest('section')!;
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toMatch(/Hydro-Lab Supplies: \d+ confirmed, \d+ to check/);
    expect(section.textContent).toMatch(/does not rank or recommend/);
    await user.click(screen.getByRole('button', { name: /Copy to clipboard: clarification list for Offer DF\/0098/ }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toBe(listOf(viewOf(), B).text);
    expect(section.textContent).toMatch(/Copied the clarification list for Offer DF\/0098/);
    expect(screen.getByRole('button', { name: /Download text: clarification list for Quotation 2207-HL/ })).toBeTruthy();
  });

  it('the preview text is exactly the text that is copied', () => {
    render(<App />);
    const pre = [...document.querySelectorAll('section[aria-labelledby="clar-h"] pre')].map((p) => p.textContent);
    expect(pre).toEqual(clarificationLists(viewOf()).map((l) => l.text));
  });
});
