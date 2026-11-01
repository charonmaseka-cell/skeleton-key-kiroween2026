import { isEvidenceIntact, nameTokens, type Block, type Evidence, type Fact } from '@skeleton-key/engine';

// ScopeCheck adapter: item identity. All procurement-specific parsing (what an item code looks
// like, how a quotation line is laid out) lives here. The shared engine stays generic and is only
// used for its evidence primitives. This module moves into the ScopeCheck adapter in Task 6.
//
// Why it exists: models sometimes return an item as "Centrifugal pump" although the cited source
// says "Item CP-100 Centrifugal pump". The code is the stable identifier the matcher keys on, so
// dropping it breaks cross-document matching. A code is recovered ONLY when the original source
// text ties it unambiguously to that item. Anything else stays description-only or uncertain, and
// uncertain identity can never produce a confirmed omission.
//
// Nothing here edits a fact, a claim or a score. Recovered identifiers are recorded separately.

const CODE = /\b[A-Za-z]{1,4}-\d+\b/g;
const SEGMENT_SEPARATOR = '|';

export type UncertainReason =
  | 'evidence_missing' // the fact has no evidence span
  | 'evidence_invalid' // the block is missing or the span no longer equals the source slice
  | 'description_not_located' // the item description is not found exactly once inside its own cited span
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

    // 1. The model already kept the code in its value.
    const inValue = [...new Set(codesIn(fact.value).map((c) => c.code))];
    if (inValue.length === 1) {
      report.identities.set(fact.id, { kind: 'code', code: inValue[0]!, origin: 'model_value' });
      report.counts.codeFromModel++;
      continue;
    }
    if (inValue.length > 1) {
      uncertain(fact, 'multiple_codes', inValue);
      continue;
    }

    // 2. The code was omitted: look for it in the same column segment as the description.
    const at = locateWithin(block, ev, fact.value);
    if (!at) {
      uncertain(fact, 'description_not_located');
      continue;
    }
    const left = block.text.lastIndexOf(SEGMENT_SEPARATOR, at.start - 1);
    const right = block.text.indexOf(SEGMENT_SEPARATOR, at.end);
    const segStart = left === -1 ? 0 : left + 1;
    const segEnd = right === -1 ? block.text.length : right;
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
