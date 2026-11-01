// Server-controlled limits. A missing or malformed value closes the service
// (fail closed) instead of silently falling back to something permissive.

export type EnvVars = Partial<Record<
  | 'ALLOWED_ORIGINS'
  | 'MAX_BODY_BYTES'
  | 'MAX_CHARS'
  | 'MAX_BLOCKS'
  | 'MAX_BLOCK_CHARS'
  | 'MAX_REPAIR_ATTEMPTS'
  | 'INFERENCE_TIMEOUT_MS'
  | 'DAILY_ADMISSION_CEILING',
  string
>>;

export type Config = {
  maxBodyBytes: number;
  maxChars: number;
  maxBlocks: number;
  maxBlockChars: number;
  maxRepairAttempts: number;
  timeoutMs: number;
  dailyCeiling: number;
};

// Hard caps: even a misconfigured var cannot exceed these.
const SPEC = {
  MAX_BODY_BYTES: { def: 65_536, min: 1_024, max: 262_144 },
  MAX_CHARS: { def: 24_000, min: 1, max: 100_000 },
  MAX_BLOCKS: { def: 400, min: 1, max: 2_000 },
  MAX_BLOCK_CHARS: { def: 4_000, min: 1, max: 20_000 },
  MAX_REPAIR_ATTEMPTS: { def: 1, min: 0, max: 1 },
  INFERENCE_TIMEOUT_MS: { def: 25_000, min: 10, max: 60_000 },
} as const;

function int(raw: string | undefined, def: number | null, min: number, max: number): number | null {
  if (raw === undefined || raw === '') return def;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

export function parseOrigins(env: EnvVars): string[] {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function parseConfig(env: EnvVars): Config | null {
  const v = {
    maxBodyBytes: int(env.MAX_BODY_BYTES, SPEC.MAX_BODY_BYTES.def, SPEC.MAX_BODY_BYTES.min, SPEC.MAX_BODY_BYTES.max),
    maxChars: int(env.MAX_CHARS, SPEC.MAX_CHARS.def, SPEC.MAX_CHARS.min, SPEC.MAX_CHARS.max),
    maxBlocks: int(env.MAX_BLOCKS, SPEC.MAX_BLOCKS.def, SPEC.MAX_BLOCKS.min, SPEC.MAX_BLOCKS.max),
    maxBlockChars: int(env.MAX_BLOCK_CHARS, SPEC.MAX_BLOCK_CHARS.def, SPEC.MAX_BLOCK_CHARS.min, SPEC.MAX_BLOCK_CHARS.max),
    maxRepairAttempts: int(env.MAX_REPAIR_ATTEMPTS, SPEC.MAX_REPAIR_ATTEMPTS.def, SPEC.MAX_REPAIR_ATTEMPTS.min, SPEC.MAX_REPAIR_ATTEMPTS.max),
    timeoutMs: int(env.INFERENCE_TIMEOUT_MS, SPEC.INFERENCE_TIMEOUT_MS.def, SPEC.INFERENCE_TIMEOUT_MS.min, SPEC.INFERENCE_TIMEOUT_MS.max),
    // Required: no default. Derived from benchmark measurements.
    dailyCeiling: int(env.DAILY_ADMISSION_CEILING, null, 0, 100_000),
  };
  return Object.values(v).some((x) => x === null) ? null : (v as Config);
}
