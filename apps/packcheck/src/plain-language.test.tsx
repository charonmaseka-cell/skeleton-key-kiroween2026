// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySession, evaluateSession, exportCsv, exportText, findLeaks, internalNames } from '@skeleton-key/ui';
import { App } from './App';
import { packCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

// Nothing a person sees names an internal key: no field keys (organisation_name), document IDs (application-form), reason
// codes (date_format_ambiguous), schema IDs or block IDs. Block IDs appear only in the evidence detail.

afterEach(cleanup);
const { names, blockIds } = internalNames(packCheckAdapter, FIXTURES);

describe('PackCheck shows plain labels only', () => {
  it('the sample page, including every section, editor label and accessible name', () => {
    render(<App />);
    expect(findLeaks(document.body, names, blockIds)).toEqual([]);
  });

  it('with a correction editor open and after a correction (user-supplied values, reopened items)', async () => {
    const user = userEvent.setup();
    render(<App />);
    const ne = screen.getByRole('heading', { name: /Not evaluated \(1\)/ }).closest('section')! as HTMLElement;
    await user.click(within(ne).getByRole('button', { name: /Correct this value/ }));
    expect(findLeaks(document.body, names, blockIds)).toEqual([]);
    await user.type(within(ne).getByLabelText('Date'), '2026-03-01');
    await user.keyboard('{Enter}');
    expect(findLeaks(document.body, names, blockIds)).toEqual([]);
  });

  it('the evidence detail keeps the block reference (and only there)', () => {
    render(<App />);
    const refs = [...document.querySelectorAll('[data-evidence-ref]')].map((e) => e.textContent);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((t) => /source reference p\d+-l\d+/.test(t ?? ''))).toBe(true);
  });

  it('the text and CSV exports', () => {
    render(<App />);
    const pre = document.querySelector('pre')!;
    expect(pre.textContent).toMatch(/\(block p\d+-l\d+\)/); // evidence detail kept
    expect(findLeaks(pre, names, blockIds)).toEqual([]);
  });
});

// The exports are checked on their own too (block IDs are allowed only inside the evidence detail there).
describe('PackCheck exports use plain labels', () => {
  it('text and CSV', () => {
    const v = evaluateSession(packCheckAdapter, FIXTURES[0]!, emptySession(), 1);
    for (const out of [exportText(v), exportCsv(v)]) {
      const div = document.createElement('div');
      div.textContent = out;
      expect(findLeaks(div, names, blockIds)).toEqual([]);
    }
  });
});
