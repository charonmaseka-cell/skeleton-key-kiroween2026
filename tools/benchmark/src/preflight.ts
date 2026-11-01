import { schemaEstimator, type Block, type ChunkLimits } from '@skeleton-key/engine';
import { PROFILES, buildMessages } from '../../../services/extraction-api/src/profiles';
import { PROMPT_OVERHEAD_TOKENS, charge, worstCaseNeurons } from './budget';
import { sizeChunker, type Chunker } from './chunking';
import { loadBlocks, loadSample, type Sample } from './samples';

// Preflight for a live run. Runs BEFORE any inference and refuses a plan that cannot work, so attempts and
// neurons are not spent finding out.
//
// Everything decided here comes from the chunk plan (block text, structure, schema) and measured model behaviour:
//  - about 42 completion tokens per value (measured 38 to 41, with a margin)
//  - output speed 29 to 36 tokens per second including prompt processing; 33 is the typical rate
//  - about 4.7 prompt bytes per token (measured 4.45 to 5.40)
// The per-chunk value counts are ESTIMATES (the chunker's, from the text and schema). The pre-registered labels
// appear only as a separate OFFLINE DIAGNOSTIC column for comparison; no refusal uses them.
//
// Refuse (a hard problem): expected output over the profile's output cap; expected time over 100% of the timeout at
// the TYPICAL rate; too many requests for the attempts; a block that cannot be sent; a peak reservation over a cap.
// Warn (not a refusal): expected time over 90% of the timeout at the SLOWEST measured rate. The forecasts come from
// small samples; they are not proof that a larger chunk cannot work.
//
// Neurons: reservations are REPLACED by the actual charge after each call, so the sum of worst cases is not the
// spend. The plan compares (a) the expected actual total with the run cap and (b) the PEAK reservation, which is the
// actual charge so far plus one worst-case reservation, with the run cap and the daily headroom.

export const TOKENS_PER_CLAIM = 42; // measured 38 to 41, with a small margin
export const TYPICAL_TOKENS_PER_SECOND = 33;
export const SLOWEST_TOKENS_PER_SECOND = 29; // measured 29.2 to 36
export const FIXED_SECONDS = 1.5;
export const TOKEN_FIT = 0.8; // use at most 80% of the profile's output cap
export const TIME_WARN = 0.9; // warn above 90% of the timeout at the slowest rate
export const BYTES_PER_PROMPT_TOKEN_TYPICAL = 4.7; // measured mean 4.73

export type ChunkPlan = { docId: string; chunk: number; blocks: number; chars: number; estimatedValues: number; labelledValues: number | null; expectedOutputTokens: number; expectedSeconds: number; slowestSeconds: number; expectedNeurons: number; worstCaseNeurons: number; problems: string[]; warnings: string[] };
export type DocPlan = { docId: string; blocks: number; chars: number; chunks: ChunkPlan[] };
export type Plan = { docs: DocPlan[]; requests: number; expectedNeurons: number; peakReservation: number; worstCaseNeurons: number; problems: string[]; warnings: string[]; limits: ChunkLimits; timeoutMs: number };

