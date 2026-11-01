// FRESH-DOCUMENT validation set for ScopeCheck (SC-T12): a new fictional tender and two quotations, written after the rules,
// the parser and the chunker were fixed, with different wording and layout from samples/scopecheck-realistic. Expected outputs
// are PRE-REGISTERED: this file and samples/scopecheck-fresh/ are committed BEFORE any model sees these documents.
//
//   - tender (rfq):   a genuinely POSITIONED table (a Ref column, a description column that wraps onto a second line in two
//                     rows, a quantity column and a requirement column), drawn as separate text items at fixed x positions.
//   - quote-a:        a positioned table with a price and a notes column, one wrapped description, one row whose description
//                     names a standard (ISO-17034) next to its own reference, and a prose exclusion.
//   - quote-b:        prose only: one sentence per item, two templates, two exclusions on separate lines.
//
// Labels and expected findings follow from the seeded differences below. They are used only to SCORE; they are never read by
// extraction, chunking or matching (a test scrambles them and checks the chunk plan does not move).
//
//   npx tsx tools/benchmark/src/fresh-scopecheck.ts      writes samples/scopecheck-fresh/{sample.json,*.pdf}
//
// Every company, item and price is invented.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { SAMPLES_DIR, type ExpectedFact, type ExpectedFinding, type Sample, type SampleDoc } from './samples';

export const SAMPLE_ID = 'scopecheck-fresh';
/** Rows (lines of text) per page. Block ids are p{page}-l{line}. */
export const PAGE_ROWS = 34;
const ROW_STEP = 20;
const FONT = 9;

export const blockIdOf = (row: number) => `p${Math.floor(row / PAGE_ROWS) + 1}-l${(row % PAGE_ROWS) + 1}`;

type Cell = { x: number; text: string };
type Row = { cells: Cell[]; facts: ExpectedFact[] };
const prose = (text: string): Row => ({ cells: [{ x: 50, text }], facts: [] });
const textOf = (r: Row) => r.cells.map((c) => c.text).join(' ');

type Item = { code: string; desc: string[]; qty: number; unit: string; spec: string; price: number };
const ITEMS: Item[] = [
  { code: 'LB-3101', desc: ['Digital pH meter'], qty: 6, unit: 'each', spec: '0.01 pH resolution', price: 3450 },
  { code: 'LB-3102', desc: ['Turbidity meter'], qty: 4, unit: 'each', spec: '0-1000 NTU, battery powered', price: 6900 },
  { code: 'LB-3110', desc: ['Magnetic stirrer'], qty: 8, unit: 'each', spec: 'hotplate, up to 300 C', price: 2150 },
  { code: 'LB-3115', desc: ['Analytical balance with', 'draught shield'], qty: 2, unit: 'each', spec: '220 g, 0.1 mg readability', price: 24800 },
  { code: 'FD-4201', desc: ['Water level logger'], qty: 20, unit: 'each', spec: '10 m range, vented cable', price: 4300 },
  { code: 'FD-4202', desc: ['Flow velocity probe'], qty: 5, unit: 'each', spec: '0.1-5 m/s, IP68', price: 18200 },
  { code: 'FD-4210', desc: ['Rain gauge'], qty: 12, unit: 'each', spec: 'tipping bucket, 0.2 mm', price: 1950 },
  { code: 'FD-4215', desc: ['Soil moisture sensor with', 'datalogger interface'], qty: 30, unit: 'each', spec: 'capacitance type, 3 m cable', price: 1250 },
  { code: 'SP-5301', desc: ['Sample bottle 500 ml'], qty: 400, unit: 'each', spec: 'HDPE, wide neck', price: 18 },
  { code: 'SP-5302', desc: ['Sample bottle 1 l'], qty: 200, unit: 'each', spec: 'amber glass', price: 42 },
  { code: 'SP-5310', desc: ['Cool box 45 l'], qty: 10, unit: 'each', spec: 'insulated, 48 hour hold', price: 890 },
  { code: 'CL-6401', desc: ['Calibration standard set'], qty: 15, unit: 'sets', spec: 'pH 4, 7 and 10, 250 ml', price: 640 },
];

// ---- seeded differences: these ARE the expected outputs ----
/** quotation A (positioned table) */
export const A_QTY: Record<string, number> = { 'LB-3110': 6 };
export const A_SPEC: Record<string, string> = { 'LB-3115': '220 g, 1 mg readability', 'FD-4202': '0.1-5 m/s, IP65', 'LB-3101': 'c/w 0.01 pH resolution' /* a connector, NOT a difference */ };
export const A_ABSENT = ['FD-4215'];
export const A_UNCERTAIN = 'CL-6401'; // its description names a standard, ISO-17034, next to its own reference
/** quotation B (prose) */
export const B_QTY: Record<string, number> = { 'LB-3101': 5 };
export const B_SPEC: Record<string, string> = { 'LB-3102': '0-100 NTU, battery powered' };
export const B_ABSENT = ['SP-5302'];

