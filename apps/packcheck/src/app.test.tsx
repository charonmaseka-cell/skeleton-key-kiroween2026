// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('PackCheck interface', () => {
  it('shows sample mode, attachment checks, field checks, the review queue, Not evaluated and export, all from the fixture', () => {
    render(<App />);
    expect(screen.getByRole('region', { name: 'Sample mode' }).textContent).toMatch(/SAMPLE MODE: fictional documents/);
    const attach = screen.getByRole('heading', { name: /Attachment checks/ }).closest('section')!;
    expect(within(attach).getAllByRole('row').length).toBe(5); // header + 4 required attachments
    expect(attach.textContent).toMatch(/Tax clearance certificate/);
    const fields = screen.getByRole('heading', { name: /Field checks/ }).closest('section')!;
    expect(fields.textContent).toMatch(/Funding requested/);
    expect(screen.getByRole('heading', { name: /Confirmed findings \(1\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Needs review \(2\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Not evaluated \(1\)/ })).toBeTruthy();
  });

  it('funding requested (R1.6 million) against the budget (R2 million) is checked, agrees, and has no finding', () => {
    render(<App />);
    const fields = screen.getByRole('heading', { name: /Field checks/ }).closest('section')!;
    const row = within(fields).getAllByRole('row').find((r) => /Funding requested within the total budget/.test(r.textContent ?? ''))!;
    expect(row.textContent).toMatch(/requested ZAR 1 600 000, budget ZAR 2 000 000/);
    expect(row.textContent).toMatch(/Agrees/);
    expect(document.body.textContent).not.toMatch(/exceeds the total project budget/);
  });

  it('the ambiguous date is Needs review and its comparison is Not evaluated with the reason and blocked input', () => {
    render(<App />);
    const ne = screen.getByRole('heading', { name: /Not evaluated \(1\)/ }).closest('section')!;
    expect(ne.textContent).toMatch(/Project start date/);
    expect(ne.textContent).not.toMatch(/date_format_ambiguous|project_start_date/);
    expect(ne.textContent).toMatch(/Blocked input: Project start date in Project budget summary/);
    expect(ne.textContent).toMatch(/could be read more than one way/);
  });

  it('supplying the date by keyboard resolves the Needs-review item and lets the comparison run', async () => {
    const user = userEvent.setup();
    render(<App />);
    const ne = screen.getByRole('heading', { name: /Not evaluated \(1\)/ }).closest('section')! as HTMLElement;
    const btn = within(ne).getByRole('button', { name: /Correct this value/ });
    btn.focus();
    await user.keyboard('{Enter}');
    // focus moves to the first field when the editor opens, so typing needs no pointer
    expect(document.activeElement).toBe(within(ne).getByLabelText('Date'));
    await user.keyboard('2026-03-01{Enter}');
    expect(screen.getByRole('status').textContent).toMatch(/Correction saved/);
    expect(screen.getByRole('heading', { name: /Not evaluated \(0\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Needs review \(1\)/ })).toBeTruthy();
  });

  it('a bad correction is refused with a message, not saved', async () => {
    const user = userEvent.setup();
    render(<App />);
    const ne = screen.getByRole('heading', { name: /Not evaluated \(1\)/ }).closest('section')! as HTMLElement;
    await user.click(within(ne).getByRole('button', { name: /Correct this value/ }));
    await user.type(within(ne).getByLabelText('Date'), '01/03/2026');
    await user.keyboard('{Enter}');
    expect(within(ne).getByRole('alert').textContent).toMatch(/real date as YYYY-MM-DD/);
    expect(screen.getByRole('heading', { name: /Not evaluated \(1\)/ })).toBeTruthy();
  });

  it('the export preview keeps every state and the sample marker', () => {
    render(<App />);
    const pre = document.querySelector('pre')!;
    expect(pre.textContent).toMatch(/^SAMPLE \(fictional\)/);
    expect(pre.textContent).toMatch(/NOT EVALUATED \(1\)/);
    expect(pre.textContent).toMatch(/CONFIRMED FINDINGS \(1\)/);
  });
});
