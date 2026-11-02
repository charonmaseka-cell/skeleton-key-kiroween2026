import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApps, bundleHasNoAnalysisUrl, envFileApiUrls } from './deploy';

// The public build disables analysis even when an env file names an analysis service. Real Vite builds of the ScopeCheck app.
// Control: an env file with a CUSTOM API domain (not workers.dev). A build that does not override it bakes the domain in; the
// public build (VITE_EXTRACTION_API_URL="" set explicitly) does not.

const REPO = join(__dirname, '../..');
const APP = join(REPO, 'apps/scopecheck');
const ENV_FILE = join(APP, '.env.production.local');
const CUSTOM = 'https://analysis.skeleton-key.example';
const bundle = () => readdirSync(join(APP, 'dist/assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(APP, 'dist/assets', f), 'utf8')).join('\n');
const plainBuild = () => {
  const env = { ...process.env };
  delete env.VITE_EXTRACTION_API_URL;
  execFileSync('npm', ['run', 'build', '-w', '@skeleton-key/scopecheck'], { cwd: REPO, stdio: 'pipe', env });
};

afterAll(() => {
  rmSync(ENV_FILE, { force: true });
  buildApps(['scopecheck']); // leave a public build behind
});

describe('public build with an analysis URL in an env file', () => {
  it('the env file is not tracked by git (it is a local override)', () => {
    expect(execFileSync('git', ['check-ignore', '-q', ENV_FILE], { cwd: REPO }).toString()).toBe('');
  });

  it('CONTROL: without the override, Vite builds the custom domain in, and the check catches it', async () => {
    writeFileSync(ENV_FILE, `VITE_EXTRACTION_API_URL=${CUSTOM}\n`);
    expect(await envFileApiUrls('scopecheck')).toEqual([CUSTOM]);
    plainBuild();
    expect(bundle()).toContain(CUSTOM);
    expect(await bundleHasNoAnalysisUrl('scopecheck')).toBe(false);
  }, 120_000);

  it('the public build (VITE_EXTRACTION_API_URL="" set explicitly) does not, even with the env file present', async () => {
    writeFileSync(ENV_FILE, `VITE_EXTRACTION_API_URL=${CUSTOM}\n`);
    buildApps(['scopecheck']);
    expect(existsSync(ENV_FILE)).toBe(true);
    expect(bundle()).not.toContain(CUSTOM);
    expect(bundle()).not.toContain('analysis.skeleton-key');
    expect(await bundleHasNoAnalysisUrl('scopecheck')).toBe(true);
  }, 120_000);
});
