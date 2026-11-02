import type { Block } from '@skeleton-key/engine';
// Node build of PDF.js (tests, benchmark). The browser entry is `@skeleton-key/ingest/browser`.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parsePdfWith } from './core';

export { groupLines, parsePdfWith, UnsupportedPdfError } from './core';

export const parsePdf = (data: Uint8Array, docId: string): Promise<Block[]> => parsePdfWith(getDocument, data, docId);
export { PARSER_VERSION, LEGACY_PARSER_VERSION, groupRows } from './core';
export { detectCells, MIN_ROWS } from './cells';
