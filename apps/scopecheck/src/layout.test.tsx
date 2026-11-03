// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

// Page layout: the sample results come first; "Analyse your own documents" is a collapsed section below them, with the
// privacy statement and the limits inside it. Every table sits in its own horizontal scroll container.

afterEach(cleanup);
const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('layout', () => {
  it('the sample results come before the upload section, which is collapsed and holds the privacy and limits text', () => {
    render(<App baseUrl="https://worker.example" />);
    const upload = document.getElementById('upload')!;
    expect(upload.tagName).toBe('DETAILS');
    expect((upload as HTMLDetailsElement).open).toBe(false);
    for (const id of ['confirmed-h', 'ne-h', 'docs-h', 'exp-h']) expect(before(document.getElementById(id)!, upload), id).toBe(true);
    expect(upload.querySelector('summary')!.textContent).toMatch(/Analyse your own documents/);
    const limits = screen.getByTestId('live-limits');
    expect(upload.contains(limits)).toBe(true);
    expect(upload.textContent).toMatch(/What leaves your device\./);
    expect(upload.textContent).toMatch(/sample sets above/);
    // nothing of the upload section is above the results
    expect(document.querySelectorAll('#main > *')[document.querySelectorAll('#main > *').length - 1]).toBe(upload);
    // the in-page link to it is the last navigation entry, and following it opens the section
    const links = [...document.querySelectorAll('nav a')];
    expect(links.at(-1)!.getAttribute('href')).toBe('#upload');
    window.location.hash = '#upload';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect((upload as HTMLDetailsElement).open).toBe(true);
    window.location.hash = '';
  });

  it('every table is inside its own focusable, named horizontal scroll container', () => {
    render(<App />);
    const tables = [...document.querySelectorAll('table')];
    expect(tables.length).toBeGreaterThan(0);
    const wrappers = tables.map((t) => t.closest('[data-scroll-table]') as HTMLElement | null);
    expect(wrappers.every((w) => !!w)).toBe(true);
    expect(new Set(wrappers).size).toBe(tables.length); // one container per table
    for (const w of wrappers) {
      expect(w!.className).toMatch(/overflow-x-auto/);
      expect(w!.getAttribute('role')).toBe('region');
      expect(w!.getAttribute('tabindex')).toBe('0');
      expect(w!.getAttribute('aria-label')).toMatch(/scroll sideways/);
      expect(w!.querySelectorAll('table').length).toBe(1);
    }
  });
});
