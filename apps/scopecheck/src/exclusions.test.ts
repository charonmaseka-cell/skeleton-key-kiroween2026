import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePdf } from '@skeleton-key/ingest';
import { buildLiveFixture, emptySession, evaluateSession, exportCsv, exportText, type DocumentResult } from '@skeleton-key/ui';
import { scopeCheckAdapter } from './adapter';

// The independently reproduced collision: quotation B states two exclusions (VAT in its heading, freight in its terms).
// Both must survive the rules, the review queue and the exports. Saved live responses and the real sample PDFs are used;
// nothing is sent anywhere.

const RESULTS = new URL('../../../samples/benchmark-results/', import.meta.url);
const baseline = JSON.parse(readFileSync(new URL(readdirSync(RESULTS).find((f) => f.startsWith('live-sc-t4-quote-b-'))!, RESULTS), 'utf8')) as { samples: { docs: { docId: string; claimsReturned: unknown[] }[] }[] };

async function fixtureFor(docIds: string[], mutate: (docId: string, claims: { field?: string; blockId?: string }[]) => unknown[] = (_d, c) => c) {
  const docs = [];
  for (const id of docIds) {
    const blocks = await parsePdf(new Uint8Array(readFileSync(new URL(`../../../samples/scopecheck-realistic/${id}.pdf`, import.meta.url))), id);
    const claims = mutate(id, baseline.samples[0]!.docs.find((d) => d.docId === id)!.claimsReturned as { field?: string; blockId?: string }[]);
    const result: DocumentResult = { docId: id, blocks, claims, chunks: [{ index: 0, blockIds: blocks.map((b) => b.id), status: 'ok', claims: claims.length }] };
    docs.push({ id, role: id === 'rfq' ? 'rfq' : 'quote', fileName: `${id}.pdf`, profile: id === 'rfq' ? 'scopecheck.rfq.v1' : 'scopecheck.quote.v1', result });
  }
  return buildLiveFixture(docs);
}
const run = (fx: Awaited<ReturnType<typeof fixtureFor>>) => evaluateSession(scopeCheckAdapter, fx, emptySession(), 1);

describe('two exclusions in one quotation', () => {
  it('are two findings, each citing its own line', async () => {
    const v = run(await fixtureFor(['rfq', 'quote-b']));
    const ex = v.items.filter((i) => i.finding.code === 'exclusion.stated' && i.finding.responseDocId === 'quote-b');
    expect(ex.map((i) => i.finding.subjectId).sort()).toEqual(['quote-b:p1-l2:exclusion', 'quote-b:p2-l10:exclusion']);
    for (const i of ex) expect(i.finding.evidence.map((e) => e.evidence.blockId)).toEqual([i.finding.subjectId.split(':')[1]]);
    expect(ex.find((i) => i.finding.subjectId.includes('p2-l10'))!.finding.evidence[0]!.evidence.text).toMatch(/Freight to site/);
    expect(ex.find((i) => i.finding.subjectId.includes('p1-l2'))!.finding.evidence[0]!.evidence.text).toMatch(/VAT/);
  });

  it('both reach the review queue and both exports (text and CSV)', async () => {
    const v = run(await fixtureFor(['rfq', 'quote-b']));
    const text = exportText(v);
    const csv = exportCsv(v);
    for (const out of [text, csv]) {
      expect(out).toMatch(/Prices exclude VAT/);
      expect(out).toMatch(/Freight to site is excluded/);
    }
  });

  it('removing the VAT claim leaves freight; removing the freight claim leaves VAT: neither stands in for the other', async () => {
    const only = async (keepBlock: string) => {
      const v = run(await fixtureFor(['rfq', 'quote-b'], (d, claims) => claims.filter((c) => !(d === 'quote-b' && c.field === 'exclusion' && c.blockId !== keepBlock))));
      return v.items.filter((i) => i.finding.code === 'exclusion.stated').map((i) => i.finding.subjectId);
    };
    expect(await only('p2-l10')).toEqual(['quote-b:p2-l10:exclusion']);
    expect(await only('p1-l2')).toEqual(['quote-b:p1-l2:exclusion']);
  });
});
