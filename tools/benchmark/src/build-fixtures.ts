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
type FixtureSpec = { id: string; out: string; title: string; description: string; docs: Spec[] };

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
  { sample: 'packcheck', doc: 'budget', role: 'budget', title: 'Project budget summary', file: find('live-packcheck-budget-v2-2026') },
  { sample: 'packcheck', doc: 'registration', role: 'registration', title: 'Certificate of registration', file: find('live-packcheck-registration-v2-2026') },
];

/**
 * Documented edits to recorded claims, applied when a sample's TEXT was changed after the recording (the recorded model output
 * quotes the old text). Each edit is a literal replacement in claim excerpts only, listed in the fixture so it is visible, and
 * checked by tools/benchmark/test/fixtures.test.ts. The values the model returned are never edited.
 */
export const CLAIM_EDITS: Record<string, { doc: string; from: string; to: string; reason: string }[]> = {
  'packcheck-pack': [
    {
      doc: 'budget',
      from: '28/02/2027',
      to: '28 February 2027',
      reason:
        'The budget end date is written with a month name since 2026-11-02 so that the planted ambiguity (01/03/2026) stays ambiguous under the date-order rule: a date that can only be read one way (28/02/2027) would otherwise prove day-first order. The recorded claims quoted the old line; their excerpts are updated to the new text, their values are unchanged.',
    },
  ],
};

/** Applies the documented excerpt edits to recorded claims (values untouched). */
export function applyClaimEdits(fixtureId: string, docId: string, claims: unknown[]): unknown[] {
  const edits = (CLAIM_EDITS[fixtureId] ?? []).filter((e) => e.doc === docId);
  if (edits.length === 0) return claims;
  return claims.map((c) => {
    const x = c as { excerpt?: unknown };
    if (typeof x.excerpt !== 'string') return c;
    let excerpt = x.excerpt;
    for (const e of edits) excerpt = excerpt.split(e.from).join(e.to);
    return { ...x, excerpt };
  });
}

const FIXTURES: FixtureSpec[] = [
  { id: 'scopecheck-standard', out: 'scopecheck-standard.json', title: 'RFQ and two quotations', description: 'One RFQ and two quotations with a quantity difference, a specification difference, an exclusion and an item missing from a quotation. All names, items and prices are invented.', docs: SCOPE_STANDARD },
  { id: 'scopecheck-layout', out: 'scopecheck-layout.json', title: 'RFQ and a free-text quotation', description: 'The same RFQ against a quotation written as free text (no table columns), including a line whose item identity is genuinely uncertain, and a specification the extraction missed. All names, items and prices are invented.', docs: SCOPE_LAYOUT },
  { id: 'packcheck-pack', out: 'packcheck-pack.json', title: 'Grant application pack', description: 'A four-document grant pack with a missing attachment, an organisation-name inconsistency, an ambiguous date, and a funding request (R1.6 million) that is correctly below the budget (R2 million). All names and amounts are invented.', docs: PACK },
];

if (process.argv[1]?.endsWith('build-fixtures.ts')) for (const f of FIXTURES) {
  const docs = [];
  for (const s of f.docs) {
    const sample = loadSample(s.sample);
    const doc = sample.docs.find((d) => d.id === s.doc)!;
    // Fixture blocks keep the 'ingest/1' shape (id, text, page, bbox): the layout metadata of the current parser is dropped, as
    // tools/benchmark/test/fixtures.test.ts compares, so rebuilding reproduces the committed fixtures byte for byte.
    const blocks = (await loadBlocks(s.sample, doc)).map((b) => { const rest: Record<string, unknown> = { ...b }; delete rest.parser; delete rest.layout; delete rest.cells; return rest; });
    const result = JSON.parse(readFileSync(join(RESULTS, s.file), 'utf8')) as BenchmarkResult;
    const d = result.samples.flatMap((x) => x.docs).find((x) => x.docId === s.doc)!;
    docs.push({
      id: s.doc,
      role: s.role,
      title: s.title,
      profile: d.profile?.id ?? doc.schemaId,
      recordedIn: `samples/benchmark-results/${s.file}`,
      blocks,
      claims: applyClaimEdits(f.id, s.doc, d.claimsReturned),
      ...((CLAIM_EDITS[f.id] ?? []).some((e) => e.doc === s.doc) ? { claimEdits: (CLAIM_EDITS[f.id] ?? []).filter((e) => e.doc === s.doc).map(({ from, to, reason }) => ({ from, to, reason })) } : {}),
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
      note: 'The claims are recorded model output for these fictional documents (selected benchmark configuration). Validation, matching, rules, review and export run in your browser on this input. No document is uploaded and no model is called.',
    },
    docs,
  };
  writeFileSync(join(SAMPLES_DIR, 'fixtures', f.out), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`${f.out}: ${docs.length} documents, ${docs.reduce((n, d) => n + d.claims.length, 0)} recorded claims`);
}
