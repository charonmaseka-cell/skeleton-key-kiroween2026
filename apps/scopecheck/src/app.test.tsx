// @vitest-environment jsdom
// These tests are about the small standard set (RFQ and two quotations); the full-length default has its own tests (full-sample.test.ts).
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('ScopeCheck interface', () => {
  it('shows sample mode, the comparison, the review queue, Not evaluated and export, all from the fixture', () => {
    render(<App initialFixtureId="scopecheck-standard" />);
    expect(screen.getByRole('region', { name: 'Sample mode' }).textContent).toMatch(/SAMPLE MODE: fictional documents/);
    expect(screen.getByRole('heading', { name: /Comparison: RFQ items against each quotation/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Confirmed findings \(3\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Needs review \(1\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Not evaluated \(2\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Export' })).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Requested item', 'Quotation QA-17, Alder Pump Supplies', 'Quotation QB-04, Birch Industrial Trading']);
    expect(within(table.querySelector('tbody')!).getAllByRole('rowheader')).toHaveLength(3); // the item rows; the total row is in tfoot
  });

  it('every status is text, not colour alone, and Not evaluated is never shown as agreement', () => {
    render(<App initialFixtureId="scopecheck-standard" />);
    const ne = screen.getByRole('heading', { name: /Not evaluated \(2\)/ }).closest('section')!;
    expect(ne.textContent).toMatch(/did NOT run/);
    expect(within(ne).getAllByText('Not evaluated').length).toBe(2);
    expect(ne.textContent).not.toMatch(/Agrees/);
  });

  it('works by keyboard: Tab reaches the first control after the skip link, Enter accepts a finding, the decision is announced', async () => {
    const user = userEvent.setup();
    render(<App initialFixtureId="scopecheck-standard" />);
    await user.tab();
    expect(document.activeElement?.textContent).toBe('Skip to main content');
    const card = document.querySelector('article')!;
    const accept = within(card as HTMLElement).getByRole('button', { name: /^Accept: / });
    accept.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status').textContent?.trim()).toBe('Decision saved: accepted.');
    expect(within(document.querySelector('article')! as HTMLElement).getAllByText('Accepted').length).toBeGreaterThan(0);
  });

  it('a correction can be made with the keyboard; the original is shown and the comparison updates', async () => {
    const user = userEvent.setup();
    render(<App initialFixtureId="scopecheck-standard" />);
    const before = screen.getByRole('heading', { name: /Confirmed findings \(3\)/ });
    expect(before).toBeTruthy();
    const card = screen.getByRole('heading', { name: /Quantity differs for CP-100 in Quotation QA-17, Alder Pump Supplies/ }).closest('article')! as HTMLElement;
    // buttons are named with the field and document, so the right value can be picked without a pointer
    const correct = within(card).getByRole('button', { name: /^Correct this value: Quantity \(8 units\) in Quotation QA-17/ });
    correct.focus();
    await user.keyboard('{Enter}');
    const form = within(card).getByRole('form', { name: /Correct Quantity/ });
    await user.type(within(form).getByLabelText('Quantity'), '10');
    await user.type(within(form).getByLabelText('Unit (optional)'), 'units');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status').textContent).toMatch(/Correction saved. The original value is kept/);
    expect(screen.getByRole('heading', { name: /Confirmed findings \(2\)/ })).toBeTruthy();
  });

  it('switching to the free-text sample shows the known miss as Not evaluated and the uncertain line in Needs review', async () => {
    const user = userEvent.setup();
    render(<App initialFixtureId="scopecheck-standard" />);
    await user.selectOptions(screen.getByLabelText('Choose a sample set'), 'scopecheck-layout');
    const ne = screen.getByRole('heading', { name: /Not evaluated \(3\)/ }).closest('section')!;
    expect(ne.textContent).toMatch(/No specification was extracted from Quotation QC-31/);
    expect(screen.getByRole('heading', { name: /Item identity is uncertain/ })).toBeTruthy();
  });

  it('the export preview keeps every state and the sample marker', () => {
    render(<App initialFixtureId="scopecheck-standard" />);
    const pre = document.querySelector('pre')!;
    expect(pre.textContent).toMatch(/^SAMPLE \(fictional\)/);
    expect(pre.textContent).toMatch(/NOT EVALUATED \(2\)/);
    expect(pre.textContent).toMatch(/NEEDS REVIEW, UNRESOLVED \(1\)/);
  });

  it('review #10: an open correction editor does not survive a switch of sample set', async () => {
    const user = userEvent.setup();
    render(<App initialFixtureId="scopecheck-standard" />);
    const docs = screen.getByRole('heading', { name: /Documents, extracted values and coverage/ }).closest('section')! as HTMLElement;
    (docs.querySelector('details') as HTMLDetailsElement).open = true;
    await user.click(within(docs).getAllByRole('button', { name: /^Correct this value: Item \(Centrifugal pump\) in RFQ/ })[0]!);
    expect(within(docs).getByRole('form', { name: /Correct Item/ })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Choose a sample set'), 'scopecheck-layout');
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('review #14: after saving a correction, focus returns to a stable control (not the document)', async () => {
    const user = userEvent.setup();
    render(<App initialFixtureId="scopecheck-standard" />);
    const card = screen.getByRole('heading', { name: /Quantity differs for CP-100 in Quotation QA-17, Alder Pump Supplies/ }).closest('article')! as HTMLElement;
    const open = within(card).getByRole('button', { name: /^Correct this value: Quantity \(8 units\) in Quotation QA-17/ });
    await user.click(open);
    await user.keyboard('10');
    await user.keyboard('{Enter}');
    await new Promise((r) => setTimeout(r, 10));
    // the finding resolved and its card went away: focus must land on the main region, never on the body
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.id).toBe('main');
  });

  it('review #15: repeated controls have distinct accessible names', () => {
    render(<App initialFixtureId="scopecheck-standard" />);
    const names = (re: RegExp) => screen.getAllByRole('button', { name: re }).map((b) => b.getAttribute('aria-label'));
    for (const re of [/^Accept: /, /^Dismiss: /, /^Reopen: /, /^Correct this value: /]) {
      const n = names(re);
      expect(n.length).toBeGreaterThan(1);
      expect(new Set(n).size, String(re)).toBe(n.length);
    }
  });

  it('review #16: the same message twice in a row is announced again', async () => {
    const user = userEvent.setup();
    render(<App initialFixtureId="scopecheck-standard" />);
    const accept = () => within(document.querySelector('article')! as HTMLElement).getByRole('button', { name: /^Accept: / });
    await user.click(accept());
    const first = screen.getByRole('status').textContent;
    await user.click(accept());
    const second = screen.getByRole('status').textContent;
    expect(first?.trim()).toBe(second?.trim());
    expect(first).not.toBe(second); // different text node content, so assistive technology announces it again
  });
});
