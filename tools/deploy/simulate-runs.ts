// How many full runs a day admits at a given neuron budget, with whole-run admission and (for comparison) the previous
// per-attempt scheme. Offline: no inference, no network.
//
//   npx tsx tools/deploy/simulate-runs.ts [budget ...]        default: 4000 6000      (writes docs/results/run-admission-simulation.md)
//
// Method (each part is stated so it can be checked):
//  - The plan of each run is built by the browser client's own chunker and planEntry() on the sample documents, so the sizes and
//    expected values are what a real run would send.
//  - Admission, the hold, settlement and release are the Worker's own ledger code (services/extraction-api/src/admission.ts) over
//    SQLite, with the Worker's own pricing (cost.ts, run-plan.ts) at the published rates and the 1.1 margin.
//  - What each chunk actually costs comes from the token usage of REAL recorded Llama 3.3 70B requests (listed below). When the plan
//    has the same number of parts as the recording, usage is matched part by part. When it has not (the full-length set was recorded
//    with an earlier chunker: 12 requests, now 9), the recorded TOTALS are spread over the parts: completion tokens by the number of
//    recorded claims in each part (the recorded fixture IS the recorded output), prompt tokens by request size plus a fixed 350 tokens
//    of instructions per request. This is an estimate from one recorded run of each kind: other documents will differ.
//  - Runs happen one after another (concurrency 1) until the first refusal. A refusal is the up-front refusal: nothing is sent.
//  - "Previous scheme" = each request reserved on its own at the profile's whole output allowance, as before this change: it admits
//    requests one by one and can stop in the middle of a run.
import { writeFileSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Block } from '@skeleton-key/engine';
import { parsePdf } from '@skeleton-key/ingest';
import { chunkForSchema } from '../../packages/ui/src/schema-fields';
import { planEntry } from '../../packages/ui/src/extraction-client';
import { budgetOn, closeRun, initLedger, openRun, reserve, reserveInRun, settle, settleInRun, type SqlLike } from '../../services/extraction-api/src/admission';
import { charge, reservation } from '../../services/extraction-api/src/cost';
import { buildMessages, PROFILES } from '../../services/extraction-api/src/profiles';
import { plannedNeurons } from '../../services/extraction-api/src/run-plan';

const ROOT = new URL('../../', import.meta.url).pathname;
const DAY = Date.UTC(2026, 10, 3, 12);
const CEILING = 40;

type Usage = [prompt: number, completion: number];
type Kind = { name: string; fixture: string; pdfs: Record<string, string>; schemas: Record<string, string>; usage: Usage[]; source: string };

const KINDS: Kind[] = [
  {
    name: 'ScopeCheck full-length set (tender + 2 quotations)',
    fixture: 'samples/fixtures/scopecheck-fulllength.json',
    pdfs: { rfq: 'samples/scopecheck-fresh/rfq.pdf', 'quote-a': 'samples/scopecheck-fresh/quote-a.pdf', 'quote-b': 'samples/scopecheck-fresh/quote-b.pdf' },
    schemas: { rfq: 'scopecheck.rfq.v1', 'quote-a': 'scopecheck.quote.v1', 'quote-b': 'scopecheck.quote.v1' },
    // SC-T12 fresh, 12 requests (raw-sc-t12-fresh*.jsonl)
    usage: [[770, 347], [443, 565], [435, 527], [578, 122], [486, 321], [459, 482], [444, 507], [587, 507], [509, 540], [471, 521], [465, 518], [570, 369]],
    source: 'SC-T12 fresh set, 12 requests (raw logs in samples/benchmark-results)',
  },
  {
    name: 'ScopeCheck small set (RFQ + 2 quotations)',
    fixture: 'samples/fixtures/scopecheck-standard.json',
    pdfs: { rfq: 'samples/scopecheck/rfq.pdf', 'quote-a': 'samples/scopecheck/quote-a.pdf', 'quote-b': 'samples/scopecheck/quote-b.pdf' },
    schemas: { rfq: 'scopecheck.rfq.v1', 'quote-a': 'scopecheck.quote.v1', 'quote-b': 'scopecheck.quote.v1' },
    usage: [[405, 339], [478, 528], [419, 317]],
    source: 'live-repeat-rfq, live-repeat-quote-a, live-quote-b (2026-11-01)',
  },
  {
    name: 'PackCheck pack (4 documents)',
    fixture: 'samples/fixtures/packcheck-pack.json',
    pdfs: { requirements: 'samples/packcheck/requirements.pdf', 'application-form': 'samples/packcheck/application-form.pdf', budget: 'samples/packcheck/budget.pdf', registration: 'samples/packcheck/registration.pdf' },
    schemas: { requirements: 'packcheck.grant.v2', 'application-form': 'packcheck.grant.v2', budget: 'packcheck.grant.v2', registration: 'packcheck.grant.v2' },
    usage: [[557, 143], [618, 285], [581, 256], [508, 43]],
    source: 'live-packcheck-*-v2 (2026-11-01)',
  },
];

