import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Ai } from './ai';
import type { NeuronBudget } from './budget';

// A live BATCH has one allowance, set once, and shared by every invocation that belongs to it (a first run, a resume after a
// stop, a retry). The caps are fixed when the batch is created: a later invocation cannot raise them, and attempts and
// estimated neurons already used are subtracted from what a resume may use. The state is written BEFORE each model call
// (attempt counted when dispatched) and after it (neurons), so a crash cannot make a resume forget what was spent.
//
// These are charges against a budget (published rates, margin applied); they are not dashboard-confirmed consumption.

export type BatchInvocation = { label: string; startedAt: string; attemptsAtStart: number; neuronsAtStart: number; attemptsEnd?: number; neuronsEnd?: number; resultFile?: string; stop?: string | null; /** the process ended without recording an end: a call it dispatched may be unsettled and its reservation stands */ interrupted?: boolean };
export type Reconciliation = { at: string; reason: string; before: number; after: number };
export type BatchState = {
  id: string;
  createdAt: string;
  attemptCap: number;
  neuronCap: number;
  attemptsUsed: number;
  neuronsCharged: number;
  /** result files of earlier invocations, oldest first; their successful chunks are reused, never resent */
  resultFiles: string[];
  invocations: BatchInvocation[];
  /** upward corrections of the neuron charge (never downward), with the reason */
  reconciliations?: Reconciliation[];
};

export class BatchExhausted extends Error {}

export class Batch {
  private constructor(private readonly file: string, readonly state: BatchState) {}

  /** Open an existing batch (caps, if given, must equal the stored ones) or create it (caps required). */
  static open(file: string, id: string, caps?: { attempts: number; neurons: number }): Batch {
    if (existsSync(file)) {
      const s = JSON.parse(readFileSync(file, 'utf8')) as BatchState;
      if (s.id !== id) throw new Error(`batch file ${file} belongs to ${s.id}, not ${id}`);
      if (caps && (caps.attempts !== s.attemptCap || caps.neurons !== s.neuronCap)) {
        throw new Error(`batch ${id} was created with ${s.attemptCap} attempts and ${s.neuronCap} estimated neurons; its caps are fixed and cannot be changed or raised on resume (asked for ${caps.attempts} and ${caps.neurons})`);
      }
      return new Batch(file, s);
    }
    if (!caps || !Number.isInteger(caps.attempts) || caps.attempts < 1 || !(caps.neurons > 0)) throw new Error(`batch ${id} does not exist: create it with --batch-attempts and --batch-neurons`);
    const b = new Batch(file, { id, createdAt: new Date().toISOString(), attemptCap: caps.attempts, neuronCap: caps.neurons, attemptsUsed: 0, neuronsCharged: 0, resultFiles: [], invocations: [] });
    b.save();
    return b;
  }

  get remainingAttempts() { return Math.max(0, this.state.attemptCap - this.state.attemptsUsed); }
  get remainingNeurons() { return Math.max(0, this.state.neuronCap - this.state.neuronsCharged); }

  begin(label: string): void {
    // An earlier invocation that never recorded an end was interrupted: it is kept as such. What it had dispatched stays counted.
    const prev = this.state.invocations.at(-1);
    if (prev && prev.attemptsEnd === undefined) prev.interrupted = true;
    this.state.invocations.push({ label, startedAt: new Date().toISOString(), attemptsAtStart: this.state.attemptsUsed, neuronsAtStart: this.state.neuronsCharged });
    this.save();
  }
  private get current(): BatchInvocation {
    const c = this.state.invocations.at(-1);
    if (!c) throw new Error('batch invocation not begun');
    return c;
  }
  /** Count one model call at the moment it is dispatched. Refuses past the cap: a hard backstop under the runner's own accounting. */
  attemptStarted(): void {
    if (this.state.attemptsUsed >= this.state.attemptCap) throw new BatchExhausted(`batch ${this.state.id}: all ${this.state.attemptCap} attempts are used`);
    this.state.attemptsUsed++;
    this.save();
  }
  /** Set the batch's charge from this invocation's budget total (reservations that stand included). */
  syncNeurons(runTotal: number): void {
    this.state.neuronsCharged = Math.ceil((this.current.neuronsAtStart + runTotal) * 1000) / 1000; // rounded UP: never under-count
    this.save();
  }
  /**
   * Raise the neuron charge to `total` (never lower it), recording why. Used when a process died between a call's reservation and
   * its settlement: the reservation stands, so the charge must include it.
   */
  reconcileNeurons(total: number, reason: string): void {
    const before = this.state.neuronsCharged;
    if (!(total > before)) return;
    this.state.neuronsCharged = Math.ceil(total * 1000) / 1000;
    (this.state.reconciliations ??= []).push({ at: new Date().toISOString(), reason, before, after: this.state.neuronsCharged });
    this.save();
  }
  /** Register a result file (or a recovered partial result) whose successful chunks later invocations reuse. */
  addResultFile(file: string): void {
    if (!this.state.resultFiles.includes(file)) this.state.resultFiles.push(file);
    this.save();
  }
  end(resultFile: string | undefined, stop: string | null): void {
    const c = this.current;
    c.attemptsEnd = this.state.attemptsUsed;
    c.neuronsEnd = this.state.neuronsCharged;
    c.resultFile = resultFile;
    c.stop = stop;
    if (resultFile && !this.state.resultFiles.includes(resultFile)) this.state.resultFiles.push(resultFile);
    this.save();
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2) + '\n');
    renameSync(tmp, this.file);
  }
}

/**
 * Compose the model client for a batch: raw responses are recorded innermost; each call is counted against the batch when it is
 * dispatched (after the budget has reserved it); the budget's reservations wrap that; and the batch's neuron charge is brought up
 * to date after every call settles.
 */
export function batchAi(raw: Ai, batch: Batch, makeBudgeted: (inner: Ai) => Ai, budget: () => NeuronBudget): Ai {
  // The attempt is counted, and the charge brought up to date, at the moment of dispatch: at that point the budget has already
  // reserved this call, so a process that dies mid-call leaves a batch that includes the reservation.
  const counted: Ai = { run: async (model, input) => { batch.attemptStarted(); batch.syncNeurons(budget().runTotal); return raw.run(model, input); } };
  const budgeted = makeBudgeted(counted);
  return {
    async run(model, input) {
      try {
        return await budgeted.run(model, input);
      } finally {
        batch.syncNeurons(budget().runTotal);
      }
    },
  };
}
