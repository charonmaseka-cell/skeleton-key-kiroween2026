import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { estimateNeurons } from './usage';
import type { Ai } from './ai';

// Conservative neuron budget for live runs.
//
// Every inference attempt, including a repair, RESERVES a charge BEFORE the model is called and is refused if the
// reservation would pass either cap:
//   - the run cap: neurons this run may add (default 6,000)
//   - the daily cap: the UTC day's cumulative neurons, baseline included (default 8,000)
//
// THE RESERVATION is `charge(input tokens bound, max_tokens)`:
//   - Output: the whole output allowance (max_tokens), the largest the model can return.
//   - Input: ceil(UTF-8 bytes of the messages / BYTES_PER_TOKEN_BOUND) + PROMPT_OVERHEAD_TOKENS. This is a
//     CALIBRATED bound, not a guarantee. Basis: across 14 single-chunk live requests (2026-11-01) the model
//     reported 4.45 to 5.40 bytes per prompt token (mean 4.73). A bound of 2 bytes per token leaves about 2.2x
//     headroom over the densest observed text. The only GUARANTEED bound is 1 byte per token (a token covers at least
//     one byte), which would reserve 4 to 5 times the measured input; it is available as BYTES_PER_TOKEN_STRICT.
//     Characters divided by three (used before 2026-11-01) was an estimate, and is not used.
//
// THE CHARGE after a call is `charge(reported tokens)`: the FULL estimate from the tokens the model reported. It is
// not capped at the reservation: if the model used more than was reserved, the overrun is recorded, persisted, and
// counted against both caps, so the next reservation is refused when a cap has been passed.
//
// `charge()` is the single place a margin is applied (SAFETY_MARGIN on the published per-token rates, which for the
// candidate model are unverified), for reservations and for settlements alike, so the two are comparable.
//
// When usage is NOT reported (or only partly), or the call fails (timeout, network, quota, schema), the conservative
// reservation STANDS, because the consumption is unknown. The ledger is written to disk after every change, so a
// crashed run cannot forget what it reserved.
//
// These figures are charges against a budget. They are not dashboard-confirmed consumption.

export const BYTES_PER_TOKEN_BOUND = 2;
export const BYTES_PER_TOKEN_STRICT = 1;
export const PROMPT_OVERHEAD_TOKENS = 64; // chat-template tokens around the messages
export const SAFETY_MARGIN = 1.1;

type Input = { messages?: { content?: string }[]; max_tokens?: number };

/** Neurons charged for a number of tokens: published-rate estimate times the one safety margin. */
export function charge(promptTokens: number, completionTokens: number, model: string): number {
  return estimateNeurons(promptTokens, completionTokens, model) * SAFETY_MARGIN;
}

/** Worst-case input and output tokens for one attempt, and what that costs. See the bound above. */
export function worstCaseNeurons(input: unknown, model: string, bytesPerToken = BYTES_PER_TOKEN_BOUND): { neurons: number; promptTokens: number; completionTokens: number } {
  const i = input as Input;
  const bytes = (i.messages ?? []).reduce((n, m) => n + Buffer.byteLength(m.content ?? '', 'utf8'), 0);
  const promptTokens = Math.ceil(bytes / bytesPerToken) + PROMPT_OVERHEAD_TOKENS;
  const completionTokens = i.max_tokens ?? 4096; // unknown output allowance: assume a large one
  return { neurons: charge(promptTokens, completionTokens, model), promptTokens, completionTokens };
}

export class BudgetExceeded extends Error {
  constructor(public readonly cap: 'run' | 'daily', message: string) {
    super(message);
  }
}

export type AttemptCharge = { n: number; reserved: number; charged: number; basis: 'reserved_only' | 'measured' | 'kept_after_error'; promptTokens: number | null; completionTokens: number | null; /** the model reported more than was reserved: the full figure was charged */ overrun: boolean };

export class NeuronBudget {
  readonly attempts: AttemptCharge[] = [];
  private runCharged = 0;
  constructor(
    private readonly o: { model: string; runCap: number; dailyCap: number; dailyBaseline: number; statePath?: string; day: string },
  ) {}

