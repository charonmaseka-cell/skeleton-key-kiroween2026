// Realistic, multi-page, fictional PackCheck grant pack with expected outputs PRE-REGISTERED (PC-T1).
//
// Expected findings follow from the seeded differences below and are committed BEFORE any model extraction on these documents.
// No live inference is run by this file. The pack is longer and wordier than samples/packcheck (2 to 8 lines per document):
// each document runs to one or two pages, with money and dates in prose that are NOT the fields being checked.
//
//   npx tsx tools/benchmark/src/realistic-packcheck.ts      writes samples/packcheck-realistic/{sample.json,*.pdf}
//
// All organisations, programmes and amounts are invented.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { LINES_PER_PAGE, blockId } from './realistic-scopecheck';
import { SAMPLES_DIR, type ExpectedFact, type ExpectedFinding, type Sample, type SampleDoc } from './samples';

export const SAMPLE_ID = 'packcheck-realistic';
export { blockId, LINES_PER_PAGE };

const SCHEMA = 'packcheck.grant.v2';
type Line = { text: string; facts: Omit<ExpectedFact, 'line'>[] };
const L = (text: string, ...facts: Omit<ExpectedFact, 'line'>[]): Line => ({ text, facts });
const att = (title: string): Omit<ExpectedFact, 'line'> => ({ field: 'attachment_title', kind: 'text', excerpt: title, value: title });
const money = (field: string, excerpt: string, amount: string): Omit<ExpectedFact, 'line'> => ({ field, kind: 'money', excerpt, value: { amount, currency: 'ZAR' } });
const date = (field: string, excerpt: string, value: string | null): Omit<ExpectedFact, 'line'> => ({ field, kind: 'date', excerpt, value, ...(value === null ? { expectStatus: 'needs_review' as const } : {}) });
const name = (excerpt: string): Omit<ExpectedFact, 'line'> => ({ field: 'organisation_name', kind: 'name', excerpt, value: excerpt });

// ---- seeded differences: these ARE the expected outputs ----
export const REQUIRED = ['Application form', 'Project budget', 'Registration certificate', 'Tax clearance certificate', 'Board resolution', 'Bank confirmation letter', 'Annual financial statements', 'Project work plan', 'Letters of support'];
/**
 * What the form lists. "Letter of support" is only a SUGGESTED match for the requirement "Letters of support" (a similarity
 * score is a suggestion, never verification), so that requirement stays Needs review. Two requirements are NOT listed at all.
 */
export const LISTED = ['Application form', 'Project budget', 'Registration certificate', 'Board resolution', 'Annual financial statements', 'Project work plan', 'Letter of support'];
export const MISSING = ['Tax clearance certificate', 'Bank confirmation letter'];
export const FORM_NAME = 'Riverbend Water Stewards NPC';
export const BUDGET_NAME = 'Riverbend Water Stewards'; // legal form missing: Needs review, not a confirmed difference
export const FORM_FUNDING = 'R2.4 million'; // 2 400 000, written with a magnitude word
export const BUDGET_FUNDING = 'R 2 450 000'; // differs: confirmed
export const BUDGET_TOTAL = 'R 3 150 000';
export const FORM_START = '1 April 2027';
export const FORM_END = '31 March 2028';
export const BUDGET_PERIOD_START = '01/04/2027'; // day and month both <= 12: ambiguous, held for review
export const BUDGET_PERIOD_END = '30/09/2028'; // unambiguous and different from the form's end date: confirmed

const requirements: Line[] = [
  L('Grant call GC-2027: Community Water Resilience Fund (fictional sample)'),
  L('This note sets out what an applicant must send together with its application form.'),
  L('Applications close on 15 December 2027 and late applications are not read.'),
  L('Awards range between R500 000 and R3 000 000 depending on the size of the project.'),
  L('Who may apply'),
  L('Registered non-profit organisations working on water supply in rural communities may apply.'),
  L('An organisation may submit one application in each funding round.'),
  L('Projects must be completed within eighteen months of the award.'),
  L('What to attach'),
  L('Every item below must be sent with the application. Documents are listed in the order they are read.'),
  ...REQUIRED.slice(0, 3).map((t) => L(`Required attachment: ${t}`, att(t))),
  L('The registration certificate must show the legal name exactly as it appears on the application form.'),
  ...REQUIRED.slice(3, 6).map((t) => L(`Required attachment: ${t}`, att(t))),
  L('Statements older than two years will not be accepted.'),
  ...REQUIRED.slice(6).map((t) => L(`Required attachment: ${t}`, att(t))),
  L('How applications are assessed'),
  L('Each application is read by two assessors who score it against the published criteria.'),
  L('Assessors look at need, value for money, community involvement and the strength of the plan.'),
  L('The panel may ask an applicant to clarify any part of its application in writing.'),
  L('Successful applicants are told by letter and the list of awards is published afterwards.'),
  L('Funds are paid in three instalments linked to reports on progress.'),
  L('The fund keeps the right to withdraw an award if information given turns out to be untrue.'),
  L('Applicants should keep a copy of everything they send.'),
  L('This note is invented for software testing only and describes no real grant.'),
];

