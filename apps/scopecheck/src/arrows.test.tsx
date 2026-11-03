// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySession, evaluateSession, exportCsv, exportText } from '@skeleton-key/ui';
import { App } from './App';
import { scopeCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

afterEach(cleanup);

describe('compared values are joined by an arrow, never "<->"', () => {
  it('on the page, in the text export and in the CSV, for every sample set', () => {
    const { container } = render(<App />);
    expect(container.textContent).toMatch(/\d+ each → \d+ each/);
    expect(container.textContent).not.toMatch(/<->|&lt;-&gt;/);
    for (const f of FIXTURES) {
      const v = evaluateSession(scopeCheckAdapter, f, emptySession(), 1);
      for (const out of [exportText(v), exportCsv(v)]) expect(out).not.toContain('<->');
    }
  });
});
