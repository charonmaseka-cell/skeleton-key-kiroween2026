import { isEvidenceIntact, nameTokens, type Block, type Evidence, type Fact } from '@skeleton-key/engine';

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
// Layout assumptions (documented limits): one item per block; an item's "segment" is the part of
// its block between column separators (`|`, `;` or a tab), or the whole block when there are none;
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
  method: 'single_code_in_item_segment';
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

/** The part of the block between column separators that contains [start, end). */
function segmentAround(text: string, start: number, end: number): { start: number; end: number } {
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
    const inValue = [...new Set(codesIn(fact.value).map((c) => c.code))];
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
      const seg = segmentAround(block.text, ev.start + at.start, ev.start + at.end);
      const inSegment = [...new Set(codesIn(block.text.slice(seg.start, seg.end)).map((c) => c.code))];
      if (inSegment.length > 1) {
        uncertain(fact, 'multiple_codes', inSegment);
        continue;
      }
      report.identities.set(fact.id, { kind: 'code', code, origin: 'model_value' });
      report.counts.codeFromModel++;
      continue;
    }

    // 2. The code was omitted: look for it in the same column segment as the description.
    const at = locateWithin(block, ev, fact.value);
    if (!at) {
      uncertain(fact, 'description_not_located');
      continue;
    }
    const { start: segStart, end: segEnd } = segmentAround(block.text, at.start, at.end);
    const found = codesIn(block.text.slice(segStart, segEnd));

    if (found.length === 0) {
      report.identities.set(fact.id, { kind: 'description', key: nameTokens(fact.value).join(' ') });
      report.counts.descriptionOnly++;
    } else if (found.length > 1) {
      uncertain(fact, 'multiple_codes', [...new Set(found.map((c) => c.code))]);
    } else {
      const c = found[0]!;
      const codeSpan: Evidence = { docId: block.docId, blockId: block.id, start: segStart + c.start, end: segStart + c.end, text: block.text.slice(segStart + c.start, segStart + c.end) };
      if (!isEvidenceIntact(codeSpan, docBlocks)) {
        uncertain(fact, 'evidence_invalid');
        continue;
      }
      report.identities.set(fact.id, { kind: 'code', code: c.code, origin: 'recovered' });
      report.recovered.push({ factId: fact.id, docId: fact.docId, description: fact.value, code: c.code, codeSpan, itemEvidence: ev, method: 'single_code_in_item_segment' });
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