function db(): SqlLike {
  const d = new DatabaseSync(':memory:');
  const sql: SqlLike = {
    exec: (q: string, ...b: unknown[]) => {
      const st = d.prepare(q);
      if (st.columns().length === 0) { st.run(...(b as never[])); return { toArray: () => [] }; }
      return { toArray: () => st.all(...(b as never[])) };
    },
  };
  initLedger(sql);
  return sql;
}
const tx = <T>(s: SqlLike, f: () => T): T => { s.exec('BEGIN'); try { const r = f(); s.exec('COMMIT'); return r; } catch (e) { s.exec('ROLLBACK'); throw e; } };

type Chunk = { schemaId: string; blocks: Block[]; doc: string };
async function chunksOf(kind: Kind): Promise<Chunk[]> {
  // The client parses the PDFs itself (with layout and table cells), and chunks what it parsed: so does this.
  const out: Chunk[] = [];
  for (const [doc, path] of Object.entries(kind.pdfs)) {
    const blocks = await parsePdf(new Uint8Array(readFileSync(join(path))), doc);
    for (const c of chunkForSchema(kind.schemas[doc]!, blocks).chunks) out.push({ schemaId: kind.schemas[doc]!, blocks: c, doc });
  }
  return out;
}
const join = (p: string) => ROOT + p;

type Result = { ceilingRuns80?: number; kind: Kind; budget: number; chunks: number; hold: number; actualPerRun: number; fullRuns: number; neuronsAfter: number; refusal: string; truncated: number; capHits: string; old: { fullRuns: number; partial: string; neuronsAfter: number } };

const FIXED_PROMPT_TOKENS = 350;

function usageFor(kind: Kind, plan: { c: Chunk; entry: { bodyBytes: number } }[]): Usage[] {
  if (plan.length === kind.usage.length) return kind.usage;
  const fx = JSON.parse(readFileSync(join(kind.fixture), 'utf8')) as { docs: { id: string; claims: { blockId?: string }[] }[] };
  // Block ids repeat between documents (p1-l5 ...), so a part's recorded claims are those of ITS document on ITS blocks.
  const counts = plan.map((p) => {
    const ids = new Set(p.c.blocks.map((b) => b.id));
    return fx.docs.find((d) => d.id === p.c.doc)!.claims.filter((c) => ids.has(c.blockId ?? '')).length;
  });
  const sumClaims = counts.reduce((n, c) => n + c, 0) || 1;
  const sumBytes = plan.reduce((n, p) => n + p.entry.bodyBytes, 0);
  const totalP = kind.usage.reduce((n, u) => n + u[0], 0);
  const totalO = kind.usage.reduce((n, u) => n + u[1], 0);
  const dynamicP = totalP - kind.usage.length * FIXED_PROMPT_TOKENS;
  return plan.map((p, i): Usage => [Math.round(FIXED_PROMPT_TOKENS + dynamicP * (p.entry.bodyBytes / sumBytes)), Math.round(totalO * (counts[i]! / sumClaims))]);
}

