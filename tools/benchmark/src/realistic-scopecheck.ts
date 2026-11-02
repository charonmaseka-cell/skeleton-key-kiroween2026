// Realistic, multi-page, fictional ScopeCheck documents with expected outputs PRE-REGISTERED.
//
// The expected outputs below are derived from the seeded differences in this file and are committed
// BEFORE any model extraction is run on these documents (spec SC-4). Git history is the evidence:
// this generator and samples/scopecheck-realistic/sample.json were committed first.
//
//   npx tsx tools/benchmark/src/realistic-scopecheck.ts      writes samples/scopecheck-realistic/sample.json
//   npx tsx tools/benchmark/src/generate-samples.ts          writes the PDFs
//
// All companies, items and prices are invented.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES_DIR, type ExpectedFact, type ExpectedFinding, type Sample, type SampleDoc } from './samples';

/** Lines per page in the generated PDFs (see generate-samples.ts). Block IDs are p{page}-l{line}. */
export const LINES_PER_PAGE = 33;
export const blockId = (lineIndex: number) => `p${Math.floor(lineIndex / LINES_PER_PAGE) + 1}-l${(lineIndex % LINES_PER_PAGE) + 1}`;

type Item = { code: string; desc: string; qty: number; unit: string; spec: string; price: number };

export const ITEMS: Item[] = [
  { code: 'CP-101', desc: 'Centrifugal pump', qty: 10, unit: 'units', spec: '316 stainless steel casing', price: 12500 },
  { code: 'CP-102', desc: 'Submersible pump', qty: 6, unit: 'units', spec: 'cast iron body, 7.5 kW', price: 18900 },
  { code: 'CP-103', desc: 'Dosing pump', qty: 4, unit: 'units', spec: 'PVC head, 0-20 l/h', price: 6400 },
  { code: 'VL-201', desc: 'Gate valve DN50', qty: 40, unit: 'units', spec: 'ductile iron, flanged PN16', price: 1450 },
  { code: 'VL-202', desc: 'Ball valve DN25', qty: 60, unit: 'units', spec: 'brass, threaded', price: 380 },
  { code: 'VL-203', desc: 'Check valve DN80', qty: 24, unit: 'units', spec: 'cast steel, flanged PN16', price: 2100 },
  { code: 'VL-204', desc: 'Butterfly valve DN100', qty: 18, unit: 'units', spec: 'wafer type, EPDM seat', price: 1750 },
  { code: 'MT-301', desc: 'Electric motor 5.5 kW', qty: 8, unit: 'units', spec: 'IE3, 4 pole, IP55', price: 7800 },
  { code: 'MT-302', desc: 'Electric motor 11 kW', qty: 4, unit: 'units', spec: 'IE3, 4 pole, IP55', price: 12900 },
  { code: 'MT-310', desc: 'Motor starter', qty: 6, unit: 'units', spec: 'DOL, IP55 enclosure', price: 3200 },
  { code: 'SN-401', desc: 'Level sensor', qty: 14, unit: 'units', spec: 'ultrasonic, IP67', price: 2950 },
  { code: 'SN-402', desc: 'Pressure transmitter', qty: 12, unit: 'units', spec: '0-16 bar, 4-20 mA', price: 3300 },
  { code: 'SN-403', desc: 'Flow meter DN50', qty: 5, unit: 'units', spec: 'electromagnetic, IP68', price: 14800 },
  { code: 'PG-601', desc: 'Pressure gauge', qty: 30, unit: 'units', spec: '0-10 bar, 100 mm dial', price: 450 },
  { code: 'PG-612', desc: 'Temperature gauge', qty: 20, unit: 'units', spec: '0-120 C, bimetal', price: 390 },
  { code: 'CB-501', desc: 'Control cable 4 core', qty: 500, unit: 'm', spec: '2.5 mm2, armoured', price: 62 },
  { code: 'CB-503', desc: 'Power cable 3 core', qty: 300, unit: 'm', spec: '6 mm2, armoured', price: 95 },
  { code: 'FL-701', desc: 'Flange set DN50', qty: 36, unit: 'units', spec: 'carbon steel, PN16', price: 520 },
  { code: 'FL-702', desc: 'Flange set DN100', qty: 20, unit: 'units', spec: 'carbon steel, PN16', price: 880 },
  { code: 'GK-801', desc: 'Gasket kit DN50', qty: 50, unit: 'units', spec: 'graphite, spiral wound', price: 210 },
  { code: 'TK-110', desc: 'Storage tank 5 m3', qty: 2, unit: 'units', spec: 'HDPE, vertical', price: 21500 },
  { code: 'TK-120', desc: 'Dosing tank 500 l', qty: 3, unit: 'units', spec: 'HDPE, with bund', price: 5200 },
  { code: 'PN-130', desc: 'Pipe DN50 PN16', qty: 120, unit: 'lengths', spec: 'HDPE, 6 m lengths', price: 340 },
  { code: 'PN-140', desc: 'Pipe DN100 PN16', qty: 80, unit: 'lengths', spec: 'HDPE, 6 m lengths', price: 690 },
];


