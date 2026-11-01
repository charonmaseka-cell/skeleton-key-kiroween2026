import { chunkBlocks, type Block, type ChunkLimits } from '@skeleton-key/engine';
import { PROFILES, buildMessages } from '../../../services/extraction-api/src/profiles';
import { worstCaseNeurons } from './budget';
import { loadBlocks, loadSample, type Sample } from './samples';

// Preflight for a live run. Runs BEFORE any inference and refuses a plan that cannot work, so attempts and
// neurons are not spent finding out. It uses the pre-registered labels to estimate how many values the model
// must return per chunk, and the measured behaviour of the selected model:
//
//  - about 41 completion tokens per claim (quote-a: 528 tokens for 13 claims; RFQ: 339 for 9)
//  - output speed as low as 29 tokens per second including prompt processing (528 tokens in 18.1 s)
//
// A chunk is refused when its expected output would not fit the profile's output cap, or would not finish inside
// the Worker timeout, because a truncated or timed-out chunk is a failed chunk (it still costs an attempt).

export const TOKENS_PER_CLAIM = 42; // measured 38 to 41, with a small margin
export const SLOWEST_TOKENS_PER_SECOND = 29; // measured 29.2 to 36
export const FIXED_SECONDS = 1.5;
export const TOKEN_FIT = 0.8; // use at most 80% of the profile's output cap
export const TIME_FIT = 0.9; // and at most 90% of the timeout (the slowest measured chunk used 72%: quote-a, 18.1 s of 25 s)

export type ChunkPlan = { docId: string; chunk: number; blocks: number; chars: number; expectedClaims: number; expectedOutputTokens: number; expectedSeconds: number; worstCaseNeurons: number; problems: string[] };
export type DocPlan = { docId: string; blocks: number; chars: number; chunks: ChunkPlan[] };
export type Plan = { docs: DocPlan[]; requests: number; worstCaseNeurons: number; problems: string[]; limits: ChunkLimits; timeoutMs: number };