const money = (n: number) => `R ${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;

const NOTES = [
  'Read all parts of this tender before preparing an offer.',
  'Site visits can be arranged through the procurement office on written request.',
  'Goods are delivered to the authority store at Ridgeback and signed for on arrival.',
  'Each package must carry a label showing the line reference and the tender number.',
  'Instruments must be supplied calibrated, with a certificate where one applies.',
  'Operating manuals in English must accompany each instrument.',
  'Substitutes are accepted only when stated clearly and priced apart from the main offer.',
  'The authority may ask for a working sample before it makes an award.',
  'Questions about this tender are answered in writing to every tenderer together.',
  'Nothing in this tender commits the authority to buy any item shown.',
];
const CONDITIONS = [
  'Offers stay open for ninety days after the closing date.',
  'Prices are firm until delivery and are quoted without VAT.',
  'A tenderer must say plainly what its price leaves out.',
  'Delivery is expected within six weeks of a written order.',
  'The authority may place its order with more than one tenderer.',
  'Late offers are returned without being read.',
  'Payment follows thirty days after a correct invoice is received.',
  'The authority does not have to accept the lowest offer or any offer.',
  'This document and everything in it is invented for software testing only.',
  'No real company, product or price is meant by any figure shown here.',
];
const QUOTE_TERMS = [
  'Delivery takes about six weeks from a written order.',
  'Payment is due thirty days after invoice.',
  'Goods carry the maker guarantee.',
  'Every instrument is supplied with an English manual.',
  'Calibration certificates are included where they apply.',
  'This quotation is invented for software testing only.',
];

// ---------------- table layout ----------------
const RFQ_COLS = { ref: 50, desc: 115, qty: 300, spec: 360 };
const QA_COLS = { ref: 50, desc: 115, qty: 285, price: 340, note: 405 };

const fact = (field: string, kind: ExpectedFact['kind'], excerpt: string, value: unknown): Omit<ExpectedFact, 'line'> => ({ field, kind, excerpt, value } as Omit<ExpectedFact, 'line'>);

function buildRfq(): Row[] {
  const rows: Row[] = [
    prose('Tender TN-7731: Supply of laboratory and field instruments (fictional sample)'),
    prose('Issued by the Ridgeback Catchment Authority, a fictional public body.'),
    prose('Tenders close on 12 January 2027. All amounts are in South African rand.'),
    prose('Tenderers must price each line separately and keep to the order of the table below.'),
    prose('Notes for tenderers'),
    ...NOTES.map(prose),
    prose('Required goods'),
    { cells: [{ x: RFQ_COLS.ref, text: 'Ref' }, { x: RFQ_COLS.desc, text: 'Description' }, { x: RFQ_COLS.qty, text: 'Qty' }, { x: RFQ_COLS.spec, text: 'Requirement' }], facts: [] },
  ];
  for (const it of ITEMS) {
    const first = it.desc[0]!;
    const qty = `${it.qty} ${it.unit}`;
    rows.push({
      cells: [{ x: RFQ_COLS.ref, text: it.code }, { x: RFQ_COLS.desc, text: first }, { x: RFQ_COLS.qty, text: qty }, { x: RFQ_COLS.spec, text: it.spec }],
      facts: [
        fact('item', 'text', `${it.code} ${first}`, `${it.code} ${first}`),
        fact('quantity', 'quantity', qty, { value: String(it.qty), unit: it.unit }),
        fact('specification', 'text', it.spec, it.spec),
      ] as ExpectedFact[],
    });
    for (const more of it.desc.slice(1)) rows.push({ cells: [{ x: RFQ_COLS.desc, text: more }], facts: [] });
  }
  rows.push(prose('Conditions of tender'), ...CONDITIONS.map(prose));
  return rows;
}

function buildQuoteA(): Row[] {
  const rows: Row[] = [
    prose('Quotation 2207-HL from Hydro-Lab Supplies, a fictional supplier.'),
    prose('Our reply to tender TN-7731. Prices are in rand and the offer stays open for ninety days.'),
    prose('Our prices'),
    { cells: [{ x: QA_COLS.ref, text: 'Ref' }, { x: QA_COLS.desc, text: 'Item offered' }, { x: QA_COLS.qty, text: 'Qty' }, { x: QA_COLS.price, text: 'Unit price' }, { x: QA_COLS.note, text: 'Notes' }], facts: [] },
  ];
  for (const it of ITEMS) {
    if (A_ABSENT.includes(it.code)) continue;
    const uncertain = it.code === A_UNCERTAIN;
    const desc = uncertain ? ['Calibration set to ISO-17034'] : it.desc;
    const first = desc[0]!;
    const qty = `${A_QTY[it.code] ?? it.qty} ${it.unit}`;
    const spec = A_SPEC[it.code] ?? it.spec;
    const price = money(it.price);
    rows.push({
      cells: [{ x: QA_COLS.ref, text: it.code }, { x: QA_COLS.desc, text: first }, { x: QA_COLS.qty, text: qty }, { x: QA_COLS.price, text: price }, { x: QA_COLS.note, text: spec }],
      facts: [
        fact('item', 'text', `${it.code} ${first}`, `${it.code} ${first}`),
        fact('quantity', 'quantity', qty, { value: String(A_QTY[it.code] ?? it.qty), unit: it.unit }),
        fact('unit_price', 'money', price, { amount: String(it.price), currency: 'ZAR' }),
        fact('specification', 'text', spec, spec),
      ] as ExpectedFact[],
    });
    for (const more of desc.slice(1)) rows.push({ cells: [{ x: QA_COLS.desc, text: more }], facts: [] });
  }
  const excl = 'installation and training';
  rows.push({ cells: [{ x: 50, text: `Not included in these prices: ${excl}.` }], facts: [fact('exclusion', 'text', excl, excl)] as ExpectedFact[] });
  rows.push(prose('Our terms'), ...QUOTE_TERMS.map(prose));
  return rows;
}

function buildQuoteB(): Row[] {
  const exclVat = 'All prices exclude VAT';
  const exclCarriage = 'Carriage to site and installation are excluded';
  const rows: Row[] = [
    prose('Offer DF/0098 from Delta Field Instruments, a fictional company.'),
    { cells: [{ x: 50, text: `We refer to tender TN-7731. ${exclVat}.` }], facts: [fact('exclusion', 'text', exclVat, exclVat)] as ExpectedFact[] },
    prose('What we can supply'),
  ];
  let n = 0;
  for (const it of ITEMS) {
    if (B_ABSENT.includes(it.code)) continue;
    const qtyN = B_QTY[it.code] ?? it.qty;
    const spec = B_SPEC[it.code] ?? it.spec;
    const qty = `${qtyN} ${it.unit}`;
    const price = `${money(it.price)} each`;
    const name = it.desc.join(' ');
    const item = `${it.code} ${name}`;
    const a = n++ % 2 === 0;
    const text = a ? `${item}: ${qty} offered, ${spec}, ${price}.` : `Offered: ${qty} ${item} (${spec}) at ${price}.`;
    rows.push({
      cells: [{ x: 50, text }],
      facts: [
        fact('item', 'text', item, item),
        fact('quantity', 'quantity', qty, { value: String(qtyN), unit: it.unit }),
        fact('specification', 'text', spec, spec),
        fact('unit_price', 'money', price, { amount: String(it.price), currency: 'ZAR' }),
      ] as ExpectedFact[],
    });
  }
  rows.push({ cells: [{ x: 50, text: `${exclCarriage} from this offer.` }], facts: [fact('exclusion', 'text', exclCarriage, exclCarriage)] as ExpectedFact[] });
  rows.push(prose('Other terms'), ...QUOTE_TERMS.map(prose));
  return rows;
}

// ---------------- sample manifest ----------------
function docOf(id: string, role: string, schemaId: string, rows: Row[]): { doc: SampleDoc; rows: Row[] } {
  const lines = rows.map(textOf);
  const facts: ExpectedFact[] = [];
  rows.forEach((r, i) => {
    for (const f of r.facts) {
      // the excerpt must be inside the block text, exactly as the PDF is read
      if (!lines[i]!.includes(f.excerpt)) throw new Error(`${id} row ${i}: excerpt not in line: ${f.excerpt}`);
      facts.push({ ...f, line: i });
    }
  });
  return { doc: { id, file: `${id}.pdf`, role, schemaId, lines, facts }, rows };
}

export function buildFresh(): { sample: Sample; rows: Record<string, Row[]> } {
  const rfq = docOf('rfq', 'rfq', 'scopecheck.rfq.v1', buildRfq());
  const a = docOf('quote-a', 'quote', 'scopecheck.quote.v1', buildQuoteA());
  const b = docOf('quote-b', 'quote', 'scopecheck.quote.v1', buildQuoteB());
  const rowOf = (d: { doc: SampleDoc }, needle: string) => {
    const i = d.doc.lines.findIndex((l) => l.includes(needle));
    if (i < 0) throw new Error(`no line with ${needle}`);
    return i;
  };
  const f = (code: string, subject: string, response: string, severity: ExpectedFinding['severity'], state: ExpectedFinding['state'], stateIfCoverageConfirmed?: 'confirmed'): ExpectedFinding => ({ code, subject, response, severity, state, ...(stateIfCoverageConfirmed ? { stateIfCoverageConfirmed } : {}) });
  const aUncertain = blockIdOf(rowOf(a, 'ISO-17034'));
  const aExcl = blockIdOf(rowOf(a, 'Not included in these prices'));
  const bVat = blockIdOf(rowOf(b, 'All prices exclude VAT'));
  const bCarriage = blockIdOf(rowOf(b, 'Carriage to site'));
  const expectedFindings: ExpectedFinding[] = [
    // quotation A
    f('quantity.differs', 'LB-3110:quantity', 'quote-a', 'critical', 'confirmed'),
    f('spec.differs', 'LB-3115:specification', 'quote-a', 'critical', 'confirmed'),
    f('spec.differs', 'FD-4202:specification', 'quote-a', 'critical', 'confirmed'),
    f('item.absent', 'FD-4215', 'quote-a', 'critical', 'needs_review', 'confirmed'),
    f('item.identity_uncertain', `quote-a:${aUncertain}:item`, 'quote-a', 'warning', 'needs_review'),
    f('item.absent', 'CL-6401', 'quote-a', 'critical', 'needs_review'),
    f('exclusion.stated', `quote-a:${aExcl}:exclusion`, 'quote-a', 'info', 'confirmed'),
    // quotation B
    f('quantity.differs', 'LB-3101:quantity', 'quote-b', 'critical', 'confirmed'),
    f('spec.differs', 'LB-3102:specification', 'quote-b', 'critical', 'confirmed'),
    f('item.absent', 'SP-5302', 'quote-b', 'critical', 'needs_review', 'confirmed'),
    f('exclusion.stated', `quote-b:${bVat}:exclusion`, 'quote-b', 'info', 'confirmed'),
    f('exclusion.stated', `quote-b:${bCarriage}:exclusion`, 'quote-b', 'info', 'confirmed'),
  ];
  const sample: Sample = {
    id: SAMPLE_ID,
    family: 'scopecheck',
    label: 'Fresh-document validation: a new tender, a positioned-column quotation and a prose quotation (fictional)',
    preregistration:
      'Written and committed BEFORE any model extraction on these documents (SC-T12). Expected findings follow from the seeded differences in tools/benchmark/src/fresh-scopecheck.ts. ' +
      'Quotation A (positioned table): LB-3110 quantity 8 -> 6; LB-3115 specification "1 mg" for "0.1 mg"; FD-4202 specification IP65 for IP68; FD-4215 absent; CL-6401 described with a standard (ISO-17034) next to its own reference, so its identity is uncertain and the requirement stays unmatched; one exclusion. ' +
      'Quotation B (prose): LB-3101 quantity 6 -> 5; LB-3102 specification 0-100 NTU for 0-1000 NTU; SP-5302 absent; two exclusions on separate lines (VAT, carriage). ' +
      'NOT differences, so no finding is expected: quotation A LB-3101 specification is "c/w 0.01 pH resolution" (a leading connector); every other row agrees. ' +
      'Absences are Needs review while coverage is unverified; the two with stateIfCoverageConfirmed become confirmed only if coverage is confirmed. CL-6401 stays Needs review either way. ' +
      'Wrapped descriptions (LB-3115 and FD-4215 in the tender, LB-3115 in quotation A): the description continues on a second line, evidence cannot span two lines, so the labelled item value is the first line. ' +
      'Block ids are fixed by the layout (PAGE_ROWS rows per page). Labels are never read by extraction, chunking or matching.',
    docs: [rfq.doc, a.doc, b.doc],
    expectedFindings,
  };
  return { sample, rows: { rfq: rfq.rows, 'quote-a': a.rows, 'quote-b': b.rows } };
}

/** Render each document to a PDF: every cell is its own text item at its own x position. Deterministic. */
export async function renderPdf(id: string, rows: Row[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  pdf.setProducer('skeleton-key sample generator');
  pdf.setTitle(`${id} (fictional fresh-validation sample)`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]);
  rows.forEach((r, i) => {
    if (i > 0 && i % PAGE_ROWS === 0) page = pdf.addPage([595, 842]);
    const y = 800 - (i % PAGE_ROWS) * ROW_STEP;
    for (const c of r.cells) page.drawText(c.text, { x: c.x, y, size: FONT, font });
  });
  return pdf.save({ useObjectStreams: false });
}

if (process.argv[1]?.endsWith('fresh-scopecheck.ts')) {
  const { sample, rows } = buildFresh();
  const dir = join(SAMPLES_DIR, SAMPLE_ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sample.json'), JSON.stringify(sample, null, 2) + '\n');
  for (const d of sample.docs) writeFileSync(join(dir, d.file), await renderPdf(d.id, rows[d.id]!));
  console.log(`written: ${dir} (${sample.docs.map((d) => `${d.id}: ${d.lines.length} lines, ${d.facts.length} labels`).join('; ')}; ${sample.expectedFindings.length} expected findings)`);
}
