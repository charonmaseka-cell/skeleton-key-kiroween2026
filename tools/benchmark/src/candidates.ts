import type { Ai } from './ai';

// Benchmark configuration for model candidates (spec tasks 5.3, 5.4).
//
// Model selection is confined to the benchmark. The Worker still takes its model from the server
// profile, clients cannot send a model (the request schema rejects it), and nothing in
// services/extraction-api references a candidate. A candidate is applied BELOW the Worker handler,
// at the model client, so the profile text, chunks, output limits, validators and identity resolver
// are exactly the ones the baseline run used. Only the model changes.

export const BASELINE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const SECOND_CANDIDATE = '@cf/meta/llama-3.1-8b-instruct';

export type ModelConfig = {
  id: string;
  role: 'baseline' | 'candidate';
  /** neurons per million tokens, used ONLY to ESTIMATE neurons from measured tokens */
  neuronsPerMillion: { input: number; output: number };
  /** how far to trust the rates above */
  ratesBasis: string;
};

export const MODELS: Record<string, ModelConfig> = {
  [BASELINE_MODEL]: {
    id: BASELINE_MODEL,
    role: 'baseline',
    neuronsPerMillion: { input: 26_636, output: 204_818 },
    ratesBasis: 'PUBLISHED RATES, approximate: USD per million tokens ($0.293 input, $2.253 output) divided by $0.011 per 1,000 neurons. These are prices, not consumption. Dashboard-confirmed consumption exists only as one aggregate at checkpoint 1 (462.81 neurons against 462.76 estimated); no per-request figure has been confirmed.',
  },
  [SECOND_CANDIDATE]: {
    id: SECOND_CANDIDATE,
    role: 'candidate',
    neuronsPerMillion: { input: 25_608, output: 75_147 },
    ratesBasis: 'UNVERIFIED RATES: approximately $0.28 input and $0.83 output per million tokens converted at $0.011 per 1,000 neurons. Cloudflare\'s pricing page could not be fetched from the sandbox (HTTP 403), so these come from secondary sources. No dashboard-confirmed consumption exists for this model yet.',
  },
};

export function modelConfig(id: string): ModelConfig {
  const m = MODELS[id];
  if (!m) throw new Error(`unknown model "${id}": add it to tools/benchmark/src/candidates.ts first`);
  return m;
}

/**
 * Wraps a model client so every call uses `model`, whatever the server profile asked for.
 * Applied only by the benchmark CLI; the Worker never sees it.
 */
export function withModel(ai: Ai, model: string): Ai {
  return { run: (_profileModel: string, input: unknown) => ai.run(model, input) };
}