/** Plain-language boilerplate, free of item codes, quantities and prices (so it adds realistic volume, not facts). */
const CLAUSES = [
  'Bidders should read every clause of this document before preparing a quotation.',
  'The site is a treatment works with restricted access; deliveries must be booked in advance.',
  'Working hours on site are Monday to Friday, seven in the morning to four in the afternoon.',
  'Safety induction is compulsory for every driver and every installer entering the works.',
  'The utility will not accept responsibility for goods left unattended at the gate.',
  'Offloading equipment is the responsibility of the supplier unless agreed otherwise in writing.',
  'Every delivery must be accompanied by a delivery note that lists the goods by description.',
  'Damaged or incomplete deliveries will be recorded and reported to the supplier on the day.',
  'The supplier must replace faulty goods at its own cost and within a reasonable time.',
  'Test certificates, where applicable, must be supplied with the goods and not after delivery.',
  'Electrical equipment must comply with the applicable national wiring and safety standards.',
  'Mechanical equipment must be supplied with the lubricants required for first operation.',
  'Where an item is superseded, the bidder must offer the current equivalent and say so.',
  'Alternative offers are welcome but must be priced separately from the compliant offer.',
  'The utility keeps the right to inspect goods at the premises of the supplier before dispatch.',
  'Confidential information received during this process must be kept confidential by all parties.',
  'Bidders must not communicate with the staff of the utility about this request except as set out.',
  'Conflicts of interest must be declared in writing together with the quotation.',
  'The utility applies a preference scheme in line with its published procurement policy.',
  'Currency fluctuations after the closing date are for the account of the supplier.',
  'Cancellation of an order for late delivery is at the discretion of the utility.',
  'Delivery periods start on the date of a written order and are stated in calendar weeks.',
  'The supplier must keep the utility informed of any expected delay as soon as it is known.',
  'Variations to quantities after award require a written instruction from the utility.',
  'Invoices must show the order reference, the description and the quantity delivered.',
  'Disputes will first be referred to the procurement officer named in the covering letter.',
  'Any matter not covered here is governed by the general conditions of the utility.',
  'This document is written for a fictional exercise and is not a real invitation to bid.',
  'Names of places, companies and people in this document are invented for testing.',
  'No real product, price or supplier is described by the figures in this document.',
  'References to standards are illustrative and have no legal effect in this exercise.',
  'The exercise tests software that reads documents and compares what suppliers offer.',
  'A reader should be able to follow every line of this document without outside knowledge.',
  'Clarification meetings, if held, will be recorded and minutes sent to every bidder.',
  'Photographs and drawings, if supplied, form part of the description of the goods.',
  'Where a drawing and the written description differ, the written description applies.',
  'Bidders must price every line; a line left blank is read as not offered.',
  'Prices for spare parts recommended for two years of operation may be shown at the end.',
  'Training for operators, if offered, must be priced separately from the goods.',
  'The utility reserves the right to withdraw this request at any time without liability.',
];

