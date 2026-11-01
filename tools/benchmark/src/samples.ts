import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePdf } from '@skeleton-key/ingest';
import type { Block } from '@skeleton-key/engine';

export type ExpectedFact = {
  field: string;
  kind: 'money' | 'date' | 'quantity' | 'name' | 'text';
  /** 0-based index into the document's `lines` */
  line: number;
  /** exact substring of that line (used by the mock oracle only) */
  excerpt: string;
  /** canonical value; null with expectStatus needs_review means "must not be validated" */
  value: unknown | null;
  expectStatus?: 'needs_review';
};

export type ExpectedFinding = {
  code: string;
  subject: string;
  response: string;
  severity: 'critical' | 'warning' | 'info';
  state: 'confirmed' | 'needs_review';
  stateIfCoverageConfirmed?: 'confirmed';
};

export type SampleDoc = {
  id: string;
  file: string;
  role: string;
  schemaId: string;
  lines: string[];
  facts: ExpectedFact[];
};

export type Sample = {
  id: string;
  /** which check family applies; defaults to the id */
  family?: 'scopecheck' | 'packcheck';
  label: string;
  preregistration?: string;
  docs: SampleDoc[];
  expectedFindings: ExpectedFinding[];
  mustNotFlag?: string[];
};

export const SAMPLES_DIR = new URL('../../../samples/', import.meta.url).pathname;

export function loadSample(id: string): Sample {
  return JSON.parse(readFileSync(join(SAMPLES_DIR, id, 'sample.json'), 'utf8')) as Sample;
}

/** Parse a sample PDF with the real ingestion code. Block IDs are namespaced by document ID. */
export async function loadBlocks(sampleId: string, doc: SampleDoc): Promise<Block[]> {
  const data = readFileSync(join(SAMPLES_DIR, sampleId, doc.file));
  return parsePdf(data, doc.id);
}

/** Per-field label hints supplied by the app adapter (never by the model). */
export const HINTS: Record<string, string[]> = {
  quantity: ['qty'],
  project_start_date: ['start', 'period', 'from'],
  project_end_date: ['end', 'to '],
  funding_requested: ['funding requested', 'requested'],
  total_project_budget: ['total project budget', 'total budget'],
};