export async function planRun(opts: { samples: string[]; docFilter?: string[]; schemaOverrides?: Record<string, string>; limits: ChunkLimits; chunker?: Chunker; /** chunks already done in an earlier result (resume): not planned, not counted */ skipChunks?: Record<string, number[]>; timeoutMs: number; model: string; minChunks?: number; attemptBudget?: number; runNeuronCap?: number; dailyHeadroom?: number }): Promise<Plan> {
  const docs: DocPlan[] = [];
  const chunker = opts.chunker ?? sizeChunker(opts.limits);
  const reservations: { expected: number; worst: number }[] = [];
  for (const sampleId of opts.samples) {
    const sample: Sample = loadSample(sampleId);
    for (const doc of sample.docs.filter((d) => !opts.docFilter || opts.docFilter.includes(d.id))) {
      const blocks: Block[] = await loadBlocks(sampleId, doc);
      const schemaId = opts.schemaOverrides?.[doc.id] ?? doc.schemaId;
      const profile = PROFILES[schemaId]!;
      const estimate = schemaEstimator(profile.fields);
      const { chunks, oversized, info, unaccounted } = chunker(doc.id, blocks, schemaId);
      const plan: DocPlan = { docId: doc.id, blocks: blocks.length, chars: blocks.reduce((n, b) => n + b.text.length, 0), chunks: [] };
      if (unaccounted?.length) plan.chunks.push({ docId: doc.id, chunk: 0, blocks: unaccounted.length, chars: 0, estimatedValues: 0, labelledValues: null, expectedOutputTokens: 0, expectedSeconds: 0, slowestSeconds: 0, expectedNeurons: 0, worstCaseNeurons: 0, problems: [`${unaccounted.length} block(s) are not accounted for by the chunk plan: ${unaccounted.slice(0, 5).join(',')}`], warnings: [] });
      chunks.forEach((chunk, i) => {
        if (opts.skipChunks?.[doc.id]?.includes(i + 1)) return;
        const texts = new Set(chunk.map((b) => b.text));
        const labelledValues = doc.facts.filter((f) => texts.has(doc.lines[f.line]!)).length; // DIAGNOSTIC ONLY
        const estimatedValues = info?.[i]?.expectedValues ?? chunk.reduce((n, b) => n + estimate(b.text), 0);
        const expectedOutputTokens = estimatedValues * TOKENS_PER_CLAIM;
        const expectedSeconds = FIXED_SECONDS + expectedOutputTokens / TYPICAL_TOKENS_PER_SECOND;
        const slowestSeconds = FIXED_SECONDS + expectedOutputTokens / SLOWEST_TOKENS_PER_SECOND;
        const messages = buildMessages(profile, chunk.map((b) => ({ id: b.id, text: b.text })), false); // exactly what the Worker is sent
        const w = worstCaseNeurons({ messages, max_tokens: profile.maxOutputTokens }, opts.model);
        const bytes = messages.reduce((n, m) => n + Buffer.byteLength(m.content, 'utf8'), 0);
        const expectedNeurons = charge(Math.ceil(bytes / BYTES_PER_PROMPT_TOKEN_TYPICAL) + PROMPT_OVERHEAD_TOKENS, expectedOutputTokens, opts.model);
        const problems: string[] = [];
        const warnings: string[] = [];
        if (expectedOutputTokens > TOKEN_FIT * profile.maxOutputTokens) problems.push(`expected ${expectedOutputTokens} output tokens exceed ${Math.round(TOKEN_FIT * 100)}% of the ${profile.maxOutputTokens}-token output cap`);
        if (expectedSeconds > opts.timeoutMs / 1000) problems.push(`expected ${expectedSeconds.toFixed(1)} s at the typical rate (${TYPICAL_TOKENS_PER_SECOND} tokens/s) exceeds the ${opts.timeoutMs / 1000} s timeout`);
        else if (slowestSeconds > TIME_WARN * (opts.timeoutMs / 1000)) warnings.push(`at the slowest measured rate (${SLOWEST_TOKENS_PER_SECOND} tokens/s) ${slowestSeconds.toFixed(1)} s would pass ${Math.round(TIME_WARN * 100)}% of the ${opts.timeoutMs / 1000} s timeout (an estimate from small samples)`);
        if (info?.[i]?.overBudget) warnings.push('a single row group is over the per-request value budget and is sent alone');
        plan.chunks.push({ docId: doc.id, chunk: i + 1, blocks: chunk.length, chars: chunk.reduce((n, b) => n + b.text.length, 0), estimatedValues, labelledValues, expectedOutputTokens, expectedSeconds, slowestSeconds, expectedNeurons, worstCaseNeurons: w.neurons, problems, warnings });
        reservations.push({ expected: expectedNeurons, worst: w.neurons });
      });
      for (const b of oversized) plan.chunks.push({ docId: doc.id, chunk: 0, blocks: 1, chars: b.text.length, estimatedValues: 0, labelledValues: null, expectedOutputTokens: 0, expectedSeconds: 0, slowestSeconds: 0, expectedNeurons: 0, worstCaseNeurons: 0, problems: [`block ${b.id} is longer than the chunk limit and cannot be sent`], warnings: [] });
      docs.push(plan);
    }
  }
  const requests = docs.reduce((n, d) => n + d.chunks.filter((c) => c.chunk > 0).length, 0);
  const worst = reservations.reduce((n, r) => n + r.worst, 0);
  const expected = reservations.reduce((n, r) => n + r.expected, 0);
  let so_far = 0;
  let peak = 0;
  for (const r of reservations) { peak = Math.max(peak, so_far + r.worst); so_far += r.expected; }
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const d of docs) {
    const n = d.chunks.filter((c) => c.chunk > 0).length + (opts.skipChunks?.[d.docId]?.length ?? 0); // chunks reused from an earlier result still count as planned
    if (opts.minChunks && n < opts.minChunks) problems.push(`${d.docId}: ${n} chunk(s), but at least ${opts.minChunks} are required (this plan would not exercise multi-chunk extraction)`);
    for (const c of d.chunks) {
      for (const p of c.problems) problems.push(`${d.docId}#${c.chunk}: ${p}`);
      for (const w of c.warnings) warnings.push(`${d.docId}#${c.chunk}: ${w}`);
    }
  }
  if (opts.attemptBudget !== undefined && requests > opts.attemptBudget) problems.push(`${requests} requests are needed with no repair at all, but only ${opts.attemptBudget} attempts (repairs included) are allowed`);
  // Repairs need headroom: a plan that spends every attempt on first tries cannot repair a failure.
  if (opts.attemptBudget !== undefined && requests === opts.attemptBudget) problems.push('no attempts are left for a repair');
  if (opts.runNeuronCap !== undefined && expected > opts.runNeuronCap) problems.push(`expected actual charge ${Math.round(expected)} neurons exceeds the run cap ${opts.runNeuronCap}`);
  if (opts.runNeuronCap !== undefined && peak > opts.runNeuronCap) problems.push(`peak reservation ${Math.round(peak)} neurons (charged so far plus one worst case) passes the run cap ${opts.runNeuronCap}`);
  if (opts.dailyHeadroom !== undefined && expected > opts.dailyHeadroom) problems.push(`expected actual charge ${Math.round(expected)} neurons exceeds today's headroom ${Math.round(opts.dailyHeadroom)}`);
  if (opts.dailyHeadroom !== undefined && peak > opts.dailyHeadroom) problems.push(`peak reservation ${Math.round(peak)} neurons passes today's headroom ${Math.round(opts.dailyHeadroom)}`);
  return { docs, requests, expectedNeurons: expected, peakReservation: peak, worstCaseNeurons: worst, problems, warnings, limits: opts.limits, timeoutMs: opts.timeoutMs };
}

