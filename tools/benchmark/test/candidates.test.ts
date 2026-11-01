import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILES } from '../../../services/extraction-api/src/profiles';
import { oracleAi } from '../src/ai';
import { SqliteAdmission } from '../src/admission';
import { BASELINE_MODEL, MODELS, SECOND_CANDIDATE, modelConfig, withModel } from '../src/candidates';
import { loadSample } from '../src/samples';
import { LocalTransport } from '../src/transport';
import { estimateNeurons, summarizeUsage } from '../src/usage';

// Model choice is benchmark configuration. These tests keep it that way (spec 5.3, R8.12).

describe('model selection stays in the benchmark', () => {
  it('a candidate is applied below the Worker handler: the handler still asks for the profile model, the client substitutes', async () => {
    const seen: string[] = [];
    const inner = oracleAi([loadSample('scopecheck')]);
    const spy = { run: (m: string, i: unknown) => (seen.push(m), inner.run(m, i)) };
    const counter = new SqliteAdmission(':memory:');
    const t = new LocalTransport({ ai: withModel(spy, SECOND_CANDIDATE), counter, env: { DAILY_ADMISSION_CEILING: '10', MAX_REPAIR_ATTEMPTS: '1', INFERENCE_TIMEOUT_MS: '2000' } });
    const res = await t.extract('scopecheck.quote.v1', [{ id: 'b1', text: 'Item CP-100 Centrifugal pump' }]);
    counter.close();
    expect(res.ok).toBe(true);
    expect(seen).toEqual([SECOND_CANDIDATE]); // the model client received the candidate...
    expect(PROFILES['scopecheck.quote.v1']!.model).toBe(BASELINE_MODEL); // ...while the server profile is untouched
  });

  it('no Worker source file names a candidate model other than the profile constant, and none reads a model from a request', () => {
    const dir = join(__dirname, '../../../services/extraction-api/src');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toContain('llama-3.1-8b');
      expect(text, f).not.toContain('candidates');
    }
  });

  it('only registered models can be selected', () => {
    expect(Object.keys(MODELS).sort()).toEqual([BASELINE_MODEL, SECOND_CANDIDATE].sort());
    expect(() => modelConfig('@cf/other/model')).toThrow(/unknown model/);
  });
});

describe('estimated neurons use the rates of the model actually called', () => {
  it('the same tokens cost different estimated neurons per model, and the estimate is labelled', () => {
    expect(estimateNeurons(1000, 1000, BASELINE_MODEL)).toBeGreaterThan(estimateNeurons(1000, 1000, SECOND_CANDIDATE));
    const u = summarizeUsage([{ promptTokens: 1000, completionTokens: 500 }], { mock: false, model: SECOND_CANDIDATE });
    expect(u.tokenSource).toBe('measured');
    expect(u.neurons.basis).toBe('estimated_from_tokens');
    expect(u.neurons.note).toMatch(/UNVERIFIED/);
    expect(u.neurons.value).toBe(Math.round(estimateNeurons(1000, 500, SECOND_CANDIDATE)));
  });
});
