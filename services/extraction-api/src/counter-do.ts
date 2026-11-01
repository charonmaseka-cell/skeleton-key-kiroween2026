import { DurableObject } from 'cloudflare:workers';
import { admit, initSchema, type AdmitResult } from './admission';

/**
 * SQLite-backed Durable Object holding the strict global admission counter.
 * `admit` is synchronous and wrapped in a storage transaction, and a Durable Object
 * runs one request at a time, so concurrent callers cannot exceed the ceiling.
 */
export class AdmissionCounter extends DurableObject<Record<string, unknown>> {
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      initSchema(ctx.storage.sql);
    });
  }

  admit(ceiling: number, nowMs: number): AdmitResult {
    return this.ctx.storage.transactionSync(() => admit(this.ctx.storage.sql, ceiling, nowMs));
  }
}
