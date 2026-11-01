// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Block } from '@skeleton-key/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { FIXTURES } from './fixtures';

afterEach(cleanup);

// The upload path in the interface, with the PDF parser and the Worker both faked: what is checked here is
// what the user sees and when anything is sent.

const standard = FIXTURES.find((f) => f.id === 'scopecheck-standard')!;
const SOURCE: Record<string, string> = { 'rfq.pdf': 'rfq', 'quote-a.pdf': 'quote-a', 'quote-b.pdf': 'quote-b' };
const file = (name: string) => new File(['%PDF-1.4 fake'], name, { type: 'application/pdf' });

function setup(opts: { fail?: (n: number) => { status: number; code: string } | null; baseUrl?: string | null; parse?: (f: File, id: string) => Promise<Block[]> } = {}) {
  let requests = 0;
  const parsed: string[] = [];
  const parse = opts.parse ?? (async (f: File, id: string) => {
    parsed.push(f.name);
    return standard.docs.find((d) => d.id === SOURCE[f.name])!.blocks.map((b) => ({ ...b, docId: id }));
  });
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    requests++;
    const f = opts.fail?.(requests);
    if (f) return new Response(JSON.stringify({ error: { code: f.code } }), { status: f.status });
    const body = JSON.parse(String(init.body)) as { blocks: { id: string; text: string }[] };
    const src = standard.docs.find((d) => body.blocks.every((b) => d.blocks.some((x) => x.id === b.id && x.text === b.text)));
    const ids = new Set(body.blocks.map((b) => b.id));
    return new Response(JSON.stringify({ claims: (src!.claims as { blockId: string }[]).filter((c) => ids.has(c.blockId)), meta: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  const utils = render(<App deps={{ parse, fetchImpl }} baseUrl={opts.baseUrl === null ? undefined : (opts.baseUrl ?? 'https://worker.example')} />);
  return { ...utils, get requests() { return requests; }, parsed };
}

async function choose(user: ReturnType<typeof userEvent.setup>, rfq = 'rfq.pdf', q1 = 'quote-a.pdf', q2?: string) {
  await user.upload(screen.getByLabelText('RFQ'), file(rfq));
  await user.upload(screen.getByLabelText('Quotation 1'), file(q1));
  if (q2) await user.upload(screen.getByLabelText(/Quotation 2/), file(q2));
}
const analyseBtn = () => screen.getByRole('button', { name: /^Analyse \(sends extracted text\)/ }) as HTMLButtonElement;

describe('before Analyse: nothing leaves the device', () => {
  it('states plainly that extracted text is sent, and that not all processing is local', () => {
    setup();
    const panel = screen.getByRole('heading', { name: 'Analyse your own documents' }).closest('section')!;
    expect(panel.textContent).toMatch(/text extracted from them is sent to an AI service/);
    expect(panel.textContent).toMatch(/Not all processing is local/);
    expect(panel.textContent).toMatch(/original files are never uploaded/);
  });

  it('choosing files parses them locally and sends no request; Analyse stays disabled until the RFQ and one quotation are readable', async () => {
    const user = userEvent.setup();
    const s = setup();
    expect(analyseBtn().disabled).toBe(true);
    await user.upload(screen.getByLabelText('RFQ'), file('rfq.pdf'));
    expect(analyseBtn().disabled).toBe(true);
    await user.upload(screen.getByLabelText('Quotation 1'), file('quote-a.pdf'));
    await waitFor(() => expect(analyseBtn().disabled).toBe(false));
    expect(s.parsed).toEqual(['rfq.pdf', 'quote-a.pdf']);
    expect(s.requests).toBe(0);
    expect(screen.getAllByText(/Read on your device: \d+ text lines/).length).toBe(2);
  });

  it('a scanned PDF is refused with an explicit message and does not enable Analyse', async () => {
    const user = userEvent.setup();
    setup({ parse: async () => { throw new Error('unsupported_pdf:scanned_or_empty'); } });
    await user.upload(screen.getByLabelText('RFQ'), file('rfq.pdf'));
    expect((await screen.findByText(/no text layer \(it looks scanned\)/)).textContent).toMatch(/Scanned documents are not supported/);
    expect(analyseBtn().disabled).toBe(true);
  });

  it('a file that is not a PDF, or is too large, is refused without being read', async () => {
    // the browser's file picker can be set to "all files", so the component must refuse a non-PDF itself
    const user = userEvent.setup({ applyAccept: false });
    const s = setup();
    await user.upload(screen.getByLabelText('RFQ'), new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText(/Only PDF files with a text layer/)).toBeTruthy();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Quotation 1'), big);
    expect(await screen.findByText(/larger than 5 MB/)).toBeTruthy();
    expect(s.parsed).toEqual([]);
  });

  it('with no analysis service connected the panel says so and Analyse cannot be pressed', async () => {
    const user = userEvent.setup();
    setup({ baseUrl: null });
    expect(screen.getByRole('note').textContent).toMatch(/Analysis is not available on this site yet/);
    await choose(user);
    await waitFor(() => expect(screen.getAllByText(/Read on your device/).length).toBe(2));
    expect(analyseBtn().disabled).toBe(true);
  });
});

describe('Analyse', () => {
  it('works by keyboard, switches to Live mode (banner replaces the sample banner), and shows results from the same rules', async () => {
    const user = userEvent.setup();
    const s = setup();
    await choose(user, 'rfq.pdf', 'quote-a.pdf', 'quote-b.pdf');
    await waitFor(() => expect(analyseBtn().disabled).toBe(false));
    analyseBtn().focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Live mode' })).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Sample mode' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Live mode' }).textContent).toMatch(/Extracted text was sent to an AI service for analysis; not all processing is local/);
    expect(s.requests).toBeGreaterThan(0);
    expect((screen.getByLabelText('Choose a sample set') as HTMLSelectElement).selectedOptions[0]!.textContent).toMatch(/\(live\)/);
    expect(screen.getByRole('heading', { name: /Confirmed findings \(\d+\)/ })).toBeTruthy();
    expect(document.querySelector('pre')!.textContent).not.toMatch(/SAMPLE/);
  });

  it('the omission against a fully processed quotation is still Needs review (coverage is never inferred)', async () => {
    const user = userEvent.setup();
    setup();
    await choose(user, 'rfq.pdf', 'quote-a.pdf', 'quote-b.pdf');
    await waitFor(() => expect(analyseBtn().disabled).toBe(false));
    await user.click(analyseBtn());
    await waitFor(() => expect(screen.getByRole('region', { name: 'Live mode' })).toBeTruthy());
    const pre = document.querySelector('pre')!.textContent!;
    expect(pre).toMatch(/PG-6 not found in quote-2/);
    expect(pre).toMatch(/\[NEEDS REVIEW\] PG-6 not found in quote-2/);
  });

  it('a daily-allowance error is a recoverable alert; nothing is invented; sample mode still works', async () => {
    const user = userEvent.setup();
    const s = setup({ fail: () => ({ status: 429, code: 'daily_limit' }) });
    await choose(user, 'rfq.pdf', 'quote-a.pdf');
    await waitFor(() => expect(analyseBtn().disabled).toBe(false));
    await user.click(analyseBtn());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/daily analysis allowance has been used|has not been opened yet/);
    expect(s.requests).toBe(1);
    expect(screen.getAllByText(/Not fully processed: nothing can be called missing from it/).length).toBe(2);
    expect(screen.getByRole('button', { name: /Try the failed parts again/ })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Choose a sample set'), 'scopecheck-standard');
    expect(screen.getByRole('region', { name: 'Sample mode' })).toBeTruthy();
  });

  it('a manual retry resends only what failed, and the result then completes', async () => {
    const user = userEvent.setup();
    let allow = false;
    const s = setup({ fail: () => (allow ? null : { status: 503, code: 'quota_exhausted' }) });
    await choose(user, 'rfq.pdf', 'quote-a.pdf');
    await waitFor(() => expect(analyseBtn().disabled).toBe(false));
    await user.click(analyseBtn());
    await screen.findByRole('alert');
    expect(s.requests).toBe(1);
    allow = true;
    await user.click(screen.getByRole('button', { name: /Try the failed parts again/ }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getAllByText('Fully processed').length).toBe(2);
    const before = s.requests;
    expect(before).toBeGreaterThan(1);
  });
});
