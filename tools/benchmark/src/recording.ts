import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Ai } from './ai';

// RAW model responses, saved one JSON line per event as it happens, so nothing is lost if a later step fails. A "start" line is
// written before the call is made and an "end" line when it settles (also for a call the Worker has already given up on, such as
// one that outlived the timeout). The prompt itself is not stored, only its size and SHA-256; what is stored is exactly what the
// model returned (output and reported usage) or the error message. No credential ever passes through here.

export function recordingAi(ai: Ai, file: string, now: () => number = Date.now): Ai & { calls: number } {
  const state = { calls: 0 };
  const write = (o: unknown) => appendFileSync(file, JSON.stringify(o) + '\n');
  return Object.assign(state, {
    async run(model: string, input: unknown) {
      const n = ++state.calls;
      const prompt = JSON.stringify(input);
      const meta = { n, model, promptBytes: Buffer.byteLength(prompt, 'utf8'), promptSha256: createHash('sha256').update(prompt).digest('hex') };
      const t0 = now();
      write({ evt: 'start', ...meta, at: new Date(t0).toISOString() });
      try {
        const output = await ai.run(model, input);
        write({ evt: 'end', n, ok: true, ms: now() - t0, at: new Date().toISOString(), output });
        return output;
      } catch (e) {
        write({ evt: 'end', n, ok: false, ms: now() - t0, at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
  });
}
