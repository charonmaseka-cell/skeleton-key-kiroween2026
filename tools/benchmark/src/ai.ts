import type { ExpectedFact, Sample } from './samples';

export type Ai = { run(model: string, input: unknown): Promise<unknown> };

/**
 * Live model client over the Cloudflare REST API. Credentials come from the environment
 * (names only are checked elsewhere) and are never logged or included in thrown errors.
 */
export function restAi(accountId: string, apiToken: string, fetchImpl: typeof fetch = fetch): Ai {
  return {
    async run(model, input) {
      const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      let body: { success?: boolean; result?: unknown; errors?: { code?: number; message?: string }[] } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        // non-JSON body
      }
      if (!res.ok || body.success === false) {
        const detail = (body.errors ?? []).map((e) => `${e.code ?? ''} ${e.message ?? ''}`).join('; ');
        // Error text is used only for classification by the Worker handler and is never returned to clients.
        throw new Error(`workers-ai http ${res.status} ${detail}`.trim());
      }
      return body.result;
    },
  };
}

// ---------------- Mock model (test harness only; never used for live results) ----------------

export type MockDefects = {
  /** skip these expected facts (simulates a model that misses a line) */
  omit?: (docId: string, fact: ExpectedFact) => boolean;
  /** add claims the source does not support */
  hallucinate?: boolean;
  /** add a claim citing a block that was never sent */
  unknownBlock?: boolean;
  /** add a claim for a field outside the profile */
  outOfProfile?: boolean;
  /** first response is not valid JSON (forces a repair attempt) */
  badJsonFirst?: boolean;
  /** every response is invalid JSON (repair is attempted and also fails) */
  badJsonAlways?: boolean;
  /** strip item codes such as "CP-100" from item values while keeping the cited excerpt (what the live model did on the RFQ and quote-b) */
  dropItemCodes?: boolean;
  /** drop the magnitude word from money values ("R1.6 million" -> amount "1.6"), as the live model did with packcheck.grant.v1 */
  dropMagnitude?: boolean;
  /** a call whose chunk matches this predicate fails (a chunk that is never processed) */
  failChunkWhen?: (blocks: { id: string; text: string }[]) => boolean;
  /** a call whose chunk matches this predicate succeeds but returns no claims (a chunk the model missed) */
  emptyChunkWhen?: (blocks: { id: string; text: string }[]) => boolean;
  /** make every call fail with this message */
  fail?: string;
};

export function oracleAi(samples: Sample[], defects: MockDefects = {}): Ai & { calls: number } {
  let calls = 0;
  const self = {
    get calls() {
      return calls;
    },
    async run(_model: string, input: unknown) {
      calls++;
      if (defects.fail) throw new Error(defects.fail);
      if (defects.badJsonAlways) return { response: 'not json', usage: { prompt_tokens: 100, completion_tokens: 3 } };
      if (defects.badJsonFirst && calls === 1) return { response: 'not json', usage: { prompt_tokens: 100, completion_tokens: 3 } };
      const user = (input as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === 'user')!.content;
      const sent = (JSON.parse(user.slice(user.indexOf('\n') + 1)) as { blocks: { id: string; text: string }[] }).blocks;
      if (defects.failChunkWhen?.(sent)) throw new Error('upstream error on this chunk');
      const claims: Record<string, unknown>[] = [];
      if (defects.emptyChunkWhen?.(sent)) return { response: { claims }, usage: { prompt_tokens: 100, completion_tokens: 5 } };
      for (const sample of samples) {
        for (const doc of sample.docs) {
          for (const f of doc.facts) {
            if (defects.omit?.(doc.id, f)) continue;
            const block = sent.find((b) => b.text === doc.lines[f.line]);
            if (!block) continue;
            let value = f.value === null && f.kind === 'date' ? '2026-03-01' : f.value; // a plausible reading of an ambiguous date
            if (defects.dropMagnitude && f.kind === 'money' && /million/i.test(f.excerpt)) value = { amount: '1.6', currency: 'ZAR' };
            if (defects.dropItemCodes && f.field === 'item' && typeof value === 'string') value = value.replace(/\b[A-Za-z]{1,4}-\d+\s*/g, '').trim();
            claims.push({ field: f.field, blockId: block.id, excerpt: f.excerpt, value });
          }
        }
      }
      const first = sent[0]?.id ?? 'x';
      if (defects.hallucinate) claims.push({ field: 'quantity', blockId: first, excerpt: sent[0]?.text ?? 'x', value: { value: '999', unit: null } });
      if (defects.unknownBlock) claims.push({ field: 'item', blockId: 'zz-not-sent', excerpt: 'invented', value: 'invented' });
      if (defects.outOfProfile) claims.push({ field: 'secret', blockId: first, excerpt: 'x', value: 'x' });
      const response = { claims };
      return { response, usage: { prompt_tokens: Math.ceil(JSON.stringify(input).length / 4), completion_tokens: Math.ceil(JSON.stringify(response).length / 4) } };
    },
  };
  return self;
}
