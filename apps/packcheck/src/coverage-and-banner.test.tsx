// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { COVERAGE_HINT } from '@skeleton-key/ui';
import { App } from './App';

afterEach(cleanup);

const sections = () => [...document.querySelectorAll('#docs-h ~ details')] as HTMLDetailsElement[];

describe('coverage hint', () => {
  it('shows the agreed wording beside every document whose coverage is unverified, and only there', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(COVERAGE_HINT).toBe('Confirm coverage after checking every page. This lets us confirm missing items where the match is clear.');
    const docs = sections();
    expect(docs.length).toBeGreaterThan(0);
    for (const d of docs) {
      const hint = d.querySelector('summary [data-coverage-hint]');
      expect(hint?.textContent, d.querySelector('summary')!.textContent!).toBe(COVERAGE_HINT);
    }
    // confirming one document removes its hint (and only its hint)
    const first = docs[0]!;
    first.open = true;
    await user.click(within(first).getByRole('button', { name: /confirm coverage of/i }));
    const after = sections();
    expect(after[0]!.querySelector('[data-coverage-hint]')).toBeNull();
    for (const d of after.slice(1)) expect(d.querySelector('[data-coverage-hint]')).not.toBeNull();
    // and the withdraw control brings it back
    after[0]!.open = true;
    await user.click(within(after[0]!).getByRole('button', { name: /withdraw my coverage confirmation/i }));
    expect(sections()[0]!.querySelector('[data-coverage-hint]')).not.toBeNull();
  });
});

describe('sample banner', () => {
  it('is one line with the details behind a toggle on narrow screens, and complete on wide ones; the label is never hidden', () => {
    render(<App />);
    const banner = screen.getByRole('region', { name: 'Sample mode' });
    const compact = banner.querySelector('details[data-banner-compact]') as HTMLDetailsElement;
    expect(compact.open).toBe(false);
    // narrow: the visible line carries the mode and the toggle
    const line = compact.querySelector('summary')!;
    expect(line.textContent).toMatch(/SAMPLE MODE: fictional documents/);
    expect(line.textContent).toMatch(/Details/);
    expect(compact.className).toMatch(/sm:hidden/);
    // the fold holds the explanation: "Not a real review", ONE plain line about the recording, and the details
    expect(compact.textContent).toMatch(/Not a real review/);
    expect(compact.textContent).toMatch(/Recorded from real AI runs on 1 (and 3 )?November 2026, replayed unchanged\./);
    // wide: the label and the plain line are shown; the model, run and paths are behind the Details toggle
    const wide = banner.querySelector('div.hidden.sm\\:block')!;
    expect(wide.textContent).toMatch(/SAMPLE MODE: fictional documents\. Not a real review\./);
    expect(wide.textContent).toMatch(/Recorded from real AI runs on 1 (and 3 )?November 2026, replayed unchanged\./);
    const det = wide.querySelector('details[data-banner-details]') as HTMLDetailsElement;
    expect(det.open).toBe(false);
    expect(det.querySelector('summary')!.textContent).toBe('Details');
    expect(det.textContent).toMatch(/@cf\/meta\/llama-3\.3-70b/);
    expect(det.textContent).toMatch(/samples\/benchmark-results\//);
    // the plain line itself carries no model id, batch name or path
    const plain = [...wide.querySelectorAll('p')].map((p) => p.textContent).join(' ');
    expect(plain).not.toMatch(/llama|@cf|batch|samples\/|docs\//i);
  });
});
