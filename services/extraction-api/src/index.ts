import { handle } from './handler';
import type { EnvVars } from './config';
import { AdmissionCounter } from './counter-do';
import { health } from './health';

export { AdmissionCounter };

interface Env extends EnvVars {
  AI: { run(model: string, input: unknown): Promise<unknown> };
  ADMISSION: DurableObjectNamespace<AdmissionCounter>;
  CLIENT_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const counter = env.ADMISSION.get(env.ADMISSION.idFromName('global'));
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return health(env, { now: () => Date.now(), ai: env.AI, counter });
    return handle(request, env, {
      now: () => Date.now(),
      counter,
      ai: env.AI,
      clientLimiter: env.CLIENT_LIMITER,
      // Content-free structured log: status, code and counts only.
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  },
};