  get runTotal() { return this.runCharged; }
  get dailyTotal() { return this.o.dailyBaseline + this.runCharged; }
  get summary() {
    return { runCap: this.o.runCap, dailyCap: this.o.dailyCap, dailyBaseline: this.o.dailyBaseline, runCharged: round(this.runCharged), dailyAfter: round(this.dailyTotal), attempts: this.attempts.length, overruns: this.attempts.filter((a) => a.overrun).length, capReached: this.capReached };
  }

  /** True once either cap has been reached or passed (for example by an overrun): no further call is allowed. */
  get capReached(): boolean {
    return this.runCharged >= this.o.runCap || this.dailyTotal >= this.o.dailyCap;
  }

  /** Why an attempt of this size cannot be reserved now, or null if it can. */
  refusal(neurons: number): string | null {
    if (this.capReached) return `${this.runCharged >= this.o.runCap ? `run cap ${this.o.runCap}` : `daily cap ${this.o.dailyCap}`} neurons already reached (${round(this.runCharged)} charged this run, ${round(this.dailyTotal)} today)`;
    if (this.runCharged + neurons > this.o.runCap) return `run cap ${this.o.runCap} neurons: ${round(this.runCharged)} charged + ${round(neurons)} reserved would pass it`;
    if (this.dailyTotal + neurons > this.o.dailyCap) return `daily cap ${this.o.dailyCap} neurons: ${round(this.dailyTotal)} charged today + ${round(neurons)} reserved would pass it`;
    return null;
  }

  reserve(input: unknown): { index: number; neurons: number } {
    const w = worstCaseNeurons(input, this.o.model);
    const why = this.refusal(w.neurons);
    if (why) throw new BudgetExceeded(why.startsWith('run') ? 'run' : 'daily', `benchmark neuron budget reached: ${why}`);
    this.runCharged += w.neurons;
    this.attempts.push({ n: this.attempts.length + 1, reserved: w.neurons, charged: w.neurons, basis: 'reserved_only', promptTokens: null, completionTokens: null, overrun: false });
    this.persist();
    return { index: this.attempts.length - 1, neurons: w.neurons };
  }

  /**
   * Replace the reservation with the FULL estimate from the reported tokens (margin applied by charge()). The
   * estimate is not capped at the reservation: an overrun is recorded, persisted and counted against both caps.
   */
  settle(r: { index: number }, usage: { prompt: number; completion: number } | null) {
    const a = this.attempts[r.index]!;
    if (!usage) return; // usage unavailable: the conservative reservation stands
    const charged = charge(usage.prompt, usage.completion, this.o.model);
    this.runCharged += charged - a.charged;
    a.charged = charged;
    a.basis = 'measured';
    a.promptTokens = usage.prompt;
    a.completionTokens = usage.completion;
    a.overrun = charged > a.reserved;
    this.persist();
  }

  /** The call failed or timed out: nothing is known, so the reservation stands. */
  keep(r: { index: number }) {
    this.attempts[r.index]!.basis = 'kept_after_error';
    this.persist();
  }

  private persist() {
    if (!this.o.statePath) return;
    writeFileSync(this.o.statePath, JSON.stringify({ day: this.o.day, neuronsEstimated: this.dailyTotal, note: 'cumulative daily CHARGE (measured estimates, plus conservative reservations where usage was unknown); not dashboard-confirmed' }));
  }
}

const round = (n: number) => Math.round(n * 10) / 10;

export function loadDailyBaseline(statePath: string, day: string): number {
  if (!existsSync(statePath)) return 0;
  const s = JSON.parse(readFileSync(statePath, 'utf8')) as { day: string; neuronsEstimated: number };
  return s.day === day ? s.neuronsEstimated : 0;
}

function usageOf(out: unknown): { prompt: number; completion: number } | null {
  const u = (out as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null)?.usage;
  return u && Number.isFinite(u.prompt_tokens) && Number.isFinite(u.completion_tokens) && (u.prompt_tokens as number) >= 0 && (u.completion_tokens as number) >= 0 ? { prompt: u.prompt_tokens as number, completion: u.completion_tokens as number } : null;
}

/** Wrap a model client so every call (first attempt or repair) reserves before it is made. */
export function budgetedAi(ai: Ai, budget: NeuronBudget): Ai {
  return {
    async run(model, input) {
      const r = budget.reserve(input); // throws BudgetExceeded BEFORE any call
      try {
        const out = await ai.run(model, input);
        budget.settle(r, usageOf(out));
        return out;
      } catch (e) {
        budget.keep(r);
        throw e;
      }
    },
  };
}
