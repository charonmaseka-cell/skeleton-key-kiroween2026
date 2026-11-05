// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Block } from '@skeleton-key/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_TEXT } from '@skeleton-key/ui';
import { App } from './App';
import { STANDARD_FIRST } from './test-fixtures';
import { FIXTURES } from './fixtures';

// One regression test per defect from the beta sweep of 52107e2 (D1, D2, D5, D6, D8; D4, D7 and D9 are checked in their own files).
afterEach(cleanup);

const standard = FIXTURES.find((f) => f.id === 'scopecheck-standard')!;
const SOURCE: Record<string, string> = { 'rfq.pdf': 'rfq', 'quote-a.pdf': 'quote-a', 'quote-b.pdf': 'quote-b' };
const file = (name: string, body = '%PDF-1.4 fake') => new File([body], name, { type: 'application/pdf' });

function setup(opts: { fail?: (n: number) => { status: number; code: string } | null; fixtures?: typeof STANDARD_FIRST } = {}) {
  let requests = 0;
  const parse = async (f: File, id: string): Promise<Block[]> => standard.docs.find((d) => d.id === SOURCE[f.name])!.blocks.map((b) => ({ ...b, docId: id })) as Block[];
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    if (/\/run(\/close)?$/.test(String(_u))) return new Response(JSON.stringify({ runId: 1, token: 't'.repeat(32), holdNeurons: 1, attempts: 1, budget: 4000, remaining: 3999, closed: true }), { status: 200 });
    requests++;
    const f = opts.fail?.(requests);
    if (f) return new Response(JSON.stringify({ error: { code: f.code } }), { status: f.status });
    const body = JSON.parse(String(init.body)) as { blocks: { id: string; text: string }[] };
    const src = standard.docs.find((d) => body.blocks.every((b) => d.blocks.some((x) => x.id === b.id && x.text === b.text)));
    const ids = new Set(body.blocks.map((b) => b.id));
    return new Response(JSON.stringify({ claims: (src!.claims as { blockId: string }[]).filter((c) => ids.has(c.blockId)), meta: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  return render(<App fixtures={opts.fixtures ?? STANDARD_FIRST} deps={{ parse, fetchImpl }} baseUrl="https://worker.example" />);
}
const analyseBtn = () => screen.getByRole('button', { name: /^Analyse \(sends extracted text\)/ }) as HTMLButtonElement;
const exportPre = () => document.querySelector('#exp-h')!.closest('section')!.querySelector('pre')!.textContent!;

describe('D1: a note typed after a decision is saved', () => {
  it('decide, then type a note, then export: the note is in the text export, the CSV-bound model and the decision history', async () => {
    const user = userEvent.setup();
    setup();
    const card = document.querySelector('article[id^="finding-"]') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: /^Accept:/ }));
    const input = within(card).getByLabelText(/Note for this item/);
    await user.type(input, 'asked the supplier by phone');
    await user.tab(); // leaving the field saves it
    expect(exportPre()).toMatch(/asked the supplier by phone/);
    expect(exportPre()).toMatch(/NOTES \(1\)/);
    expect(within(card).getByText(/Decision history \(2\)/)).toBeTruthy(); // decided + noted
    expect(card.textContent).toMatch(/noted: accepted \(asked the supplier by phone\)/);
  });

  it('the Save note control saves too, and the note survives switching samples and back', async () => {
    const user = userEvent.setup();
    setup();
    const card = document.querySelector('article[id^="finding-"]') as HTMLElement;
    const id = card.id;
    await user.type(within(card).getByLabelText(/Note for this item/), 'checked on site');
    await user.click(within(card).getByRole('button', { name: /^Save note:/ }));
    expect(exportPre()).toMatch(/checked on site/);
    await user.selectOptions(screen.getByLabelText('Choose a sample set'), 'scopecheck-layout');
    await user.selectOptions(screen.getByLabelText('Choose a sample set'), 'scopecheck-standard');
    const again = document.getElementById(id)!;
    expect((within(again).getByLabelText(/Note for this item/) as HTMLInputElement).value).toBe('checked on site');
    expect(exportPre()).toMatch(/checked on site/);
  });
});

