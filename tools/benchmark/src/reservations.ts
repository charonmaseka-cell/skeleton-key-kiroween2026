// Task 5.5 (offline): exact request sizes and per-attempt worst-case reservations. NO model call, no network.
//
//   npx tsx tools/benchmark/src/reservations.ts [--write docs/results/task-5-5-reservations.json]
//
// For every chunk of every frozen chunk plan (and every single-chunk sample document) it builds the EXACT request body the
// client sends and the EXACT messages the Worker sends to the model (initial attempt and the one repair), then reports:
//   - body bytes, the Worker's counted characters (text + cells), blocks, longest block
//   - the reservation for that attempt under the guaranteed bound (1 byte per token) and the calibrated bound (2 bytes per token)
// It also computes the per-attempt maximum the Worker could ever be asked to serve under a given set of input limits
// (any body the limits allow, any profile), which is what a conservative attempt ceiling must be derived from.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toRequestBlock, type Block } from '@skeleton-key/engine';
import { PROFILES, buildMessages, CELLS_RULE } from '../../../services/extraction-api/src/profiles';
import { BYTES_PER_TOKEN_BOUND, BYTES_PER_TOKEN_STRICT, PROMPT_OVERHEAD_TOKENS, charge, worstCaseNeurons } from './budget';
import { frozenChunker, type FrozenPlan } from './chunking';
import { SAMPLES_DIR, loadBlocks, loadSample } from './samples';

const round = (n: number) => Math.round(n * 10) / 10;

export type Payload = {
  id: string; sample: string; doc: string; chunk: number; schemaId: string;
  blocks: number; workerChars: number; bodyBytes: number; messageBytes: number; repairMessageBytes: number;
  longestBlockChars: number; longestBlockWithCellsChars: number;
  maxOutputTokens: number;
  reserve: { strict: number; calibrated: number; strictRepair: number; calibratedRepair: number };
};

const msgBytes = (m: { content: string }[]) => m.reduce((n, x) => n + Buffer.byteLength(x.content, 'utf8'), 0);

export function measure(id: string, sample: string, doc: string, chunk: number, schemaId: string, blocks: Block[]): Payload {
  const reqBlocks = blocks.map((b) => toRequestBlock(b));
  const body = JSON.stringify({ schemaId, blocks: reqBlocks });
  const profile = PROFILES[schemaId]!;
  const m0 = buildMessages(profile, reqBlocks, false);
  const m1 = buildMessages(profile, reqBlocks, true);
  const input = (m: unknown) => ({ messages: m, max_tokens: profile.maxOutputTokens });
  return {
    id, sample, doc, chunk, schemaId,
    blocks: reqBlocks.length,
    workerChars: reqBlocks.reduce((n, b) => n + b.text.length + (b.cells ?? []).reduce((k, c) => k + c.length, 0), 0),
    bodyBytes: Buffer.byteLength(body, 'utf8'),
    messageBytes: msgBytes(m0),
    repairMessageBytes: msgBytes(m1),
    longestBlockChars: Math.max(...reqBlocks.map((b) => b.text.length)),
    longestBlockWithCellsChars: Math.max(...reqBlocks.map((b) => b.text.length + (b.cells ?? []).reduce((k, c) => k + c.length, 0))),
    maxOutputTokens: profile.maxOutputTokens,
    reserve: {
      strict: round(worstCaseNeurons(input(m0), profile.model, BYTES_PER_TOKEN_STRICT).neurons),
      calibrated: round(worstCaseNeurons(input(m0), profile.model, BYTES_PER_TOKEN_BOUND).neurons),
      strictRepair: round(worstCaseNeurons(input(m1), profile.model, BYTES_PER_TOKEN_STRICT).neurons),
      calibratedRepair: round(worstCaseNeurons(input(m1), profile.model, BYTES_PER_TOKEN_BOUND).neurons),
    },
  };
}

/**
 * Largest per-attempt reservation the Worker could be asked to serve under `maxBodyBytes`, for any profile, any allowed body.
 * Bound on the user message: JSON.stringify of the parsed blocks is never longer than the JSON text it was parsed from (it emits
 * no whitespace, and its escapes are the shortest available), so the user message is at most its fixed prefix + the body bytes.
 * The system message is the profile's own, with the cells rule (present when any block has cells), plus the repair message.
 */
export function permittedMaximum(maxBodyBytes: number) {
  const rows = Object.values(PROFILES).map((p) => {
    const sys = buildMessages(p, [{ id: 'x', text: 'x', cells: ['x', 'x'] }], true);
    const fixed = Buffer.byteLength(sys[0]!.content, 'utf8') + Buffer.byteLength('DOCUMENT_DATA (JSON):\n', 'utf8') + Buffer.byteLength(sys[2]!.content, 'utf8');
    const bytes = fixed + maxBodyBytes;
    const at = (bpt: number) => round(charge(Math.ceil(bytes / bpt) + PROMPT_OVERHEAD_TOKENS, p.maxOutputTokens, p.model));
    return { profile: p.id, maxOutputTokens: p.maxOutputTokens, messageBytesBound: bytes, strict: at(BYTES_PER_TOKEN_STRICT), calibrated: at(BYTES_PER_TOKEN_BOUND) };
  });
  const worst = rows.reduce((a, b) => (b.strict > a.strict ? b : a));
  return { maxBodyBytes, perProfile: rows, worstStrict: worst.strict, worstCalibrated: Math.max(...rows.map((r) => r.calibrated)) };
}

