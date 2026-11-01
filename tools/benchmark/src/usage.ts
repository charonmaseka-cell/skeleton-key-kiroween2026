// Usage reporting that keeps measured values and estimates apart.
//  - Token counts are MEASURED only when the model response reports them.
//  - Neurons are an ESTIMATE derived from tokens, unless the user supplies a figure read from the
//    Cloudflare dashboard (then labelled as such). Per-request neuron counts are not returned by the API.

import { BASELINE_MODEL, modelConfig } from './candidates';

/** Kept for compatibility: the baseline model's rates. See candidates.ts for every model. */
export const NEURON_RATES = {
  model: BASELINE_MODEL,
  inputPerMillionTokens: modelConfig(BASELINE_MODEL).neuronsPerMillion.input,
  outputPerMillionTokens: modelConfig(BASELINE_MODEL).neuronsPerMillion.output,
  basis: modelConfig(BASELINE_MODEL).ratesBasis,
} as const;

export type NeuronBasis = 'estimated_from_tokens' | 'measured_by_user_from_dashboard' | 'mock_estimate' | 'unavailable';
export type TokenSource = 'measured' | 'partial' | 'unavailable' | 'mock';

export type UsageSummary = {
  requests: number;
  requestsReportingTokens: number;
  promptTokens: number | null;
  completionTokens: number | null;
  tokenSource: TokenSource;
  neurons: { value: number | null; basis: NeuronBasis; note: string };
};

export const estimateNeurons = (prompt: number, completion: number, model: string = BASELINE_MODEL): number => {
  const r = modelConfig(model).neuronsPerMillion;
  return (prompt * r.input + completion * r.output) / 1_000_000;
};

export function summarizeUsage(
  reports: ({ promptTokens: number | null; completionTokens: number | null } | null)[],
  opts: { mock: boolean; measuredNeurons?: number; model?: string },
): UsageSummary {
  const withTokens = reports.filter((r): r is { promptTokens: number; completionTokens: number } => !!r && r.promptTokens !== null && r.completionTokens !== null);
  const prompt = withTokens.reduce((n, r) => n + r.promptTokens, 0);
  const completion = withTokens.reduce((n, r) => n + r.completionTokens, 0);
  const tokenSource: TokenSource = opts.mock ? 'mock' : withTokens.length === 0 ? 'unavailable' : withTokens.length === reports.length ? 'measured' : 'partial';
  let neurons: UsageSummary['neurons'];
  if (opts.measuredNeurons !== undefined && !opts.mock) {
    neurons = { value: opts.measuredNeurons, basis: 'measured_by_user_from_dashboard', note: 'Figure supplied by the user from the Cloudflare dashboard.' };
  } else if (withTokens.length === 0) {
    neurons = { value: null, basis: 'unavailable', note: 'No token usage was reported.' };
  } else {
    neurons = {
      value: Math.round(estimateNeurons(prompt, completion, opts.model)),
      basis: opts.mock ? 'mock_estimate' : 'estimated_from_tokens',
      note: opts.mock ? 'Synthetic tokens from the mock model; not a real measurement.' : `ESTIMATE from measured tokens. ${modelConfig(opts.model ?? BASELINE_MODEL).ratesBasis}`,
    };
  }
  return {
    requests: reports.length,
    requestsReportingTokens: withTokens.length,
    promptTokens: withTokens.length ? prompt : null,
    completionTokens: withTokens.length ? completion : null,
    tokenSource,
    neurons,
  };
}
