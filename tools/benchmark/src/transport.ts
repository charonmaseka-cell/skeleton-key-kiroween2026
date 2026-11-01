import type { Block } from '@skeleton-key/engine';
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
  extract(schemaId: string, blocks: Pick<Block, 'id' | 'text'>[]): Promise<ExtractResult>;
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

  async extract(schemaId: string, blocks: Pick<Block, 'id' | 'text'>[]): Promise<ExtractResult> {
    const now = this.opts.now ?? Date.now;
    const before = this.opts.counter.usedToday?.(now()) ?? 0;
    const started = performance.now();
    const res = await handle(
      new Request('https://worker.local/extract', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ schemaId, blocks: blocks.map((b) => ({ id: b.id, text: b.text })) }),
      }),
      { ALLOWED_ORIGINS: ORIGIN, ...this.opts.env },
      { now, counter: this.opts.counter, ai: this.opts.ai, log: () => undefined },
    );
    const ms = Math.round(performance.now() - started);
    const json = (await res.json()) as { claims?: unknown[]; meta?: ExtractMeta & { usage: ExtractMeta['usage'] }; error?: { code: string } };
    const after = this.opts.counter.usedToday?.(now()) ?? before;
    const charged = this.opts.counter.usedToday ? after - before : (json.meta?.attempts ?? 1);
    if (res.status === 200 && json.claims && json.meta) return { ok: true, claims: json.claims, meta: json.meta, ms, attemptsCharged: charged };
    return { ok: false, status: res.status, code: json.error?.code ?? 'unknown', ms, attemptsCharged: charged };
  }
}

/** HTTP transport for a running Worker (e.g. `wrangler dev` or a deployment). */
export class HttpTransport implements Transport {
  constructor(private readonly url: string, private readonly origin: string, private readonly worstCaseAttempts = 2) {}

  async extract(schemaId: string, blocks: Pick<Block, 'id' | 'text'>[]): Promise<ExtractResult> {
    const started = performance.now();
    const res = await fetch(`${this.url.replace(/\/$/, '')}/extract`, {
      method: 'POST',
      headers: { origin: this.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ schemaId, blocks: blocks.map((b) => ({ id: b.id, text: b.text })) }),
    });
    const ms = Math.round(performance.now() - started);
    const json = (await res.json()) as { claims?: unknown[]; meta?: ExtractMeta; error?: { code: string } };
    if (res.status === 200 && json.claims && json.meta) return { ok: true, claims: json.claims, meta: json.meta, ms, attemptsCharged: json.meta.attempts };
    // Unknown consumption on failure: assume the worst case so budgets stay conservative.
    return { ok: false, status: res.status, code: json.error?.code ?? 'unknown', ms, attemptsCharged: this.worstCaseAttempts };
  }
}
