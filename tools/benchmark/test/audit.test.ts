import { describe, expect, it } from 'vitest';
import type { Fact } from '@skeleton-key/engine';
import { auditFact } from '../src/run';

const fact = (kind: string, value: unknown, evidence: string): Fact => ({ status: 'validated', kind, value, evidence: [{ text: evidence }] }) as unknown as Fact;

describe('the benchmark audit of validated values', () => {
  it('accepts a text value that is written in its evidence, including decimals and slashes (regression: "7.5 kW" and "l/h" were flagged on 2026-11-01)', () => {
    expect(auditFact(fact('text', 'cast iron body, 7.5 kW', 'cast iron body, 7.5 kW'))).toBe('consistent');
    expect(auditFact(fact('text', 'PVC head, 0-20 l/h', 'PVC head, 0-20 l/h'))).toBe('consistent');
    expect(auditFact(fact('text', 'MT-301 Electric motor 5.5 kW', 'Item MT-301 Electric motor 5.5 kW'))).toBe('consistent');
  });
  it('still flags a text value that is not in its evidence', () => {
    expect(auditFact(fact('text', 'cast iron body, 9.5 kW', 'cast iron body, 7.5 kW'))).toBe('suspect');
    expect(auditFact(fact('text', 'stainless casing', 'cast iron body'))).toBe('suspect');
  });
});
