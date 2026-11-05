// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { FIXTURES } from './fixtures';

afterEach(cleanup);

describe('the full-length recorded sample is the default', () => {
  it('is first, clearly labelled as recorded model output, and the small set is the second option', () => {
    expect(FIXTURES.map((f) => f.id).slice(0, 2)).toEqual(['scopecheck-fulllength', 'scopecheck-standard']);
    render(<App />);
    const select = screen.getByLabelText('Choose a sample set') as HTMLSelectElement;
    expect(select.value).toBe('scopecheck-fulllength');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options[0]).toBe('Full-length: tender and two quotations (sample)'); // plain name: the model is behind Details (D8)
    expect(options[1]).toMatch(/RFQ and two quotations \(sample\)/);
    const banner = screen.getByRole('region', { name: 'Sample mode' });
    expect(banner.textContent).toMatch(/Recorded from one real AI run on 1 November 2026, replayed unchanged\./);
    expect(banner.textContent).toMatch(/No document is uploaded and no model is called/); // behind Details
    expect(banner.textContent).toMatch(/Model: @cf\/meta\/llama-3\.3-70b-instruct-fp8-fast/); // the model name, also behind Details
    expect(screen.getByText(/A fictional tender and two quotations\. Recorded from one real AI run on 1 November 2026, replayed unchanged\./)).toBeTruthy();
    const desc = screen.getByText(/A fictional tender and two quotations\./).textContent!;
    expect(desc).not.toMatch(/llama|@cf|batch|docs\//i);
  });

  it('the small set can still be chosen and is unchanged', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('Choose a sample set'), 'scopecheck-standard');
    expect(screen.getByRole('heading', { name: /Confirmed findings \(4\)/ })).toBeTruthy();
  });
});

describe('Total as quoted under the matrix', () => {
  it('is a table with one row per quotation, after the matrix; quotation B complete, quotation A incomplete with the count of excluded lines', () => {
    render(<App />);
    const matrix = screen.getByRole('table', { name: /Each requested item compared/ });
    const totals = screen.getByRole('table', { name: /Total as quoted for each quotation/ });
    expect(matrix.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(totals).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Quotation', 'Total as quoted', 'Lines counted', 'Lines excluded']);
    const rows = within(totals).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => /Hydro-Lab Supplies/.test(r.textContent ?? ''))!;
    const b = rows.find((r) => /Delta Field Instruments/.test(r.textContent ?? ''))!;
    expect(b.textContent).toMatch(/ZAR 375 250\.00/);
    expect(b.textContent).not.toMatch(/Incomplete/);
    expect(a.textContent).toMatch(/Incomplete: 5 lines excluded/);
    expect(a.textContent).toMatch(/not the quotation total: ZAR 204 000\.00/);
    const cells = within(a).getAllByRole('cell').map((c) => c.textContent ?? '');
    expect(cells[0]).toMatch(/Incomplete/);
    expect(cells[1]).toBe('6');
    expect(cells[2]).toMatch(/^5/);
    expect(a.textContent).toMatch(/the unit price is held for review/);
    expect(a.textContent).toMatch(/no unit price was extracted/);
  });

  it('does not rank, recommend or highlight a quotation', () => {
    render(<App />);
    const section = screen.getByRole('heading', { name: 'Total as quoted' }).parentElement!;
    expect(section.textContent).not.toMatch(/lowest|cheapest|best|recommend|rank(?!ed)|winner|preferred/i);
    expect(section.textContent).toMatch(/not ranked or compared/);
  });

  it('the small set shows its own totals as complete', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('Choose a sample set'), 'scopecheck-standard');
    const totals = screen.getByRole('table', { name: /Total as quoted for each quotation/ });
    expect(totals.textContent).toMatch(/ZAR 125 000\.00/);
    expect(totals.textContent).toMatch(/ZAR 134 500\.00/);
  });
});

describe('fictional supplier names (full-length sample)', () => {
  it('names the quotations by supplier everywhere, and keeps the layout as a secondary note only', () => {
    const { container } = render(<App />);
    const totals = screen.getByRole('table', { name: /Total as quoted for each quotation/ });
    expect(totals.textContent).toMatch(/Quotation 2207-HL, Hydro-Lab Supplies/);
    expect(totals.textContent).toMatch(/Offer DF\/0098, Delta Field Instruments/);
    expect(container.textContent).not.toMatch(/Quotation A|Quotation B/);
    expect(totals.textContent).not.toMatch(/positioned table|prose/i);
    const notes = [...container.querySelectorAll('[data-doc-note]')].map((n) => n.textContent);
    expect(notes).toEqual(['Layout: positioned table', 'Layout: prose']);
  });
});


describe('evidence pair for a difference (HU-2)', () => {
  it('shows the tender line and the quotation line side by side, each with the cited words marked', () => {
    const { container } = render(<App />);
    const pair = container.querySelector('[data-evidence-pair]');
    expect(pair).toBeTruthy();
    const figures = pair!.querySelectorAll('figure');
    expect(figures.length).toBeGreaterThanOrEqual(2);
    const docs = new Set([...figures].map((f) => f.querySelector('figcaption')!.textContent!.split(',')[0]));
    expect(docs.size).toBeGreaterThanOrEqual(2);
    for (const f of figures) expect(f.querySelector('mark')!.textContent!.length).toBeGreaterThan(0);
  });
});
