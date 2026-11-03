import { DurableObject } from 'cloudflare:workers';
import { budgetOn, closeRun, initLedger, openRun, reserve, reserveInRun, runChunk, settle, settleInRun, usedOn, type BudgetDay, type CloseRunResult, type OpenRunRequest, type OpenRunResult, type ReserveRequest, type ReserveResult, type RunAttempt, type RunChunk, type SettleResult } from './admission';

/**
 * SQLite-backed Durable Object holding the strict global admission ledger: attempts per UTC day and neuron reservations.
 * Each method is synchronous and wrapped in a storage transaction, and a Durable Object runs one request at a time, so
 * concurrent callers cannot exceed either the attempt ceiling or the neuron budget.
 */
export class AdmissionCounter extends DurableObject<Record<string, unknown>> {
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      initLedger(ctx.storage.sql);
    });
  }

  reserve(req: ReserveRequest, nowMs: number): ReserveResult {
    return this.ctx.storage.transactionSync(() => reserve(this.ctx.storage.sql, req, nowMs));
  }

  settle(id: number, charged: number | null): SettleResult {
    return this.ctx.storage.transactionSync(() => settle(this.ctx.storage.sql, id, charged));
  }

  openRun(req: OpenRunRequest, nowMs: number): OpenRunResult {
    return this.ctx.storage.transactionSync(() => openRun(this.ctx.storage.sql, req, nowMs));
  }

  runChunk(id: number, token: string, chunk: number, nowMs: number): RunChunk {
    return this.ctx.storage.transactionSync(() => runChunk(this.ctx.storage.sql, id, token, chunk, nowMs));
  }

  reserveInRun(id: number, token: string, chunk: number, neurons: number, nowMs: number): RunAttempt {
    return this.ctx.storage.transactionSync(() => reserveInRun(this.ctx.storage.sql, id, token, chunk, neurons, nowMs));
  }

  settleInRun(attemptId: number, charged: number | null): SettleResult {
    return this.ctx.storage.transactionSync(() => settleInRun(this.ctx.storage.sql, attemptId, charged));
  }

  closeRun(id: number, token: string, nowMs: number): CloseRunResult {
    return this.ctx.storage.transactionSync(() => closeRun(this.ctx.storage.sql, id, token, nowMs));
  }

  /** Read-only: today's admitted count. Used by the deployment check; admits nothing. */
  usedToday(nowMs: number): number {
    return usedOn(this.ctx.storage.sql, nowMs);
  }

  /** Read-only: today's ledger (attempts, estimated neurons charged, unsettled reservations, overruns). */
  budgetToday(nowMs: number): BudgetDay {
    return budgetOn(this.ctx.storage.sql, nowMs);
  }
}
