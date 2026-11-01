import { z } from 'zod';

export const BlockSchema = z.object({
  id: z.string().min(1),
  docId: z.string().min(1),
  kind: z.enum(['pdf-run', 'docx-para', 'docx-cell']),
  text: z.string(),
  page: z.number().int().positive().optional(), // PDF only
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(), // PDF only
  ref: z.string().optional(), // DOCX paragraph / table-cell reference only
});
export type Block = z.infer<typeof BlockSchema>;

/** Invariant: text === originalBlock.text.slice(start, end). */
export const EvidenceSchema = z.object({
  docId: z.string(),
  blockId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  text: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ValueKindSchema = z.enum(['money', 'date', 'quantity', 'name', 'text']);
export type ValueKind = z.infer<typeof ValueKindSchema>;

/** What a model is allowed to return for one extracted value. Nothing here is trusted. */
export const ModelClaimSchema = z.object({
  field: z.string().min(1),
  kind: ValueKindSchema,
  blockId: z.string().min(1),
  excerpt: z.string().min(1),
  value: z.unknown(),
});
export type ModelClaim = z.infer<typeof ModelClaimSchema>;

export type FactStatus = 'validated' | 'needs_review';

/**
 * Value shapes (decimals are strings):
 *   money    { amount: string, currency: string | null }
 *   date     ISO yyyy-mm-dd string
 *   quantity { value: string, unit: string | null }
 *   name/text string
 * `null` means unknown and is never defaulted.
 */
export type Fact = {
  id: string;
  docId: string;
  field: string;
  kind: ValueKind;
  value: unknown | null;
  evidence: Evidence[];
  status: FactStatus;
  reason?: string;
};

export type Correction = {
  factId: string;
  correctedValue: unknown | null;
  note?: string;
  at: number;
};

export type Provenance = 'document' | 'user_supplied';

/** A Fact with any Correction applied. The original Fact and evidence are never mutated. */
export type EffectiveFact = {
  fact: Fact;
  value: unknown | null;
  provenance: Provenance;
  status: FactStatus | 'user_supplied';
  usable: boolean;
  correction?: Correction;
};
