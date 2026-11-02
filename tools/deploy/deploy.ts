// Task 7.1: deploy the extraction Worker (CLOSED: DAILY_ADMISSION_CEILING 0) and the two Pages apps (sample mode by default, built
// WITHOUT an analysis URL, so the upload panel says analysis is unavailable), then verify what was deployed. No inference is made.
//
//   npx tsx tools/deploy/deploy.ts --check        permission preflight only: changes nothing
//   npx tsx tools/deploy/deploy.ts                preflight, build, deploy, verify
//   npx tsx tools/deploy/deploy.ts --verify-only  verify an existing deployment
//
// Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (never printed). The token needs, at account level: Workers Scripts: Edit,
// Account Settings: Read, Cloudflare Pages: Edit, and Workers AI: Read (the binding). No paid-plan feature is used.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const WORKER = 'skeleton-key-extraction';
export const PAGES = { scopecheck: 'skeleton-key-scopecheck', packcheck: 'skeleton-key-packcheck' } as const;
export const pagesOrigin = (project: string) => `https://${project}.pages.dev`;
export const ORIGINS = Object.values(PAGES).map(pagesOrigin);

const REPO = new URL('../../', import.meta.url).pathname;
const API = 'https://api.cloudflare.com/client/v4';
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
const redact = (s: string) => (account ? s.split(account).join('<account>') : s);

type Check = { name: string; ok: boolean; detail: string; needs: string };

async function api(path: string): Promise<{ success: boolean; errors?: { code?: number; message?: string }[]; result?: unknown }> {
  const res = await fetch(`${API}${path.replace(':account', account)}`, { headers: { authorization: `Bearer ${token}` } });
  try {
    return (await res.json()) as never;
  } catch {
    return { success: false, errors: [{ message: `HTTP ${res.status}` }] };
  }
}

/** Read-only probes of each permission the deployment needs. */
export async function preflight(): Promise<Check[]> {
  const probe = async (name: string, path: string, needs: string, alsoAllowed: number[] = []): Promise<Check> => {
    const r = await api(path);
    // A permitted token asking about a script that does not exist yet gets "script not found" (10007), not an access error.
    const ok = r.success === true || (r.errors ?? []).some((e) => e.code !== undefined && alsoAllowed.includes(e.code));
    return { name, ok, detail: ok ? 'allowed' : (r.errors ?? []).map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join('; ') || 'refused', needs };
  };
  return [
    await probe('token is active', '/user/tokens/verify', 'a valid token'),
    await probe('list Worker scripts', '/accounts/:account/workers/scripts', 'Workers Scripts: Read'),
    await probe('workers.dev subdomain', '/accounts/:account/workers/subdomain', 'Account Settings: Read (wrangler publishes to workers.dev)'),
    await probe('Worker settings (upload path)', `/accounts/:account/workers/scripts/${WORKER}/secrets`, 'Workers Scripts: Edit', [10007]),
    await probe('Pages projects', '/accounts/:account/pages/projects', 'Cloudflare Pages: Edit'),
    await probe('Workers AI models', '/accounts/:account/ai/models/search?per_page=1', 'Workers AI: Read'),
  ];
}

function wrangler(args: string[], cwd = REPO): string {
  const home = join(REPO, '.benchmark-state', 'wrangler-home');
  mkdirSync(join(home, 'logs'), { recursive: true });
  return execFileSync('npx', ['wrangler', ...args], { cwd, encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: home, WRANGLER_LOG_PATH: join(home, 'logs'), WRANGLER_SEND_METRICS: 'false' } });
}

export type App = 'scopecheck' | 'packcheck';
export const APPS: App[] = ['scopecheck', 'packcheck'];

/**
 * Build the apps for the public site: sample mode by default and analysis DISABLED. `VITE_EXTRACTION_API_URL` is set to the empty
 * string explicitly, not deleted: Vite also reads `.env`, `.env.production` and `.env.*.local` files, and a variable already present
 * in the environment takes priority over them, so an explicit "" is what stops an env-file value from being built in. The apps read
 * "" as "no analysis service" (`|| undefined`).
 */
export function buildApps(apps: App[] = APPS): void {
  const env = { ...process.env, VITE_EXTRACTION_API_URL: '' };
  for (const app of apps) execFileSync('npm', ['run', 'build', '-w', `@skeleton-key/${app}`], { cwd: REPO, stdio: 'pipe', env });
}

/** Every non-empty analysis URL that the app's env files would build in (process environment ignored), for the bundle check. */
export async function envFileApiUrls(app: App): Promise<string[]> {
  const { loadEnv } = await import('vite');
  const saved = process.env.VITE_EXTRACTION_API_URL;
  delete process.env.VITE_EXTRACTION_API_URL;
  try {
    const urls = new Set<string>();
    for (const mode of ['production', 'development']) {
      const v = loadEnv(mode, join(REPO, 'apps', app), 'VITE_').VITE_EXTRACTION_API_URL;
      if (v) urls.add(v);
    }
    return [...urls];
  } finally {
    if (saved !== undefined) process.env.VITE_EXTRACTION_API_URL = saved;
  }
}

/**
 * The built bundle carries no analysis service address: no workers.dev host, no URL ending in /extract, and none of the URLs found in
 * the app's env files (a custom API domain is only a base URL; "/extract" is appended at run time, so it must be looked for itself).
 */
