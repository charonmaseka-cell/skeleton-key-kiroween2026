// Builds the app fixtures from the labelled fictional samples:
//   source text blocks (parsed from the sample PDFs by the real ingestion code)
// + the model's recorded claims for the selected configuration (saved benchmark responses).
// The apps run validation, matching and rules on these inputs in the browser. They do NOT display
// saved reports or findings. Deterministic: same inputs, same bytes.
//
//   npx tsx tools/benchmark/src/build-fixtures.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchmarkResult } from './run';
import { loadBlocks, loadSample, SAMPLES_DIR } from './samples';
import { BASELINE_MODEL } from './candidates';

const RESULTS = join(SAMPLES_DIR, 'benchmark-results');
const find = (prefix: string) => {
  const hits = readdirSync(RESULTS).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  if (hits.length !== 1) throw new Error(`expected one result file for ${prefix}, found ${hits.length}`);
  return hits[0]!;
};

type Spec = { sample: string; doc: string; role: string; title: string; file: string };
/**
 * `layout: true` keeps the current parser's full blocks (layout and validated cells), which the identity step uses; it is set for
 * fixtures recorded with that parser ('ingest/2-cells'). `chunkPlan` gives the frozen chunk plan the recording was sent with, so
 * the fixture records every chunk and its status.
 */
type FixtureSpec = { id: string; out: string; title: string; description: string; docs: Spec[]; layout?: boolean; chunkPlan?: string; note?: string };

const SCOPE_STANDARD: Spec[] = [
  { sample: 'scopecheck', doc: 'rfq', role: 'rfq', title: 'RFQ-0001 Request for Quotation', file: find('live-repeat-rfq-2026') },
  { sample: 'scopecheck', doc: 'quote-a', role: 'quote', title: 'Quotation QA-17, Alder Pump Supplies', file: find('live-repeat-quote-a-2026') },
  { sample: 'scopecheck', doc: 'quote-b', role: 'quote', title: 'Quotation QB-04, Birch Industrial Trading', file: find('live-quote-b-2026') },
];
const SCOPE_LAYOUT: Spec[] = [
  { sample: 'scopecheck-layout', doc: 'rfq', role: 'rfq', title: 'RFQ-0001 Request for Quotation', file: find('live-repeat-rfq-2026') },
  { sample: 'scopecheck-layout', doc: 'quote-c', role: 'quote', title: 'Quotation QC-31, Cedar Flow Components (free-text layout)', file: find('live-layout-quote-c-2026') },
];
const PACK: Spec[] = [
  { sample: 'packcheck', doc: 'requirements', role: 'requirements', title: 'Grant call GC-2026 application requirements', file: find('live-packcheck-requirements-v2-2026') },
  { sample: 'packcheck', doc: 'application-form', role: 'application-form', title: 'Application form for grant GC-2026', file: find('live-packcheck-application-form-v2-2026') },
  { sample: 'packcheck', doc: 'budget', role: 'budget', title: 'Project budget summary', file: find('live-packcheck-budget-v2-staging-worker-2026') },
  { sample: 'packcheck', doc: 'registration', role: 'registration', title: 'Certificate of registration', file: find('live-packcheck-registration-v2-2026') },
];

const FRESH_RESULT = find('live-sc-t12-fresh-resume2-2026');
const SCOPE_FULL: Spec[] = [
  { sample: 'scopecheck-fresh', doc: 'rfq', role: 'rfq', title: 'Tender TN-7731, Ridgeback Catchment Authority', file: FRESH_RESULT },
  { sample: 'scopecheck-fresh', doc: 'quote-a', role: 'quote', title: 'Quotation 2207-HL, Hydro-Lab Supplies', file: FRESH_RESULT },
  { sample: 'scopecheck-fresh', doc: 'quote-b', role: 'quote', title: 'Offer DF/0098, Delta Field Instruments (prose)', file: FRESH_RESULT },
];

