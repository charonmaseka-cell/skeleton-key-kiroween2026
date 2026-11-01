import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { estimateNeurons } from './usage';
import type { Ai } from './ai';

// Conservative neuron budget for live runs.
//
// Every inference attempt, including a repair, RESERVES a worst-case charge BEFORE the model is called and is
// refused if the reservation would pass either cap:
//   - the run cap: neurons this run may add (default 6,000)
//   - the daily cap: the day's cumulative neurons, baseline included (default 8,000)
// The worst case assumes the model uses its whole output allowance (max_tokens) and that the prompt is larger
// than it looks (characters / 3 tokens; measured prompts were nearer 4.6 characters per token).
//
// After a response: measured tokens replace the reservation (with a 10% safety margin on top of the published
// rates). When usage is NOT reported, or the call fails (timeout, network, quota, schema), the conservative
// reservation STANDS, because the consumption is unknown. The ledger is written to disk after every change, so
// a crashed run cannot forget what it reserved.
//
// These figures are charges against a budget. They are not dashboard-confirmed consumption.

export const CHARS_PER_TOKEN_WORST = 3;
export const SETTLE_MARGIN = 1.1;

export class BudgetExceeded extends Error {
  constructor(public readonly cap: 'run' | 'daily', message: string) {
    super(message);
  }
}

export type AttemptCharge = { n: number; reserved: number; charged: number; basis: 'reserved_only' | 'measured' | 'kept_after_error'; promptTokens: number | null; completionTokens: number | null };

type Input = { messages?: { content?: string }[]; max_tokens?: number };

/** Worst-case neurons for one attempt: estimated prompt plus the whole output allowance. */
export function worstCaseNeurons(input: unknown, model: string): { neurons: number; promptTokens: number; completionTokens: number } {
  const i = input as Input;
  const chars = (i.messages ?? []).reduce((n, m) => n + (m.content?.length ?? 0), 0);
  const promptTokens = Math.ceil(chars / CHARS_PER_TOKEN_WORST);
  const completionTokens = i.max_tokens ?? 4096; // unknown output allowance: assume a large one
  return { neurons: estimateNeurons(promptTokens, completionTokens, model), promptTokens, completionTokens };
}

export class NeuronBudget {
  readonly attempts: AttemptCharge[] = [];
  private runCharged = 0;
  constructor(
    private readonly o: { model: string; runCap: number; dailyCap: number; dailyBaseline: number; statePath?: string; day: string },
  ) {}

  get runTotal() { return this.runCharged; }
  get dailyTotal() { return this.o.dailyBaseline + this.runCharged; }
  get summary() {
    return { runCap: this.o.runCap, dailyCap: this.o.dailyCap, dailyBaseline: this.o.dailyBaseline, runCharged: round(this.runCharged), dailyAfter: round(this.dailyTotal), attempts: this.attempts.length };
  }

  /** Why an attempt of this size cannot be reserved now, or null if it can. */
  refusal(neurons: number): string | null {
    if (this.runCharged + neurons > this.o.runCap) return `run cap ${this.o.runCap} neurons: ${round(this.runCharged)} charged + ${round(neurons)} reserved would pass it`;
    if (this.dailyTotal + neurons > this.o.dailyCap) return `daily cap ${this.o.dailyCap} neurons: ${round(this.dailyTotal)} charged today + ${round(neurons)} reserved would pass it`;
    return null;
  }

  reserve(input: unknown): { index: number; neurons: number } {
    const w = worstCaseNeurons(input, this.o.model);
    const why = this.refusal(w.neurons);
    if (why) throw new BudgetExceeded(why.startsWith('run') ? 'run' : 'daily', `benchmark neuron budget reached: ${why}`);
    this.runCharged += w.neurons;
    this.attempts.push({ n: this.attempts.length + 1, reserved: w.neurons, charged: w.neurons, basis: 'reserved_only', promptTokens: null, completionTokens: null });
    this.persist();
    return { index: this.attempts.length - 1, neurons: w.neurons };
  }

  /** Replace the reservation with a measured charge, only when the model reported usage. */
  settle(r: { index: number }, usage: { prompt: number; completion: number } | null) {
    const a = this.attempts[r.index]!;
    if (!usage) return; // usage unavailable: the conservative reservation stands
    const charged = Math.min(a.reserved, estimateNeurons(usage.prompt, usage.completion, this.o.model) * SETTLE_MARGIN) ;
    this.runCharged += charged - a.charged;
    a.charged = charged;
    a.basis = 'measured';
    a.promptTokens = usage.prompt;
    a.completionTokens = usage.completion;
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
  return u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number' ? { prompt: u.prompt_tokens, completion: u.completion_tokens } : null;
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