describe('D2: the export line says what the export is marked as', () => {
  it('sample: "Marked SAMPLE (fictional)."; live: marked as a live analysis of your documents, and the export is marked live', async () => {
    const user = userEvent.setup();
    setup();
    const line = () => document.querySelector('#exp-h')!.closest('section')!.querySelector('p')!.textContent!;
    expect(line()).toMatch(/Marked SAMPLE \(fictional\)\./);
    await user.upload(screen.getByLabelText('RFQ'), file('rfq.pdf'));
    await user.upload(screen.getByLabelText('Quotation 1'), file('quote-a.pdf'));
    await waitFor(() => expect(analyseBtn().disabled).toBe(false));
    await user.click(analyseBtn());
    await waitFor(() => expect(screen.getByRole('region', { name: 'Live mode' })).toBeTruthy());
    expect(line()).not.toMatch(/SAMPLE/);
    expect(line()).toMatch(/Marked as a live analysis of your documents\./);
    expect(exportPre()).toMatch(/^LIVE ANALYSIS of the documents you uploaded/);
    expect(exportPre()).not.toMatch(/SAMPLE/);
  });
});

describe('D5: each failed part says why', () => {
  it('a timed-out part shows the plain reason from the error text next to the count', async () => {
    const user = userEvent.setup();
    setup({ fail: (n) => (n === 2 ? { status: 504, code: 'timeout' } : null) });
    await user.upload(screen.getByLabelText('RFQ'), file('rfq.pdf'));
    await user.upload(screen.getByLabelText('Quotation 1'), file('quote-a.pdf'));
    await waitFor(() => expect(analyseBtn().disabled).toBe(false));
    await user.click(analyseBtn());
    const list = await waitFor(() => {
      const el = document.querySelector('[data-failed-reasons]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(list.textContent).toContain(ERROR_TEXT.timeout.text);
    expect(list.textContent).toMatch(/Quotation 1, part \d+:/);
    expect(screen.getByText(/part\(s\) were not processed\./)).toBeTruthy();
  });
});

describe('D6: the same file in two slots is flagged, and Analyse stays available', () => {
  it('warns when one file (name, size, content) is chosen twice; a different file does not warn', async () => {
    const user = userEvent.setup();
    setup();
    await user.upload(screen.getByLabelText('RFQ'), file('quote-a.pdf', 'same bytes'));
    await user.upload(screen.getByLabelText('Quotation 1'), file('quote-a.pdf', 'same bytes'));
    const warn = await waitFor(() => {
      const el = document.querySelector('[data-duplicate-file]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(warn.textContent).toMatch(/same file is chosen for RFQ and Quotation 1/);
    expect(analyseBtn().disabled).toBe(false);
    // a different file in the second slot removes the warning
    fireEvent.change(screen.getByLabelText('Quotation 1'), { target: { files: [file('quote-b.pdf', 'other bytes')] } });
    await waitFor(() => expect(document.querySelector('[data-duplicate-file]')).toBeNull());
  });
});

describe('D8: the sample picker shows plain names; the model name is behind Details', () => {
  it('no option names the model, and the Details toggle of the full-length sample does', () => {
    setup({ fixtures: FIXTURES });
    const options = [...(screen.getByLabelText('Choose a sample set') as HTMLSelectElement).options].map((o) => o.textContent!);
    expect(options.length).toBeGreaterThan(1);
    for (const o of options) expect(o).not.toMatch(/Llama|70B|recorded .* output/i);
    const details = [...document.querySelectorAll('details')].find((d) => /Model:/.test(d.textContent ?? ''));
    expect(details?.textContent).toMatch(/llama-3\.3-70b/);
  });
});

describe('D7: small controls are at least 24 px tall on narrow screens', () => {
  it('both apps\' stylesheets set the minimum for section links, "Open the item" and "Correct this value" at 640 px and below', () => {
    for (const app of ['scopecheck', 'packcheck']) {
      const css = readFileSync(resolve(process.cwd(), `apps/${app}/src/index.css`), 'utf8');
      const block = css.match(/@media \(max-width: 640px\) \{[^@]*?\n\}/)?.[0] ?? '';
      for (const sel of ["nav[aria-label='Sections'] a", "a[aria-label^='Open the item']", "button[aria-label^='Correct this value']"]) expect(block, `${app}: ${sel}`).toContain(sel);
      expect(block).toMatch(/min-height:\s*24px/);
    }
  });
});
