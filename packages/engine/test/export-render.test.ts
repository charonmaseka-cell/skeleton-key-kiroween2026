import { describe, expect, it } from 'vitest';
import { buildExport, renderCsv, renderText, summarizeComparisons, type ExportModel, type PlannedComparison } from '../src';

// Exports must preserve every state (R7.5, R7.6): confirmed, Needs review, Not evaluated, decisions,
// corrections and notes, with sample runs marked. Not evaluated is its own section, never "agrees".

const comparisons: PlannedComparison[] = [
  { id: 'c1', check: 'x', field: 'amount', docs: ['a', 'b'], status: 'agree', detail: '10 <-> 10' },
  { id: 'c2', check: 'x', field: 'start_date', docs: ['a', 'b'], status: 'not_evaluated', reason: 'start_date in b not validated (date_format_ambiguous)', blocked: { docId: 'b', field: 'start_date', reason: 'date_format_ambiguous' } },
  { id: 'c3', check: 'x', field: 'name', docs: ['a', 'b'], status: 'flagged' },
];

const model = (over: Partial<ExportModel> = {}): ExportModel => ({
  ...buildExport({ items: [], corrections: [], facts: new Map(), sample: true, comparisons }),
  ...over,
});

describe('comparison ledger in the export model', () => {
  it('lists Not evaluated comparisons in their own section with reason and blocked input, and counts every state', () => {
    const m = model();
    expect(m.comparisons).toEqual({ planned: 3, agree: 1, flagged: 1, notEvaluated: 1 });
    expect(m.notEvaluated).toEqual([{ id: 'c2', check: 'x', field: 'start_date', docs: ['a', 'b'], reason: 'start_date in b not validated (date_format_ambiguous)', blocked: { docId: 'b', field: 'start_date', reason: 'date_format_ambiguous' } }]);
    expect(summarizeComparisons([])).toEqual({ planned: 0, agree: 0, flagged: 0, notEvaluated: 0 });
  });

  it('a model without a ledger has an empty Not evaluated section, not a missing one', () => {
    const m = buildExport({ items: [], corrections: [], facts: new Map(), sample: false });
    expect(m.notEvaluated).toEqual([]);
    expect(m.comparisons.planned).toBe(0);
  });
});

describe('text and CSV renderers', () => {
  it('text keeps the sample marker, the ledger counts and a distinct Not evaluated section that says it did not run', () => {
    const t = renderText(model());
    expect(t.startsWith('SAMPLE (fictional)')).toBe(true);
    expect(t).toContain('NOT EVALUATED: 1');
    expect(t).toMatch(/NOT EVALUATED \(1\): these comparisons did NOT run; they are not "no difference"/);
    // Without labels the domain-neutral renderer uses the internal names (machine use only; the apps always pass labels).
    expect(t).toContain('start_date (a vs b): start_date in b not validated (date_format_ambiguous)');
    expect(t).toContain('blocked input: start_date in b: date_format_ambiguous');
    expect(t).not.toMatch(/start_date[^\n]*agree/i);
  });

  it('a real (non-sample) export is not marked as a sample', () => {
    expect(renderText(model({ sample: false }))).not.toContain('SAMPLE');
    expect(renderCsv(model({ sample: false }))).not.toContain('SAMPLE');
  });

  it('CSV has a not_evaluated row with its reason and blocked input, and marks sample rows', () => {
    const csv = renderCsv(model());
    const row = csv.split('\n').find((l) => l.startsWith('not evaluated'))!;
    expect(row).toContain('SAMPLE (fictional)');
    expect(row).toContain('start_date in b not validated (date_format_ambiguous)');
    expect(row).toContain('start_date in b: date_format_ambiguous');
  });

  it('with labels, text and CSV show plain words: field labels, document names, explained reasons, findings by message', () => {
    const labels = {
      field: (k: string) => ({ start_date: 'Start date', amount: 'Amount', name: 'Name' })[k] ?? k,
      doc: (d: string) => ({ a: 'Application form', b: 'Budget summary' })[d] ?? d,
      reason: (r: string) => (r === 'date_format_ambiguous' ? 'The date could be read more than one way.' : r),
      finding: (id: string) => (id === 'f1' ? 'Start date differs' : id),
      line: () => 5,
    };
    const m = model({
      notEvaluated: [{ id: 'c2', check: 'x', field: 'start_date', docs: ['a', 'b'], reason: 'date_format_ambiguous', blocked: { docId: 'b', field: 'start_date', reason: 'date_format_ambiguous' } }],
      coverage: [{ docId: 'b', state: 'unverified', confirmedByUser: false }],
      notes: [{ findingId: 'f1', note: 'checked' }],
      corrections: [{ factId: 'b:start_date:1', field: 'start_date', docId: 'b', originalValue: null, correctedValue: '2026-03-01', at: 1 }],
      unresolved: [{ findingId: 'f1', code: 'date.differs', severity: 'critical', state: 'needs_review', reason: 'date_format_ambiguous', message: 'Start date differs', review: 'open', reopened: false, userSupplied: [], evidence: [{ role: 'document', docId: 'b', blockId: 'p1-l5', start: 0, end: 4, text: 'Proj' }] }],
    });
    const t = renderText(m, labels);
    const csv = renderCsv(m, labels);
    for (const out of [t, csv]) {
      expect(out).toContain('Start date');
      expect(out).toContain('Budget summary');
      expect(out).toContain('The date could be read more than one way.');
      expect(out).not.toMatch(/start_date|date_format_ambiguous|date\.differs/);
      // the block reference stays, inside the evidence detail only, next to the line number
      expect(out).toContain('Budget summary, line 5 (block p1-l5)');
      expect(out.match(/p1-l5/g)!.length).toBe(1);
    }
    expect(t).toContain('- Start date differs: checked');
    expect(t).toContain('- Budget summary: not confirmed as fully extracted');
    expect(t).toContain('- Start date in Budget summary: unknown -> 2026-03-01');
  });

  it('CSV escapes quotes and commas, and neutralises spreadsheet formulas', () => {
    const m = model({
      notes: [{ findingId: 'f1', note: '=HYPERLINK("http://example.invalid")' }, { findingId: 'f2', note: 'says "hi", ok' }],
    });
    const csv = renderCsv(m);
    expect(csv).toContain(`"'=HYPERLINK(""http://example.invalid"")"`);
    expect(csv).toContain('"says ""hi"", ok"');
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });
});
