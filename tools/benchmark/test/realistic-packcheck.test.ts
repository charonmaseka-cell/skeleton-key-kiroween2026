import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isEvidenceIntact, validateClaims } from '@skeleton-key/engine';
import { parsePdf } from '@skeleton-key/ingest';
import { SqliteAdmission } from '../src/admission';
import { oracleAi } from '../src/ai';
import { DEFAULT_MAX_VALUES, buildFrozenPlan, documentHash, outputChunker, type FrozenPlan } from '../src/chunking';
import { SAMPLE_ID, buildRealisticPackCheck, renderPdf } from '../src/realistic-packcheck';
import { runBenchmark } from '../src/run';
import { HINTS, loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';

// PC-T1 offline checks (no model): the pre-registered pack is what the generator writes, the labels point at real text, and
// the pre-registered findings follow from the rules on ideal extraction, including a failed chunk that must not confirm an absence.

const DIR = join(__dirname, '../../../samples', SAMPLE_ID);
const params = { maxChars: 24_000, maxBlocks: 400, maxValues: DEFAULT_MAX_VALUES, overlap: 0, headingContext: true };
const parse = (id: string) => parsePdf(new Uint8Array(readFileSync(join(DIR, `${id}.pdf`))), id);

describe('the committed pack is what the generator writes', () => {
  it('sample.json and every PDF are reproduced exactly', async () => {
    const sample = buildRealisticPackCheck();
    expect(JSON.parse(readFileSync(join(DIR, 'sample.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(sample)));
    for (const d of sample.docs) expect(Buffer.from(await renderPdf(d)).equals(readFileSync(join(DIR, d.file)))).toBe(true);
  });

  it('parsed lines equal the labelled lines, and every labelled excerpt validates as a claim with intact evidence', async () => {
    for (const d of loadSample(SAMPLE_ID).docs) {
      const blocks = await parse(d.id);
      expect(blocks.map((b) => b.text)).toEqual(d.lines);
      const facts = validateClaims(d.facts.map((f) => ({ field: f.field, kind: f.kind, blockId: blocks[f.line]!.id, excerpt: f.excerpt, value: f.value })), { docId: d.id, blocks, hintsByField: HINTS });
      const byId = new Map(blocks.map((b) => [b.id, b]));
      for (const [i, f] of facts.entries()) {
        const want = d.facts[i]!;
        expect(f.status, `${d.id} ${f.field} ${f.reason ?? ''}`).toBe(want.expectStatus === 'needs_review' ? 'needs_review' : 'validated');
        expect(f.evidence.every((e) => isEvidenceIntact(e, byId))).toBe(true);
      }
    }
  });
});

describe('pre-registered findings follow from the rules on ideal extraction (consistency check, not a model result)', () => {
  async function run(failChunkWhen?: (b: { id: string; text: string }[]) => boolean) {
    const counter = new SqliteAdmission(':memory:');
    const transport = new LocalTransport({ ai: oracleAi([loadSample(SAMPLE_ID)], { failChunkWhen }), counter, env: { DAILY_ADMISSION_CEILING: '1000', MAX_REPAIR_ATTEMPTS: '0', INFERENCE_TIMEOUT_MS: '5000' } });
    const r = await runBenchmark({ mode: 'mock', model: 'mock', label: 't', transport, sampleIds: [SAMPLE_ID], limits: params, chunker: outputChunker(params), attemptBudget: 1000 });
    counter.close();
    return r;
  }

  it('all 7 expected exactly; singular for plural stays Needs review (a suggested match is not a verified one)', async () => {
    const s = (await run()).samples[0]!;
    expect(s.findings.score).toMatchObject({ expected: 7, matchedExactState: 7, missed: [], falseCritical: [], overConfident: [], unexpectedOther: [] });
    const letters = s.findings.produced.find((f) => f.subject === 'letters of support')!;
    expect(letters).toMatchObject({ code: 'attachment.missing', state: 'needs_review', reason: 'match_unresolved' });
  });

  it('the legal-form name difference is Needs review, the funding and end-date differences are confirmed, the ambiguous start date is held', async () => {
    const f = (await run()).samples[0]!.findings.produced;
    expect(f.find((x) => x.code === 'org.name_differs')).toMatchObject({ state: 'needs_review', reason: 'legal_form_differs' });
    expect(f.find((x) => x.code === 'funding.differs')).toMatchObject({ state: 'confirmed' });
    expect(f.find((x) => x.code === 'date.differs')).toMatchObject({ subject: 'project_end_date', state: 'confirmed' });
    expect(f.find((x) => x.code === 'value.needs_review')).toMatchObject({ subject: 'budget:project_start_date', state: 'needs_review' });
    expect(f.some((x) => x.code === 'funding.exceeds_budget')).toBe(false); // R 2 450 000 is below the R 3 150 000 total
  });

  it('a failed chunk of the application form makes it incomplete and no attachment is confirmed missing', async () => {
    const r = await run((b) => b.some((x) => x.text.startsWith('Attachment provided:')));
    const form = r.samples[0]!.docs.find((d) => d.docId === 'application-form')!;
    expect(form.processingComplete).toBe(false);
    expect(r.samples[0]!.findings.produced.filter((f) => f.code === 'attachment.missing').every((f) => f.state === 'needs_review')).toBe(true);
  });
});

describe('chunking is from text and schema only (frozen plan)', () => {
  const plan = () => JSON.parse(readFileSync(join(DIR, 'chunk-plan.json'), 'utf8')) as FrozenPlan;

  it('the plan regenerates identically, and does not move when the labels are removed or scrambled', async () => {
    const ref = await buildFrozenPlan(SAMPLE_ID, params);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(plan());
    const scrambled = loadSample(SAMPLE_ID);
    for (const d of scrambled.docs) d.facts = d.facts.map((f) => ({ ...f, line: 0, excerpt: 'x' }));
    scrambled.expectedFindings = [];
    expect((await buildFrozenPlan(SAMPLE_ID, params, {}, scrambled)).docs).toEqual(ref.docs);
  });

  it('accounts for every block; 6 requests in total; none over the value budget', async () => {
    const p = plan();
    expect(p.docs.reduce((n, d) => n + d.chunks.length, 0)).toBe(6);
    for (const d of p.docs) {
      const blocks = await parse(d.docId);
      expect(d.documentHash).toBe(documentHash(blocks));
      expect(d.chunks.flatMap((c) => c.blockIds).sort()).toEqual(blocks.map((b) => b.id).sort());
      expect(d.chunks.every((c) => !c.overBudget && c.estimatedValues <= DEFAULT_MAX_VALUES)).toBe(true);
    }
  });
});
