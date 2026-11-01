// Writes the fictional sample PDFs from the manifests. Deterministic: fixed dates, no randomness.
// Run: npx tsx tools/benchmark/src/generate-samples.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { LINES_PER_PAGE } from './realistic-scopecheck';
import { loadSample, SAMPLES_DIR } from './samples';

for (const id of ['scopecheck', 'packcheck', 'scopecheck-layout', 'scopecheck-realistic']) {
  const sample = loadSample(id);
  mkdirSync(join(SAMPLES_DIR, id), { recursive: true });
  for (const doc of sample.docs) {
    if (doc.file.startsWith('../')) continue; // referenced from another sample, not generated here
    const pdf = await PDFDocument.create();
    pdf.setCreationDate(new Date(0));
    pdf.setModificationDate(new Date(0));
    pdf.setProducer('skeleton-key sample generator');
    pdf.setTitle(`${doc.id} (fictional sample)`);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    // Multi-page: a new page every LINES_PER_PAGE lines (ingestion names blocks p{page}-l{line}).
    let page = pdf.addPage([595, 842]);
    let y = 780;
    let onPage = 0;
    for (const line of doc.lines) {
      if (onPage === LINES_PER_PAGE) {
        page = pdf.addPage([595, 842]);
        y = 780;
        onPage = 0;
      }
      page.drawText(line, { x: 50, y, size: 10, font });
      y -= 22;
      onPage++;
    }
    writeFileSync(join(SAMPLES_DIR, id, doc.file), await pdf.save({ useObjectStreams: false }));
  }
}
console.log('sample PDFs written');