export async function planRun(opts: { samples: string[]; docFilter?: string[]; schemaOverrides?: Record<string, string>; limits: ChunkLimits; timeoutMs: number; model: string; minChunks?: number; attemptBudget?: number; runNeuronCap?: number; dailyHeadroom?: number }): Promise<Plan> {
  const docs: DocPlan[] = [];
  for (const sampleId of opts.samples) {
    const sample: Sample = loadSample(sampleId);
    for (const doc of sample.docs.filter((d) => !opts.docFilter || opts.docFilter.includes(d.id))) {
      const blocks: Block[] = await loadBlocks(sampleId, doc);
      const profile = PROFILES[opts.schemaOverrides?.[doc.id] ?? doc.schemaId]!;
      const { chunks, oversized } = chunkBlocks(blocks, opts.limits);
      const plan: DocPlan = { docId: doc.id, blocks: blocks.length, chars: blocks.reduce((n, b) => n + b.text.length, 0), chunks: [] };
      chunks.forEach((chunk, i) => {
        const texts = new Set(chunk.map((b) => b.text));
        const expectedClaims = doc.facts.filter((f) => texts.has(doc.lines[f.line]!)).length;
        const expectedOutputTokens = expectedClaims * TOKENS_PER_CLAIM;
        const expectedSeconds = FIXED_SECONDS + expectedOutputTokens / SLOWEST_TOKENS_PER_SECOND;
        const w = worstCaseNeurons({ messages: buildMessages(profile, chunk, false), max_tokens: profile.maxOutputTokens }, opts.model);
        const problems: string[] = [];
        if (expectedOutputTokens > TOKEN_FIT * profile.maxOutputTokens) problems.push(`expected ${expectedOutputTokens} output tokens exceed ${Math.round(TOKEN_FIT * 100)}% of the ${profile.maxOutputTokens}-token output cap`);
        if (expectedSeconds > TIME_FIT * (opts.timeoutMs / 1000)) problems.push(`expected ${expectedSeconds.toFixed(1)} s exceeds ${Math.round(TIME_FIT * 100)}% of the ${opts.timeoutMs / 1000} s timeout`);
        plan.chunks.push({ docId: doc.id, chunk: i + 1, blocks: chunk.length, chars: chunk.reduce((n, b) => n + b.text.length, 0), expectedClaims, expectedOutputTokens, expectedSeconds, worstCaseNeurons: w.neurons, problems });
      });
      for (const b of oversized) plan.chunks.push({ docId: doc.id, chunk: 0, blocks: 1, chars: b.text.length, expectedClaims: 0, expectedOutputTokens: 0, expectedSeconds: 0, worstCaseNeurons: 0, problems: [`block ${b.id} is longer than the chunk limit and cannot be sent`] });
      docs.push(plan);
    }
  }
  const requests = docs.reduce((n, d) => n + d.chunks.filter((c) => c.chunk > 0).length, 0);
  const worst = docs.reduce((n, d) => n + d.chunks.reduce((m, c) => m + c.worstCaseNeurons, 0), 0);
  const problems: string[] = [];
  for (const d of docs) {
    const n = d.chunks.filter((c) => c.chunk > 0).length;
    if (opts.minChunks && n < opts.minChunks) problems.push(`${d.docId}: ${n} chunk(s), but at least ${opts.minChunks} are required (this plan would not exercise multi-chunk extraction)`);
    for (const c of d.chunks) for (const p of c.problems) problems.push(`${d.docId}#${c.chunk}: ${p}`);
  }
  if (opts.attemptBudget !== undefined && requests > opts.attemptBudget) problems.push(`${requests} requests are needed with no repair at all, but only ${opts.attemptBudget} attempts (repairs included) are allowed`);
  // Repairs need headroom: a plan that spends every attempt on first tries cannot repair a failure.
  if (opts.attemptBudget !== undefined && requests === opts.attemptBudget) problems.push('no attempts are left for a repair');
  if (opts.runNeuronCap !== undefined && worst > opts.runNeuronCap) problems.push(`worst-case reservations ${Math.round(worst)} neurons (first attempts only) exceed the run cap ${opts.runNeuronCap}`);
  if (opts.dailyHeadroom !== undefined && worst > opts.dailyHeadroom) problems.push(`worst-case reservations ${Math.round(worst)} neurons exceed today's headroom ${Math.round(opts.dailyHeadroom)}`);
  return { docs, requests, worstCaseNeurons: worst, problems, limits: opts.limits, timeoutMs: opts.timeoutMs };
}

export function formatPlan(p: Plan): string {
  const lines = [`chunk limits: maxChars=${p.limits.maxChars} maxBlocks=${p.limits.maxBlocks} overlap=${p.limits.overlap ?? 0}; timeout ${p.timeoutMs} ms`];
  for (const d of p.docs) {
    lines.push(`  ${d.docId}: ${d.blocks} blocks, ${d.chars} chars -> ${d.chunks.filter((c) => c.chunk > 0).length} chunk(s)`);
    for (const c of d.chunks.filter((x) => x.chunk > 0)) lines.push(`    #${c.chunk}: ${c.blocks} blocks, ${c.chars} chars, ~${c.expectedClaims} values, ~${c.expectedOutputTokens} output tokens, ~${c.expectedSeconds.toFixed(1)} s, worst-case ${Math.round(c.worstCaseNeurons)} neurons${c.problems.length ? '  PROBLEM' : ''}`);
  }
  lines.push(`requests (no repairs): ${p.requests}; worst-case reservations for first attempts: ${Math.round(p.worstCaseNeurons)} neurons`);
  lines.push(p.problems.length ? `PREFLIGHT FAILED (${p.problems.length}):\n${p.problems.map((x) => `  - ${x}`).join('\n')}` : 'preflight passed');
  return lines.join('\n');
}
