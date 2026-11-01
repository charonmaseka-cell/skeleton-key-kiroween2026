import { cellAround, isEvidenceIntact, nameTokens, type Block, type Evidence, type Fact } from '@skeleton-key/engine';

// ScopeCheck adapter: item identity. All procurement-specific parsing (what an item code looks
// like, how a quotation line is laid out) lives here, in the ScopeCheck app, not in the shared
// engine, which is only used for its evidence primitives. This is THE resolver: the benchmark and
// the app's adapter (Task 6) both import it, so what is measured is what ships.
//
// Why it exists: models sometimes return an item as "Centrifugal pump" although the cited source
// says "Item CP-100 Centrifugal pump". The code is the stable identifier the matcher keys on, so
// dropping it breaks cross-document matching. A code is recovered ONLY when the original source
// text ties it unambiguously to that item. Anything else stays description-only or uncertain, and
// uncertain identity can never produce a confirmed omission.
//
// Layout assumptions (documented limits): one item per block; an item's "segment" (cell) is, in this order, the
// source cell the PDF parser found from item positions (Block.cells, validated against the text) or the part of its block
// between column separators (`|`, `;` or a tab) written in the text, or the whole block when there are none;
// a code looks like 1-4 letters, a hyphen and digits (CP-100). Codes without a hyphen are not
// recognised and leave the item description-only. A second code-like token in the same segment
// (a standard such as SANS-1200, an alternative part number) makes identity uncertain: the
// resolver never chooses between them.
//
// Nothing here edits a fact, a claim or a score. Recovered identifiers are recorded separately.

const CODE = /\b[A-Za-z]{1,4}-\d+\b/g;
const SEGMENT_SEPARATORS = ['|', ';', '\t'];

export type UncertainReason =
  | 'evidence_missing' // the fact has no evidence span
  | 'evidence_invalid' // the block is missing or the span no longer equals the source slice
  | 'description_not_located' // the item description is not found exactly once inside its own cited span
  | 'code_not_in_source' // the code in the model's value does not appear in the cited span
  | 'multiple_codes'; // more than one code is tied to the description

export type ItemIdentity =
  | { kind: 'code'; code: string; origin: 'model_value' | 'recovered' }
  | { kind: 'description'; key: string } // the source genuinely carries no code for this item
  | { kind: 'uncertain'; reason: UncertainReason; candidates: string[]; description: string };

/** A code the model omitted from its value, found again in the original source with its own validated span. */
export type RecoveredIdentifier = {
  factId: string;
  docId: string;
  description: string;
  code: string;
  /** span of the code alone: text === block.text.slice(start, end), checked with isEvidenceIntact */
  codeSpan: Evidence;
  /** the span the model cited for the item (unchanged) */
  itemEvidence: Evidence;
  method: 'single_code_in_item_segment' | 'single_code_in_item_cell' | 'row_reference_cell';
  /**
   * 'single_code_in_item_cell' only: the model returned several cells of the row joined by "|" in one item value. Each part
   * was located exactly once in a DIFFERENT source cell of the cited span; these are those spans (all intact). The raw
   * claim is not edited.
   */
  parts?: Evidence[];
};

export type IdentityReport = {
  identities: Map<string, ItemIdentity>;
  recovered: RecoveredIdentifier[];
  uncertain: { factId: string; docId: string; reason: UncertainReason; candidates: string[]; description: string }[];
  counts: { codeFromModel: number; recovered: number; descriptionOnly: number; uncertain: number };
};

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function codesIn(text: string): { code: string; start: number; end: number }[] {
  return [...text.matchAll(CODE)].map((m) => ({ code: m[0].toUpperCase(), start: m.index!, end: m.index! + m[0].length }));
}

/** Locate the description (whitespace-insensitive, case-insensitive) inside the span the model cited. */
function locateWithin(block: Block, ev: Evidence, description: string): { start: number; end: number } | null {
  const pattern = new RegExp(escapeRegExp(normalise(description)).replace(/ /g, '\\s+'), 'gi');
  const hits = [...block.text.matchAll(pattern)]
    .map((m) => ({ start: m.index!, end: m.index! + m[0].length }))
    .filter((h) => h.start >= ev.start && h.end <= ev.end);
  return hits.length === 1 ? hits[0]! : null;
}

