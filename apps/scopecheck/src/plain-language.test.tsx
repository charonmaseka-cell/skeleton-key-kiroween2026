// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySession, evaluateSession, exportCsv, exportText, findLeaks, internalNames } from '@skeleton-key/ui';
import { App } from './App';
import { scopeCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

// Nothing a person sees names an internal key: no field keys, document IDs (quote-a, rfq), reason codes (match_unresolved),
// schema IDs or block IDs. Block IDs appear only in the evidence detail.

afterEach(cleanup);
const { names, blockIds } = internalNames(scopeCheckAdapter, FIXTURES);

describe('ScopeCheck shows plain labels only', () => {
  for (const f of FIXTURES) {
    it(`sample set "${f.title}": every section, editor label and accessible name, and the export preview`, async () => {
      const user = userEvent.setup();
      render(<App />);
      await user.selectOptions(screen.getByLabelText('Choose a sample set'), f.id);
      expect(findLeaks(document.body, names, blockIds)).toEqual([]);
    });
  }

  it('with a correction editor open and after a correction', async () => {
    const user = userEvent.setup();
    render(<App />);
    const card = screen.getByRole('heading', { name: /Quantity differs for CP-100/ }).closest('article')! as HTMLElement;
    await user.click(within(card).getAllByRole('button', { name: /^Correct this value: Quantity/ })[0]!);
    expect(findLeaks(document.body, names, blockIds)).toEqual([]);
    await user.type(within(card).getByLabelText('Quantity'), '10');
    await user.keyboard('{Enter}');
    expect(findLeaks(document.body, names, blockIds)).toEqual([]);
  });

  it('the evidence detail keeps the block reference', () => {
    render(<App />);
    const refs = [...document.querySelectorAll('[data-evidence-ref]')].map((e) => e.textContent ?? '');
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((t) => /^\(source reference \S+\)$/.test(t))).toBe(true);
  });
});

describe('ScopeCheck exports use plain labels', () => {
  for (const f of FIXTURES) {
    it(`text and CSV for "${f.title}"`, () => {
      const v = evaluateSession(scopeCheckAdapter, f, emptySession(), 1);
      for (const out of [exportText(v), exportCsv(v)]) {
        const div = document.createElement('div');
        div.textContent = out;
        expect(findLeaks(div, names, blockIds)).toEqual([]);
      }
    });
  }
});
