// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('ScopeCheck interface', () => {
  it('shows sample mode, the comparison, the review queue, Not evaluated and export, all from the fixture', () => {
    render(<App />);
    expect(screen.getByRole('region', { name: 'Sample mode' }).textContent).toMatch(/SAMPLE MODE: fictional documents/);
    expect(screen.getByRole('heading', { name: /Comparison: RFQ items against each quotation/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Confirmed findings \(3\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Needs review \(1\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Not evaluated \(2\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Export' })).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Requested item', 'Quotation QA-17, Alder Pump Supplies', 'Quotation QB-04, Birch Industrial Trading']);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(3);
  });

  it('every status is text, not colour alone, and Not evaluated is never shown as agreement', () => {
    render(<App />);
    const ne = screen.getByRole('heading', { name: /Not evaluated \(2\)/ }).closest('section')!;
    expect(ne.textContent).toMatch(/did NOT run/);
    expect(within(ne).getAllByText('Not evaluated').length).toBe(2);
    expect(ne.textContent).not.toMatch(/Agrees/);
  });

  it('works by keyboard: Tab reaches the first control after the skip link, Enter accepts a finding, the decision is announced', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.tab();
    expect(document.activeElement?.textContent).toBe('Skip to main content');
    const card = document.querySelector('article')!;
    const accept = within(card as HTMLElement).getByRole('button', { name: 'Accept' });
    accept.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status').textContent).toBe('Decision saved: accepted.');
    expect(within(document.querySelector('article')! as HTMLElement).getAllByText('Accepted').length).toBeGreaterThan(0);
  });

  it('a correction can be made with the keyboard; the original is shown and the comparison updates', async () => {
    const user = userEvent.setup();
    render(<App />);
    const before = screen.getByRole('heading', { name: /Confirmed findings \(3\)/ });
    expect(before).toBeTruthy();
    const card = screen.getByRole('heading', { name: /Quantity differs for CP-100 in quote-a/ }).closest('article')! as HTMLElement;
    const quoteValue = within(card).getAllByRole('listitem').find((li) => li.textContent?.includes('Alder Pump Supplies'))!;
    const correct = within(quoteValue).getByRole('button', { name: /Correct this value/ });
    correct.focus();
    await user.keyboard('{Enter}');
    const form = within(card).getByRole('form', { name: /Correct quantity/ });
    await user.type(within(form).getByLabelText('Quantity'), '10');
    await user.type(within(form).getByLabelText('Unit (optional)'), 'units');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status').textContent).toMatch(/Correction saved. The original value is kept/);
    expect(screen.getByRole('heading', { name: /Confirmed findings \(2\)/ })).toBeTruthy();
  });

  it('switching to the free-text sample shows the known miss as Not evaluated and the uncertain line in Needs review', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('Choose a sample set'), 'scopecheck-layout');
    const ne = screen.getByRole('heading', { name: /Not evaluated \(3\)/ }).closest('section')!;
    expect(ne.textContent).toMatch(/no specification fact in quote-c/);
    expect(screen.getByRole('heading', { name: /Item identity is uncertain/ })).toBeTruthy();
  });

  it('the export preview keeps every state and the sample marker', () => {
    render(<App />);
    const pre = document.querySelector('pre')!;
    expect(pre.textContent).toMatch(/^SAMPLE \(fictional\)/);
    expect(pre.textContent).toMatch(/NOT EVALUATED \(2\)/);
    expect(pre.textContent).toMatch(/NEEDS REVIEW, UNRESOLVED \(1\)/);
  });
});