/** The source cell that contains [start, end): the parser's validated cell, else the part between written separators. */
function segmentAround(block: Block, start: number, end: number): { start: number; end: number } {
  const positioned = cellAround(block, start, end);
  if (positioned) return positioned;
  const text = block.text;
  let segStart = 0;
  let segEnd = text.length;
  for (const sep of SEGMENT_SEPARATORS) {
    const l = text.lastIndexOf(sep, start - 1);
    if (l !== -1) segStart = Math.max(segStart, l + 1);
    const r = text.indexOf(sep, end);
    if (r !== -1) segEnd = Math.min(segEnd, r);
  }
  return { start: segStart, end: segEnd };
}

/**
 * A value that joins several source cells with "|". Every part must be located exactly once inside the cited span, and
 * the parts must lie in different source cells; otherwise null (the identity stays uncertain and goes to review).
 */
function locateCells(block: Block, ev: Evidence, value: string, docBlocks: Map<string, Block>): { first: { start: number; end: number }; parts: Evidence[] } | null {
  const texts = value.split('|').map((p) => p.trim()).filter(Boolean);
  if (texts.length < 2) return null;
  const spans: { start: number; end: number }[] = [];
  for (const t of texts) {
    const hit = locateWithin(block, ev, t);
    if (!hit) return null;
    spans.push(hit);
  }
  const cells = spans.map((h) => segmentAround(block, h.start, h.end));
  if (new Set(cells.map((c) => `${c.start}:${c.end}`)).size !== cells.length) return null; // two parts in one cell: not cell boundaries
  const parts = spans.map((h): Evidence => ({ docId: block.docId, blockId: block.id, start: h.start, end: h.end, text: block.text.slice(h.start, h.end) }));
  if (!parts.every((p) => isEvidenceIntact(p, docBlocks))) return null;
  return { first: spans[0]!, parts };
}

/** Codes held alone in a cell of a positioned row, other than the cell [segStart, segEnd) the item description is in. */
function referenceCodes(block: Block, segStart: number, segEnd: number): { code: string; start: number; end: number }[] {
  if (block.layout !== 'positioned' || !block.cells) return [];
  return block.cells
    .filter((c) => c.end <= segStart || c.start >= segEnd)
    .map((c) => ({ c, codes: codesIn(block.text.slice(c.start, c.end)) }))
    .filter(({ c, codes }) => codes.length === 1 && codes[0]!.start === 0 && codes[0]!.end === c.end - c.start)
    .map(({ c, codes }) => ({ code: codes[0]!.code, start: c.start, end: c.end }));
}