const FIXTURES: FixtureSpec[] = [
  {
    id: 'scopecheck-full',
    out: 'scopecheck-full.json',
    title: 'Full-length tender and two quotations',
    description:
      'A 42-line tender with 15 required items, a quotation in positioned columns and a quotation written as prose, each sent in 4 parts. Recorded output of the selected model on these fictional documents (validation batch SC-T12, 1 November 2026): 12 of 12 pre-registered findings, no false critical findings. Some extraction faults are kept as recorded (item values without their code, a wrong quantity, missed and held prices).',
    docs: SCOPE_FULL,
    layout: true,
    chunkPlan: 'scopecheck-fresh/chunk-plan.json',
    note: 'The claims are recorded output of @cf/meta/llama-3.3-70b-instruct-fp8-fast for these fictional documents (batch SC-T12, 1 November 2026; one part of the tender was recovered from the raw response log, not sent twice). Validation, matching, rules, review and export run in your browser on this input. No document is uploaded and no model is called.',
  },
  { id: 'scopecheck-standard', out: 'scopecheck-standard.json', title: 'RFQ and two quotations', description: 'One RFQ and two quotations with a quantity difference, a specification difference, an exclusion and an item missing from a quotation. All names, items and prices are invented.', docs: SCOPE_STANDARD },
  { id: 'scopecheck-layout', out: 'scopecheck-layout.json', title: 'RFQ and a free-text quotation', description: 'The same RFQ against a quotation written as free text (no table columns), including a line whose item identity is genuinely uncertain, and a specification the extraction missed. All names, items and prices are invented.', docs: SCOPE_LAYOUT },
  { id: 'packcheck-pack', out: 'packcheck-pack.json', title: 'Grant application pack', description: 'A four-document grant pack with a missing attachment, an organisation-name inconsistency, an ambiguous date, and a funding request (R1.6 million) that is correctly below the budget (R2 million). All names and amounts are invented.', docs: PACK },
];

/** Every chunk of the frozen plan, with the status the recording reports (all ok when the document was processed completely). */
function chunksFromPlan(planFile: string, docId: string, d: { processingComplete?: boolean; chunks?: unknown }) {
  const plan = JSON.parse(readFileSync(join(SAMPLES_DIR, planFile), 'utf8')) as { docs: { docId: string; chunks: { blockIds: string[] }[] }[] };
  const chunks = plan.docs.find((x) => x.docId === docId)!.chunks;
  if (d.processingComplete !== true) throw new Error(`${docId}: the recording is not complete; per-chunk statuses are needed`);
  if (typeof d.chunks === 'number' && d.chunks !== chunks.length) throw new Error(`${docId}: plan has ${chunks.length} chunks, recording ${d.chunks}`);
  return chunks.map((c) => ({ blockIds: c.blockIds, status: 'ok' as const }));
}

if (process.argv[1]?.endsWith('build-fixtures.ts')) for (const f of FIXTURES) {
  const docs = [];
  for (const s of f.docs) {
    const sample = loadSample(s.sample);
    const doc = sample.docs.find((d) => d.id === s.doc)!;
    // Fixture blocks keep the 'ingest/1' shape (id, text, page, bbox): the layout metadata of the current parser is dropped, as
    // tools/benchmark/test/fixtures.test.ts compares, so rebuilding reproduces the committed fixtures byte for byte.
    const parsed = await loadBlocks(s.sample, doc);
    const blocks = f.layout ? parsed : parsed.map((b) => { const rest: Record<string, unknown> = { ...b }; delete rest.parser; delete rest.layout; delete rest.cells; return rest; });
    const result = JSON.parse(readFileSync(join(RESULTS, s.file), 'utf8')) as BenchmarkResult;
    const d = result.samples.flatMap((x) => x.docs).find((x) => x.docId === s.doc)!;
    docs.push({
      id: s.doc,
      role: s.role,
      title: s.title,
      profile: d.profile?.id ?? doc.schemaId,
      recordedIn: `samples/benchmark-results/${s.file}`,
      blocks,
      claims: d.claimsReturned,
      ...(f.chunkPlan ? { chunks: chunksFromPlan(f.chunkPlan, s.doc, d) } : {}),
    });
  }
  const fixture = {
    id: f.id,
    title: f.title,
    description: f.description,
    sample: true,
    label: 'Sample (fictional)',
    extraction: {
      model: BASELINE_MODEL,
      note: f.note ?? 'The claims are recorded model output for these fictional documents (selected benchmark configuration). Validation, matching, rules, review and export run in your browser on this input. No document is uploaded and no model is called.',
    },
    docs,
  };
  writeFileSync(join(SAMPLES_DIR, 'fixtures', f.out), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`${f.out}: ${docs.length} documents, ${docs.reduce((n, d) => n + d.claims.length, 0)} recorded claims`);
}