export async function bundleHasNoAnalysisUrl(app: App): Promise<boolean> {
  const dir = join(REPO, 'apps', app, 'dist', 'assets');
  if (!existsSync(dir)) return false;
  const known = await envFileApiUrls(app);
  return readdirSync(dir).filter((f) => f.endsWith('.js')).every((f) => {
    const js = readFileSync(join(dir, f), 'utf8');
    return !/workers\.dev|https?:\/\/[^"'`\s]*\/extract/.test(js) && known.every((u) => !js.includes(u) && !js.includes(u.replace(/\/$/, '')));
  });
}

export async function verify(workerUrl: string, fetchImpl: typeof fetch = fetch): Promise<Check[]> {
  const fetch = fetchImpl;
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail, needs: '' });
  const h = await fetch(`${workerUrl}/health`);
  const hb = (await h.json().catch(() => ({}))) as { ok?: boolean; checks?: { workersAiBinding?: string; durableObject?: { reachable?: boolean; zeroCeilingRefused?: boolean; unchangedAfterCheck?: boolean }; admission?: { open?: boolean; dailyCeiling?: number } } };
  add('Worker /health ok', h.status === 200 && hb.ok === true, `HTTP ${h.status}`);
  add('Workers AI binding present (not called)', hb.checks?.workersAiBinding === 'present (not called)', String(hb.checks?.workersAiBinding));
  add('deployed Durable Object reachable, refuses at ceiling 0, writes nothing', hb.checks?.durableObject?.reachable === true && hb.checks.durableObject.zeroCeilingRefused === true && hb.checks.durableObject.unchangedAfterCheck === true, JSON.stringify(hb.checks?.durableObject));
  add('public admission CLOSED (ceiling 0)', hb.checks?.admission?.open === false && hb.checks.admission.dailyCeiling === 0, JSON.stringify(hb.checks?.admission));
  const body = JSON.stringify({ schemaId: 'scopecheck.rfq.v1', blocks: [{ id: 'b1', text: 'Item AB-1 Pump | qty 2 units' }] });
  const allowed = await fetch(`${workerUrl}/extract`, { method: 'POST', headers: { origin: ORIGINS[0]!, 'content-type': 'application/json' }, body });
  const ab = (await allowed.json().catch(() => ({}))) as { error?: { code?: string } };
  add('/extract from a Pages origin is refused before inference (daily_limit)', allowed.status === 429 && ab.error?.code === 'daily_limit', `HTTP ${allowed.status} ${ab.error?.code}`);
  const other = await fetch(`${workerUrl}/extract`, { method: 'POST', headers: { origin: 'https://elsewhere.example', 'content-type': 'application/json' }, body });
  add('/extract from another origin is refused (origin_denied)', other.status === 403, `HTTP ${other.status}`);
  for (const [app, project] of Object.entries(PAGES)) {
    const page = await fetch(`${pagesOrigin(project)}/`);
    const html = await page.text();
    add(`${app} Pages site serves the app`, page.status === 200 && /<div id="root">/.test(html), `HTTP ${page.status}`);
  }
  return out;
}

const print = (title: string, checks: Check[]) => {
  console.log(`\n${title}`);
  for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${redact(c.detail)}${!c.ok && c.needs ? `  (needs ${c.needs})` : ''}`);
};

if (process.argv[1]?.endsWith('deploy.ts')) {
  if (!account || !token) {
    console.error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set (they are never printed).');
    process.exit(1);
  }
  const workerUrl = process.env.WORKER_URL;
  if (process.argv.includes('--verify-only')) {
    if (!workerUrl) { console.error('set WORKER_URL to the deployed Worker URL'); process.exit(1); }
    const v = await verify(workerUrl);
    print('Deployment verification (no inference)', v);
    process.exit(v.every((c) => c.ok) ? 0 : 3);
  }
  const p = await preflight();
  print('Permission preflight (read-only; nothing is changed)', p);
  if (!p.every((c) => c.ok)) {
    console.log('\nNOT DEPLOYED: the API token lacks the permissions marked FAIL. Nothing was created or changed.');
    process.exit(2);
  }
  if (process.argv.includes('--check')) process.exit(0);
  buildApps();
  for (const app of APPS) if (!(await bundleHasNoAnalysisUrl(app))) { console.error(`${app}: the bundle carries an analysis service address; refusing to deploy`); process.exit(1); }
  console.log('public builds: analysis disabled in both bundles (VITE_EXTRACTION_API_URL="")');
  console.log(redact(wrangler(['deploy', '--var', `ALLOWED_ORIGINS:${ORIGINS.join(',')}`, '--var', 'DAILY_ADMISSION_CEILING:0'], join(REPO, 'services', 'extraction-api'))));
  for (const [app, project] of Object.entries(PAGES)) {
    try { wrangler(['pages', 'project', 'create', project, '--production-branch', 'main']); } catch { /* exists already */ }
    console.log(redact(wrangler(['pages', 'deploy', join('apps', app, 'dist'), '--project-name', project, '--branch', 'main'])));
  }
  console.log('\nDeployed. Verify with WORKER_URL=https://<worker>.<subdomain>.workers.dev npx tsx tools/deploy/deploy.ts --verify-only');
}
