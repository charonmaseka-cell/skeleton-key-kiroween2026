import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toRequestBlock, type Block } from '@skeleton-key/engine';
import { buildMessages, getProfile, parseModelOutput, responseFormat } from '../../../services/extraction-api/src/profiles';
import { Batch } from './batch';
import { frozenChunker, type FrozenPlan } from './chunking';
import { loadBlocks, loadSample } from './samples';

// RECOVERY after a process died between a model call and the writing of the result file.
//
// Every raw response is appended to a log the moment it arrives (recording.ts). This rebuilds, from that log alone, the chunks whose
// call SUCCEEDED, so that they are not sent again: for each logged call it rebuilds the exact first-attempt request of every chunk
// in the frozen plan, keeps the chunk whose SHA-256 equals the logged one, and parses the logged output with the Worker's own parser.
// A call that has a start line but no end line has no response: nothing is recovered for it (its reservation stands in the budget,
// and its chunk is sent again, as a retry that counts against the same batch allowance).
//
//   npx tsx tools/benchmark/src/recover.ts --raw FILE --sample ID --frozen-plan FILE --out FILE [--batch-id ID --ledger-before FILE]

type Event = { evt: 'start' | 'end'; n: number; promptSha256?: string; at?: string; ms?: number; ok?: boolean; output?: { response?: unknown; usage?: unknown }; error?: string };

export const promptSha = (messages: unknown, maxTokens: number, fmt: unknown) => createHash('sha256').update(JSON.stringify({ messages, response_format: fmt, max_tokens: maxTokens })).digest('hex');

export async function recoverFromRaw(o: { rawFile: string; sampleId: string; plan: FrozenPlan; repo: string }) {
  const events = readFileSync(o.rawFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Event);
  // Pair each start line with the end line that follows it (same call number), in order, so that a log written by more than one
  // recorder, or a start with no end, can never lend one call's response to another.
  const calls: { start: Event; end?: Event }[] = [];
  const open = new Map<number, { start: Event; end?: Event }>();
  for (const e of events) {
    if (e.evt === 'start') {
      const c = { start: e };
      calls.push(c);
      open.set(e.n, c);
    } else {
      const c = open.get(e.n);
      if (c && !c.end) c.end = e;
    }
  }
  const sample = loadSample(o.sampleId);
  const requests: unknown[] = [];
  const docs: { docId: string; claimsReturned: unknown[] }[] = [];
  const unmatched: number[] = [];
  const noResponse = calls.filter((c) => !c.end).map((c) => c.start.n);
  const matchedCalls = new Set<{ start: Event; end?: Event }>();
  for (const doc of sample.docs) {
    const blocks: Block[] = await loadBlocks(o.sampleId, doc);
    const profile = getProfile(doc.schemaId)!;
    const { chunks } = frozenChunker(o.plan)(doc.id, blocks, doc.schemaId);
    const claims: unknown[] = [];
    for (const [i, chunk] of chunks.entries()) {
      const sent = chunk.map(toRequestBlock); // exactly what the Worker sent for this chunk
      const sha = promptSha(buildMessages(profile, sent, false), profile.maxOutputTokens, responseFormat(profile));
      const call = calls.find((c) => c.start.promptSha256 === sha && c.end?.ok && c.end.output && !matchedCalls.has(c));
      const start = call?.start;
      const end = call?.end;
      if (!call || !start || !end?.ok || !end.output) continue;
      const parsed = parseModelOutput(profile, new Set(sent.map((b) => b.id)), (end.output as { response?: unknown }).response ?? end.output);
      if (!parsed.ok) continue; // an invalid answer is not a recovered chunk
      matchedCalls.add(call);
      claims.push(...parsed.claims);
      requests.push({ docId: doc.id, chunk: i + 1, blocks: chunk.length, chars: chunk.reduce((n, b) => n + b.text.length, 0), ok: true, ms: end.ms ?? 0, attemptsCharged: 1, repaired: false, claims: parsed.claims.length, dropped: parsed.dropped, recoveredFromRawLog: true, rawCall: start.n, promptSha256: sha, usage: end.output.usage });
    }
    if (claims.length) docs.push({ docId: doc.id, claimsReturned: claims });
  }
  for (const c of calls) if (c.end?.ok && !matchedCalls.has(c)) unmatched.push(c.start.n);
  return {
    recoveredFromRawLog: true,
    note: 'Rebuilt OFFLINE from the raw response log of an interrupted run. The listed chunks were answered live; their claims are the Worker\'s own parse of the logged output, verified by the SHA-256 of the exact request. Nothing here was sent again. Calls with no end line have no response and recover nothing.',
    rawLog: o.rawFile.replace(o.repo, ''),
    callsWithoutResponse: noResponse,
    successfulCallsNotMatchedToAChunk: unmatched,
    requests,
    samples: [{ docs }],
  };
}

if (process.argv[1]?.endsWith('recover.ts')) {
  const a = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) a.set(argv[i]!.replace(/^--/, ''), argv[i + 1]!);
  const repo = new URL('../../../', import.meta.url).pathname;
  const need = (k: string) => a.get(k) ?? (() => { throw new Error(`--${k} is required`); })();
  const plan = JSON.parse(readFileSync(join(repo, need('frozen-plan')), 'utf8')) as FrozenPlan;
  const result = await recoverFromRaw({ rawFile: join(repo, need('raw')), sampleId: need('sample'), plan, repo });
  const out = need('out');
  writeFileSync(join(repo, out), JSON.stringify(result, null, 2) + '\n');
  console.log(`recovered ${result.requests.length} chunk(s) from ${result.rawLog}; calls without a response: [${result.callsWithoutResponse.join(',')}]; written ${out}`);
  const id = a.get('batch-id');
  if (id) {
    const batch = Batch.open(join(repo, '.benchmark-state', 'batches', `${id}.json`), id);
    batch.addResultFile(out);
    const lb = a.get('ledger-before');
    if (lb) {
      // The daily ledger holds every reservation, including that of a call that never returned. Since the batch started it has risen
      // by exactly what this batch has reserved or charged, so the batch charge is raised to that (never lowered).
      const before = JSON.parse(readFileSync(join(repo, lb), 'utf8')) as { day: string; neuronsEstimated: number };
      const now = JSON.parse(readFileSync(join(repo, '.benchmark-state', 'live-usage.json'), 'utf8')) as { day: string; neuronsEstimated: number };
      if (before.day !== now.day) throw new Error('the ledger day changed since the batch started; reconcile by hand from the raw log');
      batch.reconcileNeurons(now.neuronsEstimated - before.neuronsEstimated, 'interrupted invocation: the reservation of a call that never returned stands (daily ledger now minus daily ledger at batch start)');
    }
    console.log(`batch ${id}: ${batch.state.attemptsUsed} of ${batch.state.attemptCap} attempts, ${batch.state.neuronsCharged} of ${batch.state.neuronCap} estimated neurons; sources ${batch.state.resultFiles.join(', ')}`);
  }
  void existsSync;
}
