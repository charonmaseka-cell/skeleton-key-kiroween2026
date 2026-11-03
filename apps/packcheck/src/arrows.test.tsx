// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySession, evaluateSession, exportCsv, exportText } from '@skeleton-key/ui';
import { App } from './App';
import { packCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

afterEach(cleanup);

describe('compared values are joined by an arrow, never "<->"', () => {
  it('on the page and in the exports', () => {
    const { container } = render(<App />);
    expect(container.textContent).toMatch(/ → /);
    expect(container.textContent).not.toMatch(/<->|&lt;-&gt;/);
    const v = evaluateSession(packCheckAdapter, FIXTURES[0]!, emptySession(), 1);
    expect(exportText(v)).not.toContain('<->');
    expect(exportCsv(v)).not.toContain('<->');
  });
});
