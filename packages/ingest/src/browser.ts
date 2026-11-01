// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient declarations for the bundler-only ?url import and the browser PDF.js build
/// <reference path="./vite-url.d.ts" />
import type { Block } from '@skeleton-key/engine';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parsePdfWith } from './core';

// Browser entry: parses a PDF the user selected, on the user's device. The file is never uploaded;
// only text extracted from it can later be sent (after an explicit Analyse step).

export { UnsupportedPdfError } from './core';

let ready = false;
export function parsePdfInBrowser(data: Uint8Array, docId: string): Promise<Block[]> {
  if (!ready) {
    GlobalWorkerOptions.workerSrc = workerUrl;
    ready = true;
  }
  return parsePdfWith(getDocument as never, data, docId);
}
