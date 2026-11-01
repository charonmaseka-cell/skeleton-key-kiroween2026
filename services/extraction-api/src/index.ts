import { handle } from './handler';
import type { EnvVars } from './config';
import { AdmissionCounter } from './counter-do';

export { AdmissionCounter };

interface Env extends EnvVars {
  AI: { run(model: string, input: unknown): Promise<unknown> };
  ADMISSION: DurableObjectNamespace<AdmissionCounter>;
  CLIENT_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, {
      now: () => Date.now(),
      counter: env.ADMISSION.get(env.ADMISSION.idFromName('global')),
      ai: env.AI,
      clientLimiter: env.CLIENT_LIMITER,
      // Content-free structured log: status, code and counts only.
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  },
};
