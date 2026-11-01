import type { Block } from '@skeleton-key/engine';
import type { getDocument as GetDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Text-based PDFs only. Blocks are reflowed extracted text lines: they are
// display/evidence units, not the document's original lines (R4.7).

export class UnsupportedPdfError extends Error {
  constructor(public readonly reason: 'scanned_or_empty' | 'unreadable') {
    super(`unsupported_pdf:${reason}`);
  }
}

type RawItem = { str: string; x: number; y: number; w: number; h: number };

/** Group positioned text items into lines (same baseline), left to right, top to bottom. */
export function groupLines(items: RawItem[]): { text: string; bbox: [number, number, number, number] }[] {
  const rows: RawItem[][] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0]!.y - it.y) <= 2);
    if (row) row.push(it);
    else rows.push([it]);
  }
  return rows
    .map((r) => {
      const sorted = r.sort((a, b) => a.x - b.x);
      const text = sorted.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      const minX = Math.min(...sorted.map((i) => i.x));
      const maxX = Math.max(...sorted.map((i) => i.x + i.w));
      const minY = Math.min(...sorted.map((i) => i.y));
      return { text, bbox: [minX, minY, maxX - minX, Math.max(...sorted.map((i) => i.h))] as [number, number, number, number] };
    })
    .filter((l) => l.text.length > 0);
}

/** Parse with any PDF.js loader (the Node build or the browser build); the logic is identical. */
export async function parsePdfWith(getDocument: typeof GetDocument, data: Uint8Array, docId: string): Promise<Block[]> {
  const task = getDocument({ data: new Uint8Array(data), useSystemFonts: true, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch {
    throw new UnsupportedPdfError('unreadable');
  }
  const blocks: Block[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: RawItem[] = [];
      for (const it of content.items) {
        if ('str' in it && it.str.trim().length > 0) {
          items.push({ str: it.str, x: it.transform[4]!, y: it.transform[5]!, w: it.width, h: it.height });
        }
      }
      // A page with no text layer is treated as a scan: never guessed at, never OCR'd here.
      if (items.length === 0) throw new UnsupportedPdfError('scanned_or_empty');
      groupLines(items).forEach((line, i) => {
        blocks.push({ id: `p${p}-l${i + 1}`, docId, kind: 'pdf-run', text: line.text, page: p, bbox: line.bbox });
      });
    }
  } finally {
    await task.destroy();
  }
  return blocks;
}
