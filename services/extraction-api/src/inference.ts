import type { ErrorCode } from './errors';

export class InferenceTimeout extends Error {}

/**
 * Bound the wait. The underlying call is not cancelled and may still consume inference,
 * which is why the admission counter is never refunded.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new InferenceTimeout()), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Map an upstream failure to a stable code. The upstream message is inspected, never returned. */
export function classifyUpstream(err: unknown): Extract<ErrorCode, 'timeout' | 'quota_exhausted' | 'model_unavailable'> {
  if (err instanceof InferenceTimeout) return 'timeout';
  const text = `${(err as { message?: unknown })?.message ?? ''} ${(err as { code?: unknown })?.code ?? ''}`.toLowerCase();
  if (/neuron|daily free allocation|quota|\b4006\b/.test(text)) return 'quota_exhausted';
  return 'model_unavailable';
}
