import { describe, expect, it } from 'vitest';
import { liveDocTitle } from '../src/session-core';

// Item 3: a live document is named by its own validated heading when it has one, and always keeps the file name as secondary text.
describe('liveDocTitle', () => {
  it('uses a short title-like first line of page 1 as the heading, with the file name as the note', () => {
    const r = liveDocTitle([{ text: 'Project budget summary', page: 1 }, { text: 'Total: R 1 000 000', page: 1 }], 'budget.pdf');
    expect(r).toEqual({ title: 'Project budget summary', note: 'budget.pdf' });
  });

  it('falls back to the file name when the first line is a data row (label: value) or a delimited table', () => {
    expect(liveDocTitle([{ text: 'Organisation: Acme Trust', page: 1 }], 'form.pdf')).toEqual({ title: 'form.pdf', note: 'form.pdf' });
    expect(liveDocTitle([{ text: 'Item | qty | price', page: 1 }], 'quote.pdf')).toEqual({ title: 'quote.pdf', note: 'quote.pdf' });
  });

  it('falls back to the file name when the first line is only a code or a number, too long, or absent', () => {
    expect(liveDocTitle([{ text: 'CP-100', page: 1 }], 'a.pdf')).toEqual({ title: 'a.pdf', note: 'a.pdf' });
    expect(liveDocTitle([{ text: 'x'.repeat(120), page: 1 }], 'b.pdf')).toEqual({ title: 'b.pdf', note: 'b.pdf' });
    expect(liveDocTitle([], 'c.pdf')).toEqual({ title: 'c.pdf', note: 'c.pdf' });
  });

  it('ignores blocks that are not on page 1', () => {
    expect(liveDocTitle([{ text: 'A real heading here', page: 2 }], 'd.pdf')).toEqual({ title: 'd.pdf', note: 'd.pdf' });
  });

  it('does not repeat the file name as a title when the first line is just the file name', () => {
    expect(liveDocTitle([{ text: 'budget.pdf', page: 1 }], 'budget.pdf')).toEqual({ title: 'budget.pdf', note: 'budget.pdf' });
  });
});
