// Ephemeral secret for the gated staging Worker (wrangler.gate.toml). Generated locally from the OS CSPRNG, stored in a
// git-ignored file with mode 0600, NEVER printed, logged or committed. The value is only ever read by this file's `--put`
// (piped to wrangler on stdin) and by the gate test runner (sent as the bearer token).
//
//   npx tsx tools/deploy/gate-secret.ts --create    create it (refuses to overwrite an existing one)
//   npx tsx tools/deploy/gate-secret.ts --put       bind it to skeleton-key-extraction-gate (wrangler secret put, stdin)
//   npx tsx tools/deploy/gate-secret.ts --destroy   delete the local file (after the Worker is deleted)
//   npx tsx tools/deploy/gate-secret.ts --status    whether it exists and its length; never its value
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const REPO = new URL('../../', import.meta.url).pathname;
export const SECRET_FILE = join(REPO, '.benchmark-state', 'gate', 'secret');
export const GATE_CONFIG = join(REPO, 'services', 'extraction-api', 'wrangler.gate.toml');

/** Creates the secret (32 random bytes, base64url: 43 characters). Returns metadata only. */
export function createSecret(file = SECRET_FILE): { created: boolean; length: number } {
  if (existsSync(file)) return { created: false, length: readSecret(file).length };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const value = randomBytes(32).toString('base64url');
  writeFileSync(file, value, { mode: 0o600, flag: 'wx' }); // wx: never overwrite
  chmodSync(file, 0o600);
  return { created: true, length: value.length };
}

/** Reads the secret for the bearer header or for wrangler's stdin. Refuses a file readable by group or others. */
export function readSecret(file = SECRET_FILE): string {
  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) throw new Error(`refusing to use ${file}: permissions ${mode.toString(8)} are wider than 600`);
  const v = readFileSync(file, 'utf8');
  if (!/^[A-Za-z0-9_-]{43}$/.test(v)) throw new Error(`${file} does not hold a generated secret`);
  return v;
}

export function destroySecret(file = SECRET_FILE): boolean {
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

if (process.argv[1]?.endsWith('gate-secret.ts')) {
  const a = process.argv[2];
  if (a === '--create') {
    const r = createSecret();
    console.log(r.created ? `created (${r.length} characters, mode 600, git-ignored)` : `already exists (${r.length} characters); not replaced`);
  } else if (a === '--put') {
    const home = join(REPO, '.benchmark-state', 'wrangler-home');
    mkdirSync(join(home, 'logs'), { recursive: true });
    // The value goes to wrangler on stdin only; wrangler does not echo it. Output is printed for the record.
    const out = execFileSync('npx', ['wrangler', 'secret', 'put', 'TEST_GATE_TOKEN', '-c', GATE_CONFIG], {
      cwd: join(REPO, 'services', 'extraction-api'), input: readSecret(), encoding: 'utf8',
      env: { ...process.env, XDG_CONFIG_HOME: home, WRANGLER_LOG_PATH: join(home, 'logs'), WRANGLER_SEND_METRICS: 'false' },
    });
    console.log(out.split(readSecret()).join('<redacted>'));
  } else if (a === '--destroy') {
    console.log(destroySecret() ? 'deleted' : 'no secret file');
  } else if (a === '--status') {
    console.log(existsSync(SECRET_FILE) ? `exists (${readSecret().length} characters)` : 'absent');
  } else {
    console.error('usage: gate-secret.ts --create | --put | --destroy | --status');
    process.exit(2);
  }
}
