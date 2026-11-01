import type { Correction, EffectiveFact, Fact } from './types';

/** A fact can feed a confirmed finding only if validated (or user-supplied) and known. */
export function isUsable(e: Pick<EffectiveFact, 'status' | 'value'>): boolean {
  return (e.status === 'validated' || e.status === 'user_supplied') && e.value !== null;
}

/**
 * Apply the latest Correction (by `at`, later array entry wins ties).
 * The original Fact, value and evidence stay on `fact`; the corrected value is
 * labelled user_supplied and is never presented as appearing in the document.
 */
export function effectiveFact(fact: Fact, corrections: Correction[]): EffectiveFact {
  let latest: Correction | undefined;
  for (const c of corrections) {
    if (c.factId === fact.id && (!latest || c.at >= latest.at)) latest = c;
  }
  if (!latest) {
    const base = { fact, value: fact.value, provenance: 'document' as const, status: fact.status };
    return { ...base, usable: isUsable(base) };
  }
  const base = { fact, value: latest.correctedValue, provenance: 'user_supplied' as const, status: 'user_supplied' as const };
  return { ...base, usable: isUsable(base), correction: latest };
}

export function buildEffectiveFacts(facts: Fact[], corrections: Correction[]): Map<string, EffectiveFact> {
  return new Map(facts.map((f) => [f.id, effectiveFact(f, corrections)]));
}