const money = (n: number) => `R ${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;

// ---- seeded differences: these ARE the expected outputs ----
export const QUOTE_A_QTY: Record<string, number> = { 'VL-204': 16, 'MT-310': 5, 'PN-130': 100 };
export const QUOTE_A_SPEC: Record<string, string> = { 'SN-401': 'ultrasonic, IP65', 'CP-103': 'PVC head, 0-30 l/h' };
export const QUOTE_A_ABSENT = ['CB-503', 'PG-612'];
export const QUOTE_A_UNCERTAIN = 'SN-403'; // its line also names a standard, SANS-1200: two code-like tokens
export const QUOTE_B_QTY: Record<string, number> = { 'VL-201': 44, 'SN-402': 10 };
export const QUOTE_B_SPEC: Record<string, string> = { 'MT-301': 'IE2, 4 pole, IP55', 'CB-501': '2.5 mm2, unarmoured' };
export const QUOTE_B_ABSENT = ['FL-701', 'TK-120', 'GK-801'];

const RFQ_HEAD = [
  'RFQ-0420 Request for Quotation: Pump station refurbishment (fictional sample)',
  'Issued by Northfield Water Works, a fictional municipal utility.',
  'Closing date for quotations: 15 December 2026. Currency: South African rand.',
  'Quotations must be priced per unit and must follow the order of the schedule below.',
  'Instructions to bidders',
  ...CLAUSES.slice(0, 20),
  'Schedule of items',
];
const RFQ_TERMS = [
  'General conditions',
  'Prices are fixed for the validity period stated in the quotation and exclude VAT.',
  'Bidders must state clearly anything that is excluded from their price.',
  'Delivery is to the Northfield depot unless the bidder states another point of delivery.',
  'Goods must be new and unused and must carry the manufacturer warranty.',
  'Deviations from the specification must be listed and explained in the quotation.',
  'Quotations remain valid for sixty days from the closing date.',
  'The utility may split the award between bidders by item.',
  'Late quotations are returned unopened and are not considered.',
  'Technical queries must be sent in writing before the closing date.',
  'Samples may be requested before award and are returned at the bidder cost.',
  'Payment is made thirty days after receipt of a correct invoice.',
  'Bidders must hold valid tax and registration documents on request.',
  'The utility is not bound to accept the lowest or any quotation.',
  'Pricing for optional extras must be shown separately from the schedule.',
  'All dimensions are nominal unless the specification says otherwise.',
  'Packaging must protect the goods during transport and storage on site.',
  'Spare parts lists and manuals must accompany the delivery of machines.',
  'Any change to the schedule is issued as a written addendum to all bidders.',
  'Queries and clarifications will be answered to all bidders at the same time.',
  'Evaluation is by price and by compliance with the specification.',
  'The successful bidder will receive a purchase order before delivery.',
  ...CLAUSES.slice(20),
  'This request is a fictional sample created for software testing only.',
];
const NOISE_A = [
  'Quotation QA-52 from Alder Pump Supplies, a fictional supplier.',
  'In response to RFQ-0420. Prices are in South African rand and exclude VAT.',
  'Valid for sixty days from the closing date. Delivery to the Northfield depot.',
  'Our general conditions of supply',
  ...CLAUSES.slice(5, 17),
  'Priced schedule',
];
const TERMS_A = [
  'Terms of this quotation',
  'Payment: thirty days from a correct invoice.',
  'Delivery: six weeks from a written order for stock items.',
  'Warranty: twelve months from delivery on all items.',
  'Excluded: delivery, installation and commissioning are not included in these prices.',
  'Spare parts and manuals are supplied with machines as listed.',
  'Prices are fixed for the validity period.',
  ...CLAUSES.slice(10, 34),
  'This quotation is a fictional sample created for software testing only.',
];
const NOISE_B = [
  'Quotation QB-19 from Birch Industrial Trading, a fictional supplier.',
  'Our offer for RFQ-0420 follows, written line by line. Prices exclude VAT.',
  'Offer valid for sixty days. All goods are new and carry the maker warranty.',
  'About our offer',
  ...CLAUSES.slice(8, 22),
  'Our offer',
];
const TERMS_B = [
  'Conditions of our offer',
  'Terms of payment are thirty days from invoice.',
  'Freight to site is excluded from this offer.',
  'Delivery times are quoted on request for items not held in stock.',
  'Goods remain our property until paid for in full.',
  ...CLAUSES.slice(14, 36),
  'This offer is a fictional sample created for software testing only.',
];

type Built = { doc: SampleDoc; findings: ExpectedFinding[] };

const fact = (field: string, kind: ExpectedFact['kind'], line: number, excerpt: string, value: unknown): ExpectedFact => ({ field, kind, line, excerpt, value });
const qtyFact = (line: number, q: number, unit: string, excerpt: string) => fact('quantity', 'quantity', line, excerpt, { value: String(q), unit });

function rfqDoc(): SampleDoc {
  const lines = [...RFQ_HEAD];
  const facts: ExpectedFact[] = [];
  for (const it of ITEMS) {
    const line = lines.length;
    lines.push(`Item ${it.code} ${it.desc} | qty ${it.qty} ${it.unit} | ${it.spec}`);
    facts.push(fact('item', 'text', line, `Item ${it.code} ${it.desc}`, `${it.code} ${it.desc}`), qtyFact(line, it.qty, it.unit, `qty ${it.qty} ${it.unit}`), fact('specification', 'text', line, it.spec, it.spec));
  }
  lines.push(...RFQ_TERMS);
  return { id: 'rfq', file: 'rfq.pdf', role: 'requirements', schemaId: 'scopecheck.rfq.v1', lines, facts };
}

/** Quotation A: pipe-separated columns, like the RFQ. */
function quoteA(): Built {
  const lines = [...NOISE_A];
  const facts: ExpectedFact[] = [];
  const findings: ExpectedFinding[] = [];
  let uncertainLine = -1;
  for (const it of ITEMS) {
    if (QUOTE_A_ABSENT.includes(it.code)) continue;
    const line = lines.length;
    const qty = QUOTE_A_QTY[it.code] ?? it.qty;
    const spec = QUOTE_A_SPEC[it.code] ?? it.spec;
    if (it.code === QUOTE_A_UNCERTAIN) {
      uncertainLine = line;
      lines.push(`Item ${it.code} ${it.desc} certified to SANS-1200 | qty ${qty} ${it.unit} | ${spec} | ${money(it.price)} each`);
      facts.push(fact('item', 'text', line, `Item ${it.code} ${it.desc}`, `${it.code} ${it.desc}`), qtyFact(line, qty, it.unit, `qty ${qty} ${it.unit}`), fact('specification', 'text', line, spec, spec), fact('unit_price', 'money', line, `${money(it.price)} each`, { amount: String(it.price), currency: 'ZAR' }));
      continue;
    }
    lines.push(`Item ${it.code} ${it.desc} | qty ${qty} ${it.unit} | ${spec} | ${money(it.price)} each`);
    facts.push(fact('item', 'text', line, `Item ${it.code} ${it.desc}`, `${it.code} ${it.desc}`), qtyFact(line, qty, it.unit, `qty ${qty} ${it.unit}`), fact('specification', 'text', line, spec, spec), fact('unit_price', 'money', line, `${money(it.price)} each`, { amount: String(it.price), currency: 'ZAR' }));
  }
  const base = lines.length;
  lines.push(...TERMS_A);
  facts.push(fact('exclusion', 'text', base + TERMS_A.findIndex((l) => l.startsWith('Excluded:')), 'delivery, installation and commissioning are not included', 'delivery, installation and commissioning are not included'));
  for (const code of Object.keys(QUOTE_A_QTY)) findings.push({ code: 'quantity.differs', subject: `${code}:quantity`, response: 'quote-a', severity: 'critical', state: 'confirmed' });
  for (const code of Object.keys(QUOTE_A_SPEC)) findings.push({ code: 'spec.differs', subject: `${code}:specification`, response: 'quote-a', severity: 'critical', state: 'confirmed' });
  // An uncertain candidate line in the response keeps every omission Needs review, even if coverage were confirmed.
  for (const code of QUOTE_A_ABSENT) findings.push({ code: 'item.absent', subject: code, response: 'quote-a', severity: 'critical', state: 'needs_review' });
  findings.push({ code: 'item.identity_uncertain', subject: `quote-a:${blockId(uncertainLine)}:item`, response: 'quote-a', severity: 'warning', state: 'needs_review' });
  findings.push({ code: 'item.absent', subject: QUOTE_A_UNCERTAIN, response: 'quote-a', severity: 'critical', state: 'needs_review' });
  findings.push({ code: 'exclusion.stated', subject: 'quote-a:exclusion', response: 'quote-a', severity: 'info', state: 'confirmed' });
  return { doc: { id: 'quote-a', file: 'quote-a.pdf', role: 'response', schemaId: 'scopecheck.quote.v1', lines, facts }, findings };
}

/** Quotation B: free-text sentences, one item per line, no delimiters. */
function quoteB(): Built {
  const lines = [...NOISE_B];
  const facts: ExpectedFact[] = [];
  const findings: ExpectedFinding[] = [];
  for (const it of ITEMS) {
    if (QUOTE_B_ABSENT.includes(it.code)) continue;
    const line = lines.length;
    const qty = QUOTE_B_QTY[it.code] ?? it.qty;
    const spec = QUOTE_B_SPEC[it.code] ?? it.spec;
    lines.push(`We offer ${qty} ${it.unit} of ${it.desc} ${it.code} with ${spec} at ${money(it.price)} each.`);
    facts.push(fact('item', 'text', line, `${it.desc} ${it.code}`, `${it.desc} ${it.code}`), qtyFact(line, qty, it.unit, `${qty} ${it.unit}`), fact('specification', 'text', line, spec, spec), fact('unit_price', 'money', line, `${money(it.price)} each`, { amount: String(it.price), currency: 'ZAR' }));
  }
  const base = lines.length;
  lines.push(...TERMS_B);
  facts.push(fact('exclusion', 'text', base + TERMS_B.findIndex((l) => l.startsWith('Freight to site')), 'Freight to site is excluded', 'Freight to site is excluded'));
  for (const code of Object.keys(QUOTE_B_QTY)) findings.push({ code: 'quantity.differs', subject: `${code}:quantity`, response: 'quote-b', severity: 'critical', state: 'confirmed' });
  for (const code of Object.keys(QUOTE_B_SPEC)) findings.push({ code: 'spec.differs', subject: `${code}:specification`, response: 'quote-b', severity: 'critical', state: 'confirmed' });
  for (const code of QUOTE_B_ABSENT) findings.push({ code: 'item.absent', subject: code, response: 'quote-b', severity: 'critical', state: 'needs_review', stateIfCoverageConfirmed: 'confirmed' });
  findings.push({ code: 'exclusion.stated', subject: 'quote-b:exclusion', response: 'quote-b', severity: 'info', state: 'confirmed' });
  return { doc: { id: 'quote-b', file: 'quote-b.pdf', role: 'response', schemaId: 'scopecheck.quote.v1', lines, facts }, findings };
}

export function buildRealisticScopeCheck(): Sample {
  const a = quoteA();
  const b = quoteB();
  return {
    id: 'scopecheck-realistic',
    family: 'scopecheck',
    label: 'FICTIONAL SAMPLE: realistically sized, multi-page RFQ (24 items) and two quotations, one with table-like lines and one in free text',
    preregistration:
      'Written and committed BEFORE any model extraction on these documents (spec SC-4). Expected findings follow from the seeded differences in tools/benchmark/src/realistic-scopecheck.ts: quote-a has 3 quantity mismatches, 2 specification differences, 2 absent items, one item line naming two code-like tokens (identity uncertain) and an exclusion; quote-b has 2 quantity mismatches, 2 specification differences, 3 absent items and an exclusion. Because quote-a contains an uncertain candidate line, its omissions stay Needs review even if coverage is confirmed; quote-b omissions become confirmed only if coverage is confirmed on a completely processed document.',
    docs: [rfqDoc(), a.doc, b.doc],
    expectedFindings: [...a.findings, ...b.findings],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(SAMPLES_DIR, 'scopecheck-realistic');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sample.json'), JSON.stringify(buildRealisticScopeCheck(), null, 2) + '\n');
  console.log('samples/scopecheck-realistic/sample.json written');
}
