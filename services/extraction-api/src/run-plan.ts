import { PROMPT_OVERHEAD_TOKENS, BYTES_PER_TOKEN, charge } from './cost';
import { buildMessages, CELLS_RULE, type Profile } from './profiles';

// The worst case of one chunk, computed from the client's chunk plan WITHOUT its text: the schema, the exact size of the request
// body, and the number of values the chunk is expected to return. Used to hold a whole run before anything is sent (admission.ts).
//
//  Input:  the messages are the profile's fixed instructions (with the table-cells rule, the larger case), the fixed user wrapper,
//          and the request's blocks, whose JSON is at most the request body. Same guaranteed bound as a single attempt (cost.ts A3).
//  Output: ENFORCED. An in-run call is made with max_tokens = the cap below, so the provider cannot return more than was held. The
//          cap is generous against what was measured (122 to 565 completion tokens for parts of up to 14 values; 1.5 x the estimate
//          of about 42 tokens per value plus 60 fixed, for at least the chunker's 14-value design maximum = 972), never above the
//          profile's own maximum. If the model needs more than the cap
//          the output is cut off and that chunk is reported as not processed; the run itself is never cut off by the budget.
//  One attempt per chunk: no automatic repair inside a run (a repair would need a second, unheld reservation).

export const OUTPUT_TOKENS_PER_VALUE = 42;
export const OUTPUT_FIXED_TOKENS = 60;
export const OUTPUT_HEADROOM = 1.5;
/** The client chunker keeps every part to at most this many expected values (packages/ui/src/schema-fields.ts MAX_VALUES_PER_REQUEST). */
export const DESIGN_MAX_VALUES = 14;
export const MAX_PLAN_VALUES = 40;
export const MAX_PLAN_CHUNKS = 48;

/**
 * The cap is never below what the chunker's own design maximum (14 values) needs, whatever the plan's estimate says: the estimate is
 * low for table rows (the RFQ's positioned rows count 0 or 1), and a recorded answer of 565 tokens came from such a part. A part the
 * plan says has more values gets a larger cap, up to the profile's own maximum.
 */
export const outputCap = (values: number, profileMax: number): number =>
  Math.min(profileMax, Math.ceil(OUTPUT_HEADROOM * (OUTPUT_FIXED_TOKENS + OUTPUT_TOKENS_PER_VALUE * Math.min(Math.max(values, DESIGN_MAX_VALUES), MAX_PLAN_VALUES))));

const utf8 = (s: string) => new TextEncoder().encode(s).byteLength;
const WRAPPER_BYTES = utf8('DOCUMENT_DATA (JSON):\n{"blocks":') + utf8('}');

/** Upper bound of the UTF-8 bytes of all messages for a request whose JSON body has `bodyBytes` bytes. */
export function messageBytesBound(profile: Profile, bodyBytes: number): number {
  const fixed = buildMessages(profile, [], false)[0]!.content;
  return utf8(fixed) + utf8(CELLS_RULE) + 1 + WRAPPER_BYTES + bodyBytes;
}

export type ChunkPlan = { schemaId: string; bodyBytes: number; values: number };

/** Worst-case neurons of the chunk's one attempt at its enforced cap, or null when the model has no rate (fail closed). */
export function plannedNeurons(profile: Profile, plan: ChunkPlan): { neurons: number; cap: number } | null {
  const cap = outputCap(plan.values, profile.maxOutputTokens);
  const neurons = charge(profile.model, Math.ceil(messageBytesBound(profile, plan.bodyBytes) / BYTES_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS, cap);
  return neurons === null ? null : { neurons, cap };
}