/** The gated binding test (docs/task-5-5-plan.md): T1 tiny, T2 largest realistic chunk, T3 a chunk of a second document, T4 tiny. */
export const TEST_PAYLOADS = [
  { step: 'T1', id: 'scopecheck/rfq' },
  { step: 'T2', id: 'scopecheck-realistic/rfq#6' },
  { step: 'T3', id: 'scopecheck-realistic/quote-a#8' },
  { step: 'T4', id: 'packcheck/registration' },
] as const;

/**
 * Every way `ceiling` attempts can be spent by the sequence: each step makes 1 attempt, or 2 if the Worker's single repair runs,
 * and steps run in order until the ceiling is used. Returns the largest total reservation over those paths (strict and calibrated).
 */
export function testSequenceBound(steps: { step: string; p: Payload }[], ceiling: number) {
  type Path = { attempts: string[]; strict: number; calibrated: number };
  const paths: Path[] = [];
  const walk = (i: number, acc: Path) => {
    if (acc.attempts.length === ceiling || i === steps.length) { paths.push(acc); return; }
    const { step, p } = steps[i]!;
    const one = { attempts: [...acc.attempts, step], strict: acc.strict + p.reserve.strict, calibrated: acc.calibrated + p.reserve.calibrated };
    walk(i + 1, one);
    if (one.attempts.length < ceiling) walk(i + 1, { attempts: [...one.attempts, `${step}r`], strict: one.strict + p.reserve.strictRepair, calibrated: one.calibrated + p.reserve.calibratedRepair });
  };
  walk(0, { attempts: [], strict: 0, calibrated: 0 });
  const worstStrict = paths.reduce((a, b) => (b.strict > a.strict ? b : a));
  const worstCal = paths.reduce((a, b) => (b.calibrated > a.calibrated ? b : a));
  return {
    ceiling,
    steps: steps.map(({ step, p }) => ({ step, id: p.id, schemaId: p.schemaId, blocks: p.blocks, workerChars: p.workerChars, bodyBytes: p.bodyBytes, messageBytes: p.messageBytes, longestBlockWithCellsChars: p.longestBlockWithCellsChars, maxOutputTokens: p.maxOutputTokens, reserve: p.reserve })),
    paths: paths.length,
    worstStrict: { total: round(worstStrict.strict), attempts: worstStrict.attempts },
    worstCalibrated: { total: round(worstCal.calibrated), attempts: worstCal.attempts },
    noRepairPath: round(steps.reduce((n, s) => n + s.p.reserve.strict, 0)),
  };
}

export async function collect(): Promise<Payload[]> {
  const out: Payload[] = [];
  for (const sampleId of ['scopecheck', 'scopecheck-layout', 'packcheck', 'scopecheck-realistic', 'scopecheck-fresh', 'packcheck-realistic']) {
    const sample = loadSample(sampleId);
    const planFile = join(SAMPLES_DIR, sampleId, 'chunk-plan.json');
    const plan = existsSync(planFile) ? (JSON.parse(readFileSync(planFile, 'utf8')) as FrozenPlan) : null;
    for (const doc of sample.docs) {
      const blocks = await loadBlocks(sampleId, doc);
      if (!plan) { out.push(measure(`${sampleId}/${doc.id}`, sampleId, doc.id, 1, doc.schemaId, blocks)); continue; }
      const d = plan.docs.find((x) => x.docId === doc.id)!;
      const r = frozenChunker(plan)(doc.id, blocks, d.schemaId);
      r.chunks.forEach((c, k) => out.push(measure(`${sampleId}/${doc.id}#${k + 1}`, sampleId, doc.id, k + 1, d.schemaId, c)));
    }
  }
  return out;
}

if (process.argv[1]?.endsWith('reservations.ts')) {
  const all = await collect();
  const by = (k: keyof Payload) => all.reduce((a, b) => ((b[k] as number) > (a[k] as number) ? b : a));
  const summary = {
    note: 'Offline. Exact request bodies and Worker messages built from the sample PDFs and frozen chunk plans; no model call. Reservations are budget charges at published rates x 1.1 (budget.ts), not consumption.',
    cellsRuleBytes: Buffer.byteLength(CELLS_RULE, 'utf8'),
    largest: { bodyBytes: by('bodyBytes').id, workerChars: by('workerChars').id, blocks: by('blocks').id, longestBlockChars: by('longestBlockChars').id, longestBlockWithCellsChars: by('longestBlockWithCellsChars').id, messageBytes: by('messageBytes').id },
    maxima: {
      bodyBytes: by('bodyBytes').bodyBytes, workerChars: by('workerChars').workerChars, blocks: by('blocks').blocks,
      longestBlockChars: by('longestBlockChars').longestBlockChars, longestBlockWithCellsChars: by('longestBlockWithCellsChars').longestBlockWithCellsChars,
      reserveStrictRepair: Math.max(...all.map((p) => p.reserve.strictRepair)), reserveCalibratedRepair: Math.max(...all.map((p) => p.reserve.calibratedRepair)),
    },
    permitted: [8192, 12288, 16384, 32768, 65536].map(permittedMaximum),
    payloads: all,
  };
  const pick = (id: string) => { const p = all.find((x) => x.id === id); if (!p) throw new Error(`no payload ${id}`); return p; };
  (summary as Record<string, unknown>).gateTest = testSequenceBound(TEST_PAYLOADS.map((t) => ({ step: t.step, p: pick(t.id) })), 4);
  const i = process.argv.indexOf('--write');
  if (i > 0) writeFileSync(process.argv[i + 1]!, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ ...summary, payloads: undefined }, null, 2));
  for (const p of all) console.log([p.id, p.schemaId, p.blocks, p.workerChars, p.bodyBytes, p.messageBytes, p.longestBlockWithCellsChars, p.reserve.strict, p.reserve.calibrated, p.reserve.strictRepair, p.reserve.calibratedRepair].join('\t'));
}
