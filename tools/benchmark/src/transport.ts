import { toRequestBlock, type Block } from '@skeleton-key/engine';
import type { AdmitResult } from '../../../services/extraction-api/src/admission';
import type { EnvVars } from '../../../services/extraction-api/src/config';
import { handle } from '../../../services/extraction-api/src/handler';
import type { Ai } from './ai';

export type ExtractMeta = {
  attempts: number;
  repaired: boolean;
  dropped: number;
  droppedReasons: Record<string, number>;
  usage: { promptTokens: number | null; completionTokens: number | null };
};

export type ExtractResult =
  | { ok: true; claims: unknown[]; meta: ExtractMeta; ms: number; attemptsCharged: number }
  | { ok: false; status: number; code: string; ms: number; attemptsCharged: number };

export interface Transport {
  extract(schemaId: string, blocks: Pick<Block, 'id' | 'text' | 'layout' | 'cells'>[]): Promise<ExtractResult>;
}

export type Counter = { admit(ceiling: number, nowMs: number): Promise<AdmitResult>; usedToday?(nowMs: number): number };

const ORIGIN = 'http://localhost:5173';

/**
 * Runs the real Worker request handler in-process (same validation, profiles, admission and
 * error mapping as the deployed Worker) with a supplied model client and admission counter.
 */
export class LocalTransport implements Transport {
  constructor(
    private readonly opts: { ai: Ai; counter: Counter; env: EnvVars; now?: () => number },
  ) {}

  async extract(schemaId: string, blocks: Pick<Block, 'id' | 'text' | 'layout' | 'cells'>[]): Promise<ExtractResult> {
    const now = this.opts.now ?? Date.now;
    // Attempts are counted per request (every admission this request was granted), not as a difference of the shared daily
    // counter, so requests running at the same time cannot be charged for each other's attempts.
    let granted = 0;
    const counter = { admit: async (ceiling: number, nowMs: number) => { const r = await this.opts.counter.admit(ceiling, nowMs); if (r.ok) granted++; return r; } };
    const started = performance.now();
    const res = await handle(
      new Request('https://worker.local/extract', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ schemaId, blocks: blocks.map((b) => toRequestBlock(b as Block)) }),
      }),
      { ALLOWED_ORIGINS: ORIGIN, ACCESS_GATE: 'public', ...this.opts.env },
      { now, counter, ai: this.opts.ai, log: () => undefined },
    );
    const ms = Math.round(performance.now() - started);
    const json = (await res.json()) as { claims?: unknown[]; meta?: ExtractMeta & { usage: ExtractMeta['usage'] }; error?: { code: string } };
    const charged = granted;
    if (res.status === 200 && json.claims && json.meta) return { ok: true, claims: json.claims, meta: json.meta, ms, attemptsCharged: charged };
    return { ok: false, status: res.status, code: json.error?.code ?? 'unknown', ms, attemptsCharged: charged };
  }
}

/** HTTP transport for a running Worker (e.g. `wrangler dev` or a deployment). */
export class HttpTransport implements Transport {
  constructor(private readonly url: string, private readonly origin: string, private readonly worstCaseAttempts = 2) {}

  async extract(schemaId: string, blocks: Pick<Block, 'id' | 'text' | 'layout' | 'cells'>[]): Promise<ExtractResult> {
    const started = performance.now();
    const res = await fetch(`${this.url.replace(/\/$/, '')}/extract`, {
      method: 'POST',
      headers: { origin: this.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ schemaId, blocks: blocks.map((b) => toRequestBlock(b as Block)) }),
    });
    const ms = Math.round(performance.now() - started);
    const json = (await res.json()) as { claims?: unknown[]; meta?: ExtractMeta; error?: { code: string } };
    if (res.status === 200 && json.claims && json.meta) return { ok: true, claims: json.claims, meta: json.meta, ms, attemptsCharged: json.meta.attempts };
    // Unknown consumption on failure: assume the worst case so budgets stay conservative.
    return { ok: false, status: res.status, code: json.error?.code ?? 'unknown', ms, attemptsCharged: this.worstCaseAttempts };
  }
}

/**
 * Offline replay of claims saved by an earlier run. No model is called and nothing is charged;
 * claims are re-validated against the re-parsed document, so findings can be recomputed across
 * documents that were processed in separate runs. Block IDs are only unique within a document, so
 * each saved claim set is matched to a chunk only if every claim's block ID exists in it and its
 * excerpt occurs in that block's text, and each saved set is used once.
 */
export class ReplayTransport implements Transport {
  private readonly unused: unknown[][];
  constructor(saved: unknown[][]) {
    this.unused = [...saved];
  }

  async extract(_schemaId: string, blocks: Pick<Block, 'id' | 'text'>[]): Promise<ExtractResult> {
    const byId = new Map(blocks.map((b) => [b.id, b.text]));
    const fits = (set: unknown[]) =>
      set.length > 0 && set.every((c) => {
        const { blockId, excerpt } = c as { blockId?: string; excerpt?: string };
        const text = blockId ? byId.get(blockId) : undefined;
        return text !== undefined && typeof excerpt === 'string' && text.includes(excerpt);
      });
    const idx = this.unused.findIndex(fits);
    if (idx < 0) return { ok: false, status: 0, code: 'replay_no_saved_claims_for_chunk', ms: 0, attemptsCharged: 0 };
    const [claims] = this.unused.splice(idx, 1);
    return { ok: true, claims: claims!, ms: 0, attemptsCharged: 0, meta: { attempts: 0, repaired: false, dropped: 0, droppedReasons: {}, usage: { promptTokens: null, completionTokens: null } } };
  }
}