export function resolveItemIdentities(facts: Fact[], blocks: Block[]): IdentityReport {
  const byDoc = new Map<string, Map<string, Block>>();
  for (const b of blocks) {
    const m = byDoc.get(b.docId) ?? new Map<string, Block>();
    m.set(b.id, b);
    byDoc.set(b.docId, m);
  }
  const report: IdentityReport = { identities: new Map(), recovered: [], uncertain: [], counts: { codeFromModel: 0, recovered: 0, descriptionOnly: 0, uncertain: 0 } };
  const uncertain = (fact: Fact, reason: UncertainReason, candidates: string[] = []) => {
    const description = String(fact.value);
    report.identities.set(fact.id, { kind: 'uncertain', reason, candidates, description });
    report.uncertain.push({ factId: fact.id, docId: fact.docId, reason, candidates, description });
    report.counts.uncertain++;
  };

  for (const fact of facts) {
    if (fact.field !== 'item' || fact.status !== 'validated' || typeof fact.value !== 'string') continue;
    const docBlocks = byDoc.get(fact.docId) ?? new Map<string, Block>();

    // Evidence must exist and still equal the original text. Otherwise identity is uncertain.
    const ev = fact.evidence[0];
    if (!ev) {
      uncertain(fact, 'evidence_missing');
      continue;
    }
    if (!fact.evidence.every((e) => isEvidenceIntact(e, docBlocks))) {
      uncertain(fact, 'evidence_invalid');
      continue;
    }
    const block = docBlocks.get(ev.blockId)!;

    // 1. The model kept a code in its value. Accept it only if the source segment holds no competing code.
    // When the value joins several cells with "|", only its FIRST part describes the item: a code in a later part (a
    // standard in the specification cell, say) is not the item's code.
    const descriptionPart = fact.value.includes('|') ? fact.value.split('|')[0]! : fact.value;
    const inValue = [...new Set(codesIn(descriptionPart).map((c) => c.code))];
    if (inValue.length > 1) {
      uncertain(fact, 'multiple_codes', inValue);
      continue;
    }
    if (inValue.length === 1) {
      const code = inValue[0]!;
      const at = codesIn(block.text.slice(ev.start, ev.end)).find((c) => c.code === code);
      if (!at) {
        uncertain(fact, 'code_not_in_source', [code]);
        continue;
      }
      const seg = segmentAround(block, ev.start + at.start, ev.start + at.end);
      const inSegment = [...new Set([...codesIn(block.text.slice(seg.start, seg.end)).map((c) => c.code), ...referenceCodes(block, seg.start, seg.end).map((c) => c.code)])];
      if (inSegment.length > 1) {
        uncertain(fact, 'multiple_codes', inSegment);
        continue;
      }
      report.identities.set(fact.id, { kind: 'code', code, origin: 'model_value' });
      report.counts.codeFromModel++;
      continue;
    }

    // 2. The code was omitted: look for it in the same source cell as the description.
    let at = locateWithin(block, ev, fact.value);
    let parts: Evidence[] | undefined;
    if (!at) {
      // The model may have joined several cells of the row with "|" in one value ("Pipe DN50 | HDPE, 6 m"). That is only
      // accepted when every part is found exactly once inside the cited span, each in a DIFFERENT source cell. The first
      // part is the item description; the others are the model's cells and play no part in the identity.
      const located = locateCells(block, ev, fact.value, docBlocks);
      if (!located) {
        uncertain(fact, 'description_not_located');
        continue;
      }
      at = located.first;
      parts = located.parts;
    }
    const { start: segStart, end: segEnd } = segmentAround(block, at.start, at.end);
    const found = codesIn(block.text.slice(segStart, segEnd)).map((c) => ({ ...c, start: segStart + c.start, end: segStart + c.end }));
    // A genuinely positioned row may carry its reference in a cell of its own ("LB-3101 | Digital pH meter | ..."). That cell
    // is the row's reference only when it holds nothing but a code. Codes in the description cell and in reference cells
    // are weighed together: more than one distinct code is never resolved.
    const refs = referenceCodes(block, segStart, segEnd);
    const all = [...found, ...refs];
    const distinct = [...new Set(all.map((c) => c.code))];

    if (distinct.length === 0) {
      report.identities.set(fact.id, { kind: 'description', key: nameTokens(parts ? fact.value.split('|')[0]!.trim() : fact.value).join(' ') });
      report.counts.descriptionOnly++;
    } else if (distinct.length > 1 || found.length > 1) {
      uncertain(fact, 'multiple_codes', distinct);
    } else {
      const c = all[0]!;
      const codeSpan: Evidence = { docId: block.docId, blockId: block.id, start: c.start, end: c.end, text: block.text.slice(c.start, c.end) };
      if (!isEvidenceIntact(codeSpan, docBlocks)) {
        uncertain(fact, 'evidence_invalid');
        continue;
      }
      const fromRef = found.length === 0;
      report.identities.set(fact.id, { kind: 'code', code: c.code, origin: 'recovered' });
      report.recovered.push({ factId: fact.id, docId: fact.docId, description: fact.value, code: c.code, codeSpan, itemEvidence: ev, method: fromRef ? 'row_reference_cell' : parts ? 'single_code_in_item_cell' : 'single_code_in_item_segment', ...(parts ? { parts } : {}) });
      report.counts.recovered++;
    }
  }
  return report;
}

/**
 * Heuristic similarity between two item descriptions (share of the smaller token set found in the
 * other). Used only to SUGGEST a match, which the matcher never treats as verified.
 */
export function descriptionOverlap(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}