async function simulate(kind: Kind, budget: number, ceiling = CEILING): Promise<Result> {
  const chunks = await chunksOf(kind);
  const plan = chunks.map((c) => ({ c, entry: planEntry(c.schemaId, c.blocks) }));
  const planned = plan.map((p) => plannedNeurons(PROFILES[p.c.schemaId]!, p.entry)!);
  const usage = usageFor(kind, plan);
  // The provider enforces max_tokens = the planned cap, so a part whose recorded output is longer is CUT OFF at the cap (and reported
  // as not processed); it is charged for the cap, never more. That is counted below, not hidden.
  const actualCharge = (i: number) => {
    const [p, o] = usage[i]!;
    const model = PROFILES[plan[i]!.c.schemaId]!.model;
    return { neurons: charge(model, p, Math.min(o, planned[i]!.cap))!, completion: o };
  };
  const truncated = plan.filter((_, i) => actualCharge(i).completion > planned[i]!.cap).length;
  const hold = Math.round(planned.reduce((n, p) => n + p.neurons, 0) * 100) / 100;
  const actualPerRun = Math.round(plan.reduce((n, _, i) => n + actualCharge(i).neurons, 0) * 100) / 100;

  // whole-run admission
  const s = db();
  let fullRuns = 0;
  let refusal = 'none';
  for (let i = 0; i < 1000; i++) {
    const o = tx(s, () => openRun(s, { ceiling, budget, token: `t${i}`.padEnd(32, 'x'), chunks: planned, ttlMs: 20 * 60_000, maxOpen: 3 }, DAY));
    if (!o.ok) { refusal = o.reason === 'neurons' ? `refused up front: needs ${o.need.toFixed(0)}, ${o.remaining.toFixed(0)} left` : `refused up front: ${o.reason}`; break; }
    plan.forEach((_, k) => {
      const a = tx(s, () => reserveInRun(s, o.id, `t${i}`.padEnd(32, 'x'), k, planned[k]!.neurons, DAY));
      if (!a.ok) throw new Error(`BUG: an attempt inside an admitted run was refused (${a.reason})`);
      tx(s, () => settleInRun(s, a.id, actualCharge(k).neurons));
    });
    tx(s, () => closeRun(s, o.id, `t${i}`.padEnd(32, 'x'), DAY));
    fullRuns++;
  }
  const neuronsAfter = budgetOn(s, DAY).charged;

  // previous scheme: every request reserved alone at the profile's whole output allowance, settled from its tokens
  const o2 = db();
  let oldFull = 0;
  let partial = 'none';
  outer: for (let i = 0; i < 1000; i++) {
    for (let k = 0; k < plan.length; k++) {
      const prof = PROFILES[plan[k]!.c.schemaId]!;
      const worst = reservation(prof.model, buildMessages(prof, plan[k]!.c.blocks.map((b) => ({ id: b.id, text: b.text })), false), prof.maxOutputTokens)!;
      const r = tx(o2, () => reserve(o2, { ceiling: CEILING, budget, neurons: worst }, DAY));
      if (!r.ok) { partial = k === 0 ? 'none (refused at the first request)' : `a run is cut off after ${k} of ${plan.length} requests`; break outer; }
      tx(o2, () => settle(o2, r.id, actualCharge(k).neurons));
    }
    oldFull++;
  }
  return { ceilingRuns80: ceiling === CEILING ? (await simulate(kind, budget, 80)).fullRuns : undefined, kind, budget, chunks: plan.length, hold, actualPerRun, fullRuns, neuronsAfter: Math.round(neuronsAfter), refusal, truncated, capHits: truncated ? `${truncated} of ${plan.length} recorded outputs are above their cap` : 'none', old: { fullRuns: oldFull, partial, neuronsAfter: Math.round(budgetOn(o2, DAY).charged) } };
}

const budgets = process.argv.slice(2).map(Number).filter((n) => n > 0);
const B = budgets.length ? budgets : [4000, 6000];
const results: Result[] = [];
for (const b of B) for (const k of KINDS) results.push(await simulate(k, b));

const lines: string[] = [];
lines.push('# Whole-run admission: simulated full runs per day', '', `Generated by \`npx tsx tools/deploy/simulate-runs.ts ${B.join(' ')}\` (no inference, no network). Attempt ceiling ${CEILING}. See the header of that file for the method; every figure is an **estimate from one recorded run of each kind**, not a guarantee.`, '');
for (const b of B) {
  lines.push(`## Daily budget ${b.toLocaleString('en-US')} estimated neurons`, '', '| Run | Parts | Held at admission | Actual per run (est.) | **Full runs per day** | Then | If the attempt ceiling were 80 | Previous scheme: full runs, then |', '|---|---|---|---|---|---|---|---|');
  for (const r of results.filter((x) => x.budget === b)) lines.push(`| ${r.kind.name} | ${r.chunks} | ${r.hold} | ${r.actualPerRun} | **${r.fullRuns}** | ${r.refusal} | ${r.ceilingRuns80} | ${r.old.fullRuns}, then ${r.old.partial} |`);
  lines.push('');
}
lines.push('## Checks the simulation makes', '');
for (const r of results.filter((x) => x.budget === B[0])) lines.push(`- ${r.kind.name}: recorded token usage from ${r.kind.source}. Cap check: ${r.capHits}.`);
lines.push('', '"Held at admission" is the worst case of the whole run (exact input bound plus the enforced output cap, one attempt per part). "Actual per run" is what the recorded tokens cost; the difference is released when the run ends, so it is available to the next run. "Cap check" counts recorded outputs that would not have fitted under the output cap the plan would have enforced: such a part would be reported as not processed (never silently wrong); 0 means every recorded answer fitted.');
writeFileSync(join('docs/results/run-admission-simulation.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