const form: Line[] = [
  L('Application form for grant GC-2027 (fictional sample)'),
  L('Please complete every section in plain language.'),
  L('Applicant details'),
  L(`Organisation name: ${FORM_NAME}`, name(FORM_NAME)),
  L('Contact person: the programme manager, whose details are in the covering letter.'),
  L('Number of households served: 1 200'),
  L('Previous grant received: R450 000 in 2025 for a smaller borehole project.'),
  L('The project'),
  L(`Funding requested: ${FORM_FUNDING}`, money('funding_requested', FORM_FUNDING, '2400000')),
  L(`Project start date: ${FORM_START}`, date('project_start_date', FORM_START, '2027-04-01')),
  L(`Project end date: ${FORM_END}`, date('project_end_date', FORM_END, '2028-03-31')),
  L('The project repairs and extends the water supply to six villages along the Riverbend valley.'),
  L('Work includes rehabilitating boreholes, installing storage tanks and training local caretakers.'),
  L('Villagers will help to choose tank sites and will take part in the monitoring each month.'),
  L('We expect the supply to reach every household within the project period.'),
  L('Progress reports will be sent at the end of each quarter.'),
  L('Attachments provided with this form'),
  ...LISTED.map((t) => L(`Attachment provided: ${t}`, att(t))),
  L('Declaration'),
  L('I confirm that the information in this form is correct to the best of my knowledge.'),
  L('I understand that an award may be withdrawn if any information given is found to be untrue.'),
  L('The organisation has not applied to any other fund for the same costs.'),
  L('Signed for the organisation by its authorised officer.'),
  L('This form is invented for software testing only.'),
];

const budget: Line[] = [
  L('Project budget summary: Water Resilience Project (fictional sample)'),
  L(`Applicant: ${BUDGET_NAME}`, name(BUDGET_NAME)),
  L(`Project period: ${BUDGET_PERIOD_START} to ${BUDGET_PERIOD_END}`, date('project_start_date', BUDGET_PERIOD_START, null), date('project_end_date', BUDGET_PERIOD_END, '2028-09-30')),
  L('All amounts are in South African rand and include VAT where it applies.'),
  L('Budget lines'),
  L('Borehole rehabilitation: R 1 150 000'),
  L('Water tanks and stands: R 640 000'),
  L('Community training: R 410 000'),
  L('Monitoring equipment: R 380 000'),
  L('Staff costs: R 420 000'),
  L('Administration: R 150 000'),
  L('Summary'),
  L(`Total project budget: ${BUDGET_TOTAL}`, money('total_project_budget', BUDGET_TOTAL, '3150000')),
  L(`Funding requested from this grant: ${BUDGET_FUNDING}`, money('funding_requested', BUDGET_FUNDING, '2450000')),
  L('Own contribution: R 700 000'),
  L('Notes'),
  L('The own contribution is made up of materials and labour given by the community.'),
  L('Prices were checked against three supplier quotations in October 2027.'),
  L('A contingency is included in each line and is not shown separately.'),
  L('The budget was prepared by the finance officer and approved by the board.'),
  L('This budget is invented for software testing only.'),
];

const registration: Line[] = [
  L('Certificate of registration (fictional sample)'),
  L('Issued under the Non-Profit Organisations Act as a fictional example.'),
  L(`Registered name: ${FORM_NAME}`, name(FORM_NAME)),
  L('Registration number: 2019/123456/08'),
  L('Date of registration: 12 June 2019'),
  L('Registered office: Riverbend Road, a fictional address.'),
  L('The organisation is registered as a non-profit company.'),
  L('This certificate remains valid until it is withdrawn or replaced.'),
  L('This certificate is invented for software testing only.'),
];

const DOCS: [string, string, Line[]][] = [
  ['requirements', 'requirements', requirements],
  ['application-form', 'form', form],
  ['budget', 'supporting', budget],
  ['registration', 'supporting', registration],
];

