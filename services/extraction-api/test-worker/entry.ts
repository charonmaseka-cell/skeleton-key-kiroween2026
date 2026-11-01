// Test-only worker: real handler + real SQLite Durable Object, with a mocked model.
// Behaviour is selected per request with the x-mock header; x-test-now fakes the clock.
import { handle } from '../src/handler';
import { AdmissionCounter } from '../src/counter-do';

export { AdmissionCounter };

let modelCalls = 0;

interface Env {
  ADMISSION: DurableObjectNamespace<AdmissionCounter>;
  [k: string]: unknown;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/__calls') return new Response(String(modelCalls));
    const mode = request.headers.get('x-mock') ?? 'ok';
    const nowHeader = request.headers.get('x-test-now');
    const ai = {
      async run() {
        modelCalls++;
        if (mode === 'quota') throw new Error('you have used up your daily free allocation of 10,000 neurons');
        if (mode === 'down') throw new Error('capacity temporarily exceeded');
        if (mode === 'slow') await new Promise((r) => setTimeout(r, 400));
        if (mode === 'bad_json') return { response: 'not json' };
        return {
          response: { claims: [{ field: 'organisation_name', blockId: 'b1', excerpt: 'Acme Trust', value: 'Acme Trust' }] },
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      },
    };
    return handle(request, env as never, {
      now: () => (nowHeader ? Number(nowHeader) : Date.now()),
      counter: env.ADMISSION.get(env.ADMISSION.idFromName('global')),
      ai,
      log: () => undefined,
    });
  },
};
