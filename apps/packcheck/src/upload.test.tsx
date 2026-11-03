// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Block } from '@skeleton-key/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { App, PACKCHECK_SLOTS } from './App';
import { FIXTURES } from './fixtures';

afterEach(cleanup);

// PackCheck upload path in the interface, with the PDF parser and the Worker both faked (no live inference).
// The fake Worker answers with the recorded claims of the sample pack for the text it receives.

const pack = FIXTURES[0]!;
const SOURCE: Record<string, string> = { 'requirements.pdf': 'requirements', 'form.pdf': 'application-form', 'budget.pdf': 'budget', 'registration.pdf': 'registration' };
const file = (name: string) => new File(['%PDF-1.4 fake'], name, { type: 'application/pdf' });

function setup(opts: { fail?: (n: number) => { status: number; code: string } | null; baseUrl?: string | null } = {}) {
  let requests = 0;
  const bodies: { schemaId: string; blocks: { id: string; text: string }[] }[] = [];
  const parse = async (f: File, id: string): Promise<Block[]> => pack.docs.find((d) => d.id === SOURCE[f.name])!.blocks.map((b) => ({ ...b, docId: id }));
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    requests++;
    const body = JSON.parse(String(init.body)) as (typeof bodies)[number];
    bodies.push(body);
    const f = opts.fail?.(requests);
    if (f) return new Response(JSON.stringify({ error: { code: f.code } }), { status: f.status });
    const src = pack.docs.find((d) => body.blocks.every((b) => d.blocks.some((x) => x.id === b.id && x.text === b.text)));
    const ids = new Set(body.blocks.map((b) => b.id));
    return new Response(JSON.stringify({ claims: (src!.claims as { blockId: string }[]).filter((c) => ids.has(c.blockId)), meta: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  render(<App deps={{ parse, fetchImpl }} baseUrl={opts.baseUrl === null ? undefined : (opts.baseUrl ?? 'https://worker.example')} />);
  return { get requests() { return requests; }, bodies };
}

const analyseBtn = () => screen.getByRole('button', { name: /^Analyse \(sends extracted text\)/ }) as HTMLButtonElement;
async function choose(user: ReturnType<typeof userEvent.setup>, all = true) {
  await user.upload(screen.getByLabelText('Application requirements'), file('requirements.pdf'));
  await user.upload(screen.getByLabelText('Application form'), file('form.pdf'));
  if (all) {
    await user.upload(screen.getByLabelText(/Budget summary/, { selector: 'input' }), file('budget.pdf'));
    await user.upload(screen.getByLabelText(/Registration certificate/, { selector: 'input' }), file('registration.pdf'));
  }
}

describe('PackCheck slots', () => {
  it('require the requirements and the form, use the one pack profile, and use the role as the document id the adapter reads', () => {
    expect(PACKCHECK_SLOTS.filter((s) => s.required).map((s) => s.id)).toEqual(['requirements', 'application-form']);
    expect(new Set(PACKCHECK_SLOTS.map((s) => s.schemaId))).toEqual(new Set(['packcheck.grant.v2']));
    expect(PACKCHECK_SLOTS.every((s) => s.id === s.role)).toBe(true);
  });
});

describe('PackCheck upload', () => {
  it('states the live limits before anything is chosen and starts in sample mode', () => {
    setup();
    expect(screen.getByTestId('live-limits').textContent).toMatch(/Live analysis is limited.*at most 30 requests/);
    expect(screen.getByRole('region', { name: 'Sample mode' })).toBeTruthy();
  });

  it('shows the plain statement, reads files on the device, and sends nothing before Analyse', async () => {
    const user = userEvent.setup();
    const s = setup();
    const panel = screen.getByRole('heading', { name: 'Analyse your own documents' }).closest('details')!;
    expect(panel.textContent).toMatch(/text extracted from them is sent to an AI service/);
    expect(analyseBtn().disabled).toBe(true);
    await user.upload(screen.getByLabelText('Application requirements'), file('requirements.pdf'));
    expect(analyseBtn().disabled).toBe(true); // the form is also required
    await user.upload(screen.getByLabelText('Application form'), file('form.pdf'));
    await waitFor(() => expect(analyseBtn().disabled).toBe(false));
    expect(s.requests).toBe(0);
  });

  it('with no analysis service connected, Analyse cannot be pressed and the sample pack still works', async () => {
    const user = userEvent.setup();
    setup({ baseUrl: null });
    expect(screen.getAllByRole('note').some((n) => /Analysis is not available on this site yet/.test(n.textContent ?? ''))).toBe(true);
    await choose(user, false);
    await waitFor(() => expect(screen.getAllByText(/Read on your device/).length).toBe(2));
    expect(analyseBtn().disabled).toBe(true);
    expect(screen.getByRole('region', { name: 'Sample mode' })).toBeTruthy();
  });

  it('Analyse switches to Live mode and the same rules produce findings; coverage stays unverified so omissions are Needs review', async () => {
    const user = userEvent.setup();
    const s = setup();
    await choose(user);
    await waitFor(() => expect(analyseBtn().disabled).toBe(false));
    await user.click(analyseBtn());
    await waitFor(() => expect(screen.getByRole('region', { name: 'Live mode' })).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Sample mode' })).toBeNull();
    expect(s.requests).toBeGreaterThan(0);
    expect(s.bodies.every((b) => b.schemaId === 'packcheck.grant.v2')).toBe(true);
    // the request body is exactly {schemaId, blocks}: no file name, role or model
    expect(s.bodies.every((b) => Object.keys(b).sort().join() === 'blocks,schemaId')).toBe(true);
    expect(screen.getByRole('heading', { name: 'Your pack' })).toBeTruthy();
    expect(document.querySelector('pre')!.textContent).not.toMatch(/SAMPLE/);
  });

  it('a daily-allowance error is a recoverable alert; the document is marked not fully processed and nothing is invented', async () => {
    const user = userEvent.setup();
    const s = setup({ fail: () => ({ status: 429, code: 'daily_limit' }) });
    await choose(user, false);
    await waitFor(() => expect(analyseBtn().disabled).toBe(false));
    await user.click(analyseBtn());
    expect((await screen.findByRole('alert')).textContent).toMatch(/daily analysis allowance has been used|has not been opened yet/);
    expect(s.requests).toBe(1);
    expect(screen.getAllByText(/Not fully processed: nothing can be called missing from it/).length).toBe(2);
    expect(screen.getByRole('button', { name: /Try the failed parts again/ })).toBeTruthy();
  });

  for (const code of ['daily_limit', 'limiter_unavailable'] as const) {
    it(`${code} on the first request: a plain message, nothing invented, and the sample pack stays shown and usable`, async () => {
      const user = userEvent.setup();
      const s = setup({ fail: () => ({ status: code === 'daily_limit' ? 429 : 503, code }) });
      await choose(user, false);
      await waitFor(() => expect(analyseBtn().disabled).toBe(false));
      await user.click(analyseBtn());
      const alert = (await screen.findByRole('alert')).textContent ?? '';
      expect(alert).toMatch(code === 'daily_limit' ? /Live analysis is not available right now: today's allowance has been used/ : /Live analysis is paused/);
      expect(alert).toMatch(/The sample sets on this page still work\./);
      expect(alert).not.toMatch(/_|\b(?:429|503)\b/); // no code, no status number
      expect(s.requests).toBe(1); // the run stopped at once
      // Nothing was processed, so the page is not replaced: still the sample pack, with its findings, in sample mode.
      expect(screen.getByRole('region', { name: 'Sample mode' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Sample pack' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: /Confirmed findings \(1\)/ })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Back to the sample pack/ })).toBeNull();
      // and the sample is still usable: a correction works
      const ne = screen.getByRole('heading', { name: /Not evaluated \(1\)/ }).closest('section')! as HTMLElement;
      await user.click(within(ne).getByRole('button', { name: /Correct this value/ }));
      await user.type(within(ne).getByLabelText('Date'), '2026-03-01');
      await user.keyboard('{Enter}');
      expect(screen.getByRole('heading', { name: /Not evaluated \(0\)/ })).toBeTruthy();
    });
  }

  it('a stop after part of the pack was processed shows the partial live result, and "Back to the sample pack" returns to it', async () => {
    const user = userEvent.setup();
    setup({ fail: (n) => (n >= 2 ? { status: 503, code: 'limiter_unavailable' } : null) });
    await choose(user, false);
    await waitFor(() => expect(analyseBtn().disabled).toBe(false));
    await user.click(analyseBtn());
    expect((await screen.findByRole('alert')).textContent).toMatch(/Live analysis is paused/);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Live mode' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Back to the sample pack' }));
    expect(screen.getByRole('region', { name: 'Sample mode' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sample pack' })).toBeTruthy();
  });
});
