// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Block } from '@skeleton-key/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { FIXTURES } from './fixtures';
import { STANDARD_FIRST } from './test-fixtures';

afterEach(cleanup);

// What a person sees: a run the day cannot cover is refused before anything is sent, with a plain message; an admitted run shows its
// stages in order.

const standard = FIXTURES.find((f) => f.id === 'scopecheck-standard')!;
const SOURCE: Record<string, string> = { 'rfq.pdf': 'rfq', 'quote-a.pdf': 'quote-a' };
const file = (name: string) => new File(['%PDF-1.4 fake'], name, { type: 'application/pdf' });

function setup(runReply: { status: number; body: unknown }) {
  const paths: string[] = [];
  const parse = async (f: File, id: string): Promise<Block[]> => standard.docs.find((d) => d.id === SOURCE[f.name])!.blocks.map((b) => ({ ...b, docId: id }));
  const fetchImpl = (async (u: string, init: RequestInit) => {
    const path = new URL(u).pathname;
    paths.push(path);
    if (path === '/run') return new Response(JSON.stringify(runReply.body), { status: runReply.status });
    if (path === '/run/close') return new Response('{"closed":true}', { status: 200 });
    const body = JSON.parse(String(init.body)) as { blocks: { id: string; text: string }[] };
    const src = standard.docs.find((d) => body.blocks.every((b) => d.blocks.some((x) => x.id === b.id && x.text === b.text)));
    const ids = new Set(body.blocks.map((b) => b.id));
    return new Response(JSON.stringify({ claims: (src!.claims as { blockId: string }[]).filter((c) => ids.has(c.blockId)), meta: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  render(<App fixtures={STANDARD_FIRST} deps={{ parse, fetchImpl }} baseUrl="https://worker.example" />);
  return { paths };
}
const OK = { status: 200, body: { runId: 3, token: 'z'.repeat(32), holdNeurons: 500, attempts: 4, budget: 4000, remaining: 3500 } };
const NO = { status: 429, body: { error: { code: 'run_exceeds_allowance', need: 3600, remaining: 800, budget: 4000 } } };

async function analyse(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('RFQ'), file('rfq.pdf'));
  await user.upload(screen.getByLabelText('Quotation 1'), file('quote-a.pdf'));
  await user.click(screen.getByRole('button', { name: /^Analyse \(sends extracted text\)/ }));
}

describe('refusal up front', () => {
  it('shows a plain message with the share of the allowance, sends no document text, keeps the sample on the page, and never starts extracting', async () => {
    const user = userEvent.setup();
    const w = setup(NO);
    await analyse(user);
    const msg = await screen.findByRole('alert');
    expect(msg.textContent).toMatch(/about 90% of today's analysis allowance, and about 20% is left/);
    expect(msg.textContent).toMatch(/nothing was sent/i);
    expect(w.paths).toEqual(['/run']);
    expect(screen.getByRole('region', { name: 'Sample mode' })).toBeTruthy();
    const progress = screen.getByRole('region', { name: 'Analysis progress' });
    expect(within(progress).getByText(/Not started: nothing was sent/)).toBeTruthy();
    expect(progress.querySelector('[data-stage="matching"]')!.getAttribute('data-state')).toBe('not_run');
  });
});

describe('progress of an admitted run', () => {
  it('shows reading, extracting, matching and checking in order, all done at the end, and switches to live results', async () => {
    const user = userEvent.setup();
    const w = setup(OK);
    await analyse(user);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Live mode' })).toBeTruthy(), { timeout: 5000 });
    const progress = await screen.findByRole('region', { name: 'Analysis progress' });
    await waitFor(() => expect(progress.querySelector('[data-stage="checking"]')!.getAttribute('data-state')).toBe('done'));
    expect([...progress.querySelectorAll('li')].map((li) => li.getAttribute('data-stage'))).toEqual(['reading', 'extracting', 'matching', 'checking']);
    expect([...progress.querySelectorAll('li')].map((li) => li.getAttribute('data-state'))).toEqual(['done', 'done', 'done', 'done']);
    expect(w.paths[0]).toBe('/run');
    expect(w.paths.at(-1)).toBe('/run/close');
    expect(w.paths.filter((p) => p === '/run')).toHaveLength(1);
  });
});
