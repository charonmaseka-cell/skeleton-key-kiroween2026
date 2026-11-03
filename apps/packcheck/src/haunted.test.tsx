// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY, emptySession, evaluateSession, exportText, seanceSentences } from '@skeleton-key/ui';
import { App } from './App';
import { packCheckAdapter, PACK_THEME } from './adapter';
import { FIXTURES } from './fixtures';

beforeEach(() => localStorage.clear());
afterEach(cleanup);
const view = () => evaluateSession(packCheckAdapter, FIXTURES[0]!, emptySession(), 1);

describe('PackCheck theme names (HU-14)', () => {
  it('uses the explicit mapping: Lost page, Doppelgänger, Changeling, Bottomless purse', () => {
    const name = (code: string) => PACK_THEME[code]!.name;
    expect(name('attachment.missing')).toBe('lost page');
    expect(name('org.name_differs')).toBe('doppelgänger');
    expect(name('funding.differs')).toBe('changeling');
    expect(name('date.differs')).toBe('changeling');
    expect(name('funding.exceeds_budget')).toBe('bottomless purse');
    expect(PACK_THEME['attachment.missing']!.review!.name).toBe('possible lost page');
  });

  it('shows the names in Lights off after the plain message (aria-hidden), and none in Lights on', () => {
    localStorage.setItem(STORAGE_KEY, 'on');
    const on = render(<App />);
    expect(document.querySelectorAll('[data-theme-name]').length).toBe(0);
    on.unmount();
    localStorage.setItem(STORAGE_KEY, 'off');
    render(<App />);
    const names = [...document.querySelectorAll('article [data-theme-name]')].map((n) => n.textContent);
    expect(names.join(' ')).toMatch(/Lost page|Doppelgänger/);
    for (const n of document.querySelectorAll('[data-theme-name]')) expect(n.getAttribute('aria-hidden')).toBe('true');
  });

  it('the séance sentence names the documents and counts the same as the summary and export', () => {
    const v = view();
    const s = seanceSentences(v, 'off');
    expect(s.docs.length).toBeGreaterThan(0);
    expect(s.confirmed).toBe(v.exportModel.findings.length);
    expect(s.review).toBe(v.exportModel.unresolved.length);
    expect(s.docs.map((d) => d.text).join(' ')).toMatch(/lost page|doppelgänger|possible/i);
    expect(s.docs.map((d) => d.text).join(' ')).not.toMatch(/\b(clean|all clear|no problems|nothing found)\b/i);
  });

  it('a confirmed missing attachment is a ghost row; the export has no theme names', () => {
    localStorage.setItem(STORAGE_KEY, 'off');
    render(<App />);
    const rows = document.querySelectorAll('tr[data-ghost]');
    expect(rows.length).toBe(view().items.filter((i) => i.finding.code === 'attachment.missing' && i.finding.state === 'confirmed').length);
    expect(exportText(view())).not.toMatch(/lost page|doppelg|changeling|bottomless|séance/i);
    expect(screen.getByLabelText('Summary')).toBeTruthy();
  });
});
