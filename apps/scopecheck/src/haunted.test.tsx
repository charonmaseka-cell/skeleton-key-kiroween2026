// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY, emptySession, evaluateSession, seanceSentences, confirmDocumentCoverage, exportText } from '@skeleton-key/ui';
import { App } from './App';
import { scopeCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

const lightsOff = () => localStorage.setItem(STORAGE_KEY, 'off');
const lightsOn = () => localStorage.setItem(STORAGE_KEY, 'on');
beforeEach(() => localStorage.clear());
afterEach(cleanup);

const FORBIDDEN = /\b(clean|all clear|no problems|nothing found)\b/i;
const full = FIXTURES[0]!;
const viewOf = (confirm: string[] = [], fixture = full) => {
  let st = emptySession();
  for (const d of confirm) st = confirmDocumentCoverage(st, d, 1);
  return evaluateSession(scopeCheckAdapter, fixture, st, 1);
};

describe('séance summary (HU-13)', () => {
  it('is above the matrix with the plain counts beside it', () => {
    render(<App />);
    const seance = document.querySelector('[data-seance]')!;
    const bar = screen.getByLabelText('Summary');
    const matrix = screen.getByRole('table', { name: /Each requested item compared/ });
    expect(seance.compareDocumentPosition(matrix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(seance.parentElement).toBe(bar.parentElement);
  });

  it('uses the plain nouns in Lights on and the theme names in Lights off, always with a plain version for assistive technology', () => {
    const on = seanceSentences(viewOf(), 'on');
    const off = seanceSentences(viewOf(), 'off');
    expect(on.docs.map((d) => d.text).join(' ')).toMatch(/quantity difference|specification difference|stated exclusion|missing item/);
    expect(on.docs.map((d) => d.text).join(' ')).not.toMatch(/ghost|curse|miscount|spectre/);
    expect(off.docs.map((d) => d.text).join(' ')).toMatch(/ghost|curse|miscount|spectre/);
    expect(off.docs.map((d) => d.plain)).toEqual(on.docs.map((d) => d.plain));
    lightsOff();
    render(<App />);
    const li = document.querySelector('[data-seance] li')!;
    expect(li.querySelector('[data-theme-name]')!.getAttribute('aria-hidden')).toBe('true');
    expect(li.querySelector('.sr-only')!.textContent).toMatch(/confirmed in|Nothing confirmed/);
  });

  it('counts agree with the summary bar and the export, never merge Needs review into confirmed, and say what did not run', () => {
    for (const fixture of FIXTURES) {
      for (const confirm of [[], fixture.docs.filter((d) => d.role === 'quote').map((d) => d.id)]) {
        const v = viewOf(confirm, fixture);
        const s = seanceSentences(v, 'on');
        expect(s.confirmed).toBe(v.exportModel.findings.length);
        expect(s.review).toBe(v.exportModel.unresolved.length);
        expect(s.didNotRun).toBe(v.exportModel.comparisons.notEvaluated);
        for (const d of s.docs) {
          expect(d.text).not.toMatch(FORBIDDEN);
          if (d.confirmed === 0) expect(d.text).toMatch(/Nothing confirmed so far/);
          if (d.review > 0) expect(d.text).toMatch(/need[s]? review/);
        }
      }
    }
  });

  it('says coverage is not confirmed while any document is unverified, and stops saying it once every document is confirmed', () => {
    expect(seanceSentences(viewOf(), 'on').coverage).toMatch(/Coverage is not confirmed for 3 documents/);
    const all = full.docs.map((d) => d.id);
    expect(seanceSentences(viewOf(all), 'on').coverage).toBeNull();
  });
});

describe('theme names (HU-10)', () => {
  it('appear after the plain message in Lights off, hidden from assistive technology, and never in Lights on or the export', () => {
    lightsOn();
    const { unmount } = render(<App />);
    expect(document.querySelectorAll('[data-theme-name]').length).toBe(0);
    unmount();
    lightsOff();
    render(<App />);
    const names = [...document.querySelectorAll('article [data-theme-name]')];
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n.getAttribute('aria-hidden')).toBe('true');
    expect(names.map((n) => n.textContent).join(' ')).toMatch(/Miscount|Curse/);
    expect(exportText(viewOf())).not.toMatch(/ghost|curse|miscount|spectre|séance/i);
  });
});

describe('confirming coverage turns a missing item into a ghost row (HU-11)', () => {
  it('the full-length sample has a missing item (SP-5302, Delta Field Instruments) that is Needs review until that offer\'s coverage is confirmed, and two (FD-4215, CL-6401) that stay Needs review even then', () => {
    const absent = (v: ReturnType<typeof viewOf>) => v.items.filter((i) => i.finding.code === 'item.absent').map((i) => `${i.finding.message.split(' ')[0]}:${i.finding.state}`).sort();
    expect(absent(viewOf())).toEqual(['CL-6401:needs_review', 'FD-4215:needs_review', 'SP-5302:needs_review']);
    expect(absent(viewOf(['quote-b']))).toEqual(['CL-6401:needs_review', 'FD-4215:needs_review', 'SP-5302:confirmed']);
    expect(absent(viewOf(['quote-a', 'quote-b']))).toEqual(['CL-6401:needs_review', 'FD-4215:needs_review', 'SP-5302:confirmed']);
  });

  it('confirming a quotation makes its cell a ghost with a Show the evidence button, which solidifies it and moves focus to the finding', async () => {
    lightsOff();
    const user = userEvent.setup();
    render(<App />);
    expect(document.querySelectorAll('[data-ghost]').length).toBe(0);
    await user.click(screen.getByRole('button', { name: /confirm coverage of Offer DF\/0098, Delta Field Instruments/i }));
    const ghosts = document.querySelectorAll('td[data-ghost]');
    expect(ghosts.length).toBeGreaterThanOrEqual(1);
    expect(ghosts[0]!.textContent).toMatch(/Not in this quotation/);
    expect(ghosts.length).toBe(1);
    await user.click(ghosts[0]!.querySelector('button')!);
    await new Promise((r) => setTimeout(r, 5));
    expect(document.activeElement?.id).toMatch(/^finding-/);
    expect(document.querySelectorAll('td[data-ghost]').length).toBe(ghosts.length - 1);
  });

  it('a Needs-review absence is never a ghost', () => {
    lightsOff();
    render(<App />);
    expect(document.querySelectorAll('[data-ghost]').length).toBe(0);
  });
});

describe('possessed cells (HU-12)', () => {
  it('mark the cells with a confirmed difference', () => {
    render(<App />);
    expect(document.querySelectorAll('td[data-possessed]').length).toBeGreaterThan(0);
  });
});
