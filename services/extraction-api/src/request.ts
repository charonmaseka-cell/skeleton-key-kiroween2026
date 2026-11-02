import { z } from 'zod';

/**
 * True when each cell occurs in `text`, in order, without overlapping the one before. Kept here (the Worker is bundled on its own,
 * without the engine package); a test checks it agrees with the engine's `cellsInOrder`.
 */
export function cellsInOrder(text: string, cells: string[]): boolean {
  let from = 0;
  for (const c of cells) {
    const at = text.indexOf(c, from);
    if (at < 0) return false;
    from = at + c.length;
  }
  return true;
}
import type { Config } from './config';

// Bounded request reading and validation. The body is counted as it streams, so a
// missing or false Content-Length cannot get an oversized body past the limit.

export type ReadResult = { ok: true; text: string } | { ok: false; reason: 'too_large' | 'invalid_input' };

export async function readBounded(request: Request, maxBytes: number): Promise<ReadResult> {
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) return { ok: false, reason: 'too_large' };
  if (!request.body) return { ok: false, reason: 'invalid_input' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf) };
  } catch {
    return { ok: false, reason: 'invalid_input' };
  }
}

// Strict: unknown keys (filenames, prompts, model names, token limits...) are rejected.
const BodySchema = z
  .object({
    schemaId: z.string().min(1).max(64),
    // `cells` (optional): the text of each table column of the line, in order, each an exact substring of `text`. The parser sets it
    // only for lines it found genuinely positioned in columns; it is checked here, and `text` stays the evidence source.
    blocks: z.array(z.object({ id: z.string().min(1).max(64), text: z.string(), cells: z.array(z.string().min(1).max(2000)).min(2).max(16).optional() }).strict()).min(1),
  })
  .strict();

export type ExtractRequest = z.infer<typeof BodySchema>;

export type ParseResult = { ok: true; value: ExtractRequest } | { ok: false; reason: 'too_large' | 'invalid_input' };

export function parseExtractRequest(text: string, cfg: Config): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid_input' };
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };
  const { blocks } = parsed.data;
  if (blocks.length > cfg.maxBlocks) return { ok: false, reason: 'too_large' };
  if (new Set(blocks.map((b) => b.id)).size !== blocks.length) return { ok: false, reason: 'invalid_input' };
  let chars = 0;
  for (const b of blocks) {
    if (b.text.length > cfg.maxBlockChars) return { ok: false, reason: 'too_large' };
    if (b.cells && !cellsInOrder(b.text, b.cells)) return { ok: false, reason: 'invalid_input' };
    chars += b.text.length + (b.cells ?? []).reduce((n, c) => n + c.length, 0); // cells repeat text, so they count toward the input bound
  }
  if (chars > cfg.maxChars) return { ok: false, reason: 'too_large' };
  return { ok: true, value: parsed.data };
}