export function buildRealisticPackCheck(): Sample {
  const docs: SampleDoc[] = DOCS.map(([id, role, lines]) => ({
    id,
    file: `${id}.pdf`,
    role,
    schemaId: SCHEMA,
    lines: lines.map((l) => l.text),
    facts: lines.flatMap((l, i) => l.facts.map((f) => {
      if (!l.text.includes(f.excerpt)) throw new Error(`${id} line ${i}: excerpt not in line: ${f.excerpt}`);
      return { ...f, line: i } as ExpectedFact;
    })),
  }));
  const f = (code: string, subject: string, response: string, state: ExpectedFinding['state'], severity: ExpectedFinding['severity'] = 'critical', stateIfCoverageConfirmed?: 'confirmed'): ExpectedFinding => ({ code, subject, response, severity, state, ...(stateIfCoverageConfirmed ? { stateIfCoverageConfirmed } : {}) });
  const expectedFindings: ExpectedFinding[] = [
    f('attachment.missing', 'tax clearance certificate', 'application-form', 'needs_review', 'critical', 'confirmed'),
    f('attachment.missing', 'bank confirmation letter', 'application-form', 'needs_review', 'critical', 'confirmed'),
    // singular for plural: a suggested match is not a verified one, so it stays Needs review even if coverage is confirmed
    f('attachment.missing', 'letters of support', 'application-form', 'needs_review'),
    f('org.name_differs', 'organisation_name', 'budget', 'needs_review'),
    f('funding.differs', 'funding_requested', 'budget', 'confirmed'),
    f('date.differs', 'project_end_date', 'budget', 'confirmed'),
    f('value.needs_review', 'budget:project_start_date', 'budget', 'needs_review', 'warning'),
  ];
  return {
    id: SAMPLE_ID,
    family: 'packcheck',
    label: 'Realistic grant pack: four documents, two attachments missing, a legal-form name difference, a funding difference, a held ambiguous date and a genuine end-date difference (fictional)',
    preregistration:
      'Written and committed BEFORE any model extraction on these documents (PC-T1). Expected findings follow from the seeded differences in tools/benchmark/src/realistic-packcheck.ts. ' +
      'The requirements list nine attachments; the form lists seven. "Tax clearance certificate" and "Bank confirmation letter" are not listed (Needs review while coverage is unverified; Confirmed if coverage is confirmed). ' +
      '"Letter of support" is listed for the requirement "Letters of support": that is only a SUGGESTED match (match scores are suggestions), so the requirement stays Needs review, with or without coverage. ' +
      'CORRECTION made before any inference: the first draft of this note called the singular/plural pair "not a difference"; an offline rule check on ideal extraction showed the rules, correctly by the project\'s own principle, keep it as Needs review, so the expectation was corrected here. ' +
      'The budget names the applicant without its legal form ("Riverbend Water Stewards" for "... NPC"): Needs review, not a confirmed difference. The form asks R2.4 million (written with a magnitude word) and the budget R 2 450 000: a confirmed difference. ' +
      'The budget period 01/04/2027 to 30/09/2028: the start date is ambiguous (day and month both 12 or less) and must be held for review, the end date is unambiguous and differs from the form (31 March 2028): confirmed. ' +
      'Total project budget R 3 150 000 is not below the funding requested: no budget finding. The registration certificate agrees with the form on the name. ' +
      'Distractors that are NOT the fields: award range R500 000 to R3 000 000, a previous grant of R450 000, closing date 15 December 2027, households served, budget lines, own contribution, registration date 12 June 2019. ' +
      'Labels are never read by extraction, chunking or matching.',
    docs,
    expectedFindings,
  };
}

async function renderPdf(doc: SampleDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  pdf.setProducer('skeleton-key sample generator');
  pdf.setTitle(`${doc.id} (fictional sample)`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]);
  doc.lines.forEach((line, i) => {
    if (i > 0 && i % LINES_PER_PAGE === 0) page = pdf.addPage([595, 842]);
    page.drawText(line, { x: 50, y: 780 - (i % LINES_PER_PAGE) * 22, size: 10, font });
  });
  return pdf.save({ useObjectStreams: false });
}

export { renderPdf };

if (process.argv[1]?.endsWith('realistic-packcheck.ts')) {
  const sample = buildRealisticPackCheck();
  const dir = join(SAMPLES_DIR, SAMPLE_ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sample.json'), JSON.stringify(sample, null, 2) + '\n');
  for (const d of sample.docs) writeFileSync(join(dir, d.file), await renderPdf(d));
  console.log(`written: ${dir} (${sample.docs.map((d) => `${d.id}: ${d.lines.length} lines, ${d.facts.length} labels`).join('; ')}; ${sample.expectedFindings.length} expected findings)`);
}
