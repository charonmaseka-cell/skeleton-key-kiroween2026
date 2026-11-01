import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { groupLines, parsePdf, UnsupportedPdfError } from '../src';

const SAMPLES = new URL('../../../samples/', import.meta.url).pathname;
const manifest = (id: string) => JSON.parse(readFileSync(`${SAMPLES}${id}/sample.json`, 'utf8')) as { docs: { id: string; file: string; lines: string[]; facts: { line: number; excerpt: string }[] }[] };

describe('PDF ingestion (text PDFs)', () => {
  for (const sample of ['scopecheck', 'packcheck']) {
    it(`${sample}: every sample PDF parses to its manifest lines with page numbers and coordinates`, async () => {
      for (const doc of manifest(sample).docs) {
        const blocks = await parsePdf(readFileSync(`${SAMPLES}${sample}/${doc.file}`), doc.id);
        expect(blocks.map((b) => b.text)).toEqual(doc.lines);
        for (const b of blocks) {
          expect(b).toMatchObject({ docId: doc.id, kind: 'pdf-run', page: 1 });
          expect(b.bbox).toHaveLength(4);
        }
        expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
      }
    });

    it(`${sample}: labelled excerpts are substrings of their source lines`, () => {
      for (const doc of manifest(sample).docs) for (const f of doc.facts) expect(doc.lines[f.line]).toContain(f.excerpt);
    });
  }

  it('rejects a PDF without a text layer instead of guessing', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]); // blank page: stands in for a scan
    await expect(parsePdf(await pdf.save(), 'scan')).rejects.toMatchObject({ reason: 'scanned_or_empty' });
  });

  it('rejects unreadable bytes', async () => {
    await expect(parsePdf(new TextEncoder().encode('not a pdf'), 'x')).rejects.toBeInstanceOf(UnsupportedPdfError);
  });

  it('groups items on the same baseline into one line, left to right, top to bottom', () => {
    const lines = groupLines([
      { str: 'world', x: 60, y: 100, w: 30, h: 10 },
      { str: 'hello', x: 10, y: 100.5, w: 40, h: 10 },
      { str: 'next', x: 10, y: 80, w: 20, h: 10 },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['hello world', 'next']);
  });
});