export function formatPlan(p: Plan): string {
  const lines = [`chunk limits: maxChars=${p.limits.maxChars} maxBlocks=${p.limits.maxBlocks} overlap=${p.limits.overlap ?? 0}; timeout ${p.timeoutMs} ms`];
  for (const d of p.docs) {
    lines.push(`  ${d.docId}: ${d.blocks} blocks, ${d.chars} chars -> ${d.chunks.filter((c) => c.chunk > 0).length} chunk(s)`);
    for (const c of d.chunks.filter((x) => x.chunk > 0)) lines.push(`    #${c.chunk}: ${c.blocks} blocks, ${c.chars} chars, ~${c.estimatedValues} values (estimated; label diagnostic ${c.labelledValues}), ~${c.expectedOutputTokens} output tokens, ~${c.expectedSeconds.toFixed(1)} s, expected ${Math.round(c.expectedNeurons)} neurons, reserve ${Math.round(c.worstCaseNeurons)}${c.problems.length ? '  PROBLEM' : c.warnings.length ? '  WARNING' : ''}`);
  }
  lines.push(`requests (no repairs): ${p.requests}; expected actual charge ${Math.round(p.expectedNeurons)} neurons; peak reservation ${Math.round(p.peakReservation)} neurons (sum of all worst cases ${Math.round(p.worstCaseNeurons)}, not the spend)`);
  if (p.warnings.length) lines.push(`WARNINGS (${p.warnings.length}):\n${p.warnings.map((x) => `  - ${x}`).join('\n')}`);
  lines.push(p.problems.length ? `PREFLIGHT FAILED (${p.problems.length}):\n${p.problems.map((x) => `  - ${x}`).join('\n')}` : 'preflight passed');
  return lines.join('\n');
}
