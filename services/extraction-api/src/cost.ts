// Neuron cost model used by the Worker for reservations and settlement. These are ESTIMATES, not consumption.
//
// Assumptions behind the reservation bound (docs/task-5-5-plan.md section 2); each one is stated so it can be checked:
//  A1 Rates: Cloudflare's published neuron rates for the model, 26,668 per million input tokens and 204,805 per million output
//     tokens (supplied by the owner 2 Nov 2026; the pricing page cannot be fetched from the sandbox). Two dashboard comparisons:
//     checkpoint 1 (462.81 measured against 462.76 estimated under the earlier price-derived rates, 5 attempts) and the task 5.5
//     gated test (dashboard increase 321.65 against 321.654982 at these rates, 4 attempts, 3,414 in / 1,126 out). The earlier
//     price-derived rates (26,636 / 204,818, from USD at $0.011 per 1,000 neurons) differ by about 0.03% on that run and remain
//     in the historical records. A model not listed here has no rate: the Worker refuses to call it.
//  A2 Margin: x1.1 on every reservation and every settlement, so the two are comparable.
//  A3 Input tokens <= UTF-8 bytes of the messages + PROMPT_OVERHEAD_TOKENS. A byte-level BPE token covers at least one byte, so
//     the text part is a guaranteed bound; the overhead covers the chat template and anything the provider adds. Evidence that
//     the provider adds little: observed 4.45 to 5.40 bytes per reported prompt token over 14 live requests, small ones included.
//  A4 Output tokens <= the profile's max_tokens (the provider enforces it; no completion above the cap has been observed).
//  A5 One model call per admitted attempt. A call the Worker gave up on (timeout) may still finish and consume; its
//     reservation stands because its usage never reaches the Worker.
// Settlement charges the reported tokens at the same rates and margin, in full (an overrun is recorded, never clipped). When a
// call reports no usage, or fails, the reservation stands. A recorded overrun locks the UTC day against further admissions
// (admission.ts), and a settlement the ledger cannot record stops the request before any repair (handler.ts).

export const PROMPT_OVERHEAD_TOKENS = 64;
export const SAFETY_MARGIN = 1.1;
export const BYTES_PER_TOKEN = 1; // guaranteed bound (A3); the benchmark's calibrated bound of 2 is not used here

export const NEURONS_PER_MILLION: Record<string, { input: number; output: number }> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 26_668, output: 204_805 },
};

const up = (n: number) => Math.ceil(n * 1000) / 1000; // charges round UP: never under-count

/** Estimated neurons for a number of tokens, or null if the model has no rate (fail closed). */
export function charge(model: string, promptTokens: number, completionTokens: number): number | null {
  const r = Object.prototype.hasOwnProperty.call(NEURONS_PER_MILLION, model) ? NEURONS_PER_MILLION[model]! : null;
  if (!r) return null;
  return up(((promptTokens * r.input + completionTokens * r.output) / 1_000_000) * SAFETY_MARGIN);
}

const utf8 = (s: string) => new TextEncoder().encode(s).byteLength;

/** Worst case of one attempt: the exact messages to be sent, and the whole output allowance. */
export function reservation(model: string, messages: { content: string }[], maxTokens: number): number | null {
  const bytes = messages.reduce((n, m) => n + utf8(m.content), 0);
  return charge(model, Math.ceil(bytes / BYTES_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS, maxTokens);
}

/** Settlement charge from reported usage, or null when usage is missing or malformed (the reservation then stands). */
export function settlementCharge(model: string, usage: unknown): number | null {
  const u = usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | null | undefined;
  const p = u?.prompt_tokens;
  const c = u?.completion_tokens;
  if (typeof p !== 'number' || typeof c !== 'number' || !Number.isFinite(p) || !Number.isFinite(c) || p < 0 || c < 0) return null;
  return charge(model, p, c);
}
