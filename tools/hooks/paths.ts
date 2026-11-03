import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

// The files a save hook was told about. A hook command receives JSON on stdin with the session context; its exact shape is not
// documented in a way we could rely on, so every file path found in it is taken (any string that looks like a source path), and the
// FILE environment variable is accepted too. With nothing found the hooks fall back to their broader run instead of doing nothing.

export const ROOT = new URL('../../', import.meta.url).pathname;

export function savedPaths(stdin: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const found = new Set<string>();
  const add = (p: string) => {
    const rel = p.startsWith('/') ? relative(ROOT, p) : p.replace(/^\.\//, '');
    if (!rel.startsWith('..') && /\.(tsx?|json|css)$/.test(rel)) found.add(rel);
  };
  for (const m of stdin.matchAll(/[A-Za-z0-9_@./-]+\.(?:tsx?|json|css)\b/g)) add(m[0]);
  if (env.FILE) add(env.FILE);
  return [...found];
}

export function readStdin(): string {
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export const exists = (rel: string): boolean => existsSync(ROOT + rel);
