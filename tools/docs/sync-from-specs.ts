// Manual: update the README feature list and the build log's spec status from the specs.
//
//   npx tsx tools/docs/sync-from-specs.ts            rewrite the generated blocks in README.md and docs/build-log.md
//   npx tsx tools/docs/sync-from-specs.ts --check    exit 1 if a generated block is out of date (changes nothing)
//
// Source: every `.kiro/specs/*/tasks.md`; a ticked task (`- [x]`) is a delivered feature, an unticked one is open. Only the text
// between the markers is ever written; everything else in both files is left exactly as it is. No dates are written, so running it
// twice changes nothing. It reads the specs only: it does not decide that a task is done.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

export type Task = { done: boolean; id: string; title: string };
export type SpecTasks = { spec: string; tasks: Task[] };

export function parseTasks(md: string): Task[] {
  const out: Task[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\s*-\s*\[( |x|X)\]\s+(.*)$/);
    if (!m) continue;
    const body = m[2]!.replace(/\*\*/g, '').trim();
    const id = body.match(/^((?:[A-Z]{1,4}-)?[A-Z]*\d+[a-z]?(?:\.\d+)?)\b[.:]?\s*/)?.[1] ?? '';
    const rest = (id ? body.slice(body.indexOf(id) + id.length).replace(/^[.:\s]+/, '') : body).replace(/^\(done[^)]*\)\s*/i, '');
    // The title is the text up to the first full stop, parenthesis or colon: a short phrase, not the whole task description.
    const short = (rest.split(/(?<=[a-z0-9)])\.\s|\s\(|:\s/)[0] ?? rest).trim();
    const title = short.length <= 110 ? short : `${short.slice(0, 110).replace(/\s+\S*$/, '')}…`;
    out.push({ done: m[1] !== ' ', id, title });
  }
  return out;
}

export function featureBlock(specs: SpecTasks[]): string {
  const lines = ['| Spec | Delivered | Open |', '|---|---|---|'];
  for (const s of specs) lines.push(`| \`${s.spec}\` | ${s.tasks.filter((t) => t.done).length} | ${s.tasks.filter((t) => !t.done).length} |`);
  lines.push('');
  for (const s of specs) {
    const done = s.tasks.filter((t) => t.done);
    if (!done.length) continue;
    lines.push(`**${s.spec}** (delivered):`, ...done.map((t) => `- ${t.id ? `${t.id}: ` : ''}${t.title}`), '');
  }
  const open = specs.flatMap((s) => s.tasks.filter((t) => !t.done).map((t) => `- \`${s.spec}\` ${t.id ? `${t.id}: ` : ''}${t.title}`));
  if (open.length) lines.push('**Open:**', ...open, '');
  lines.push('_Generated from `.kiro/specs/*/tasks.md` by `npm run docs:sync`. A ticked task means its tests passed in CI; what was measured and what was not is in `docs/build-log.md`._');
  return lines.join('\n');
}

export function statusBlock(specs: SpecTasks[]): string {
  const total = specs.reduce((n, s) => n + s.tasks.length, 0);
  const done = specs.reduce((n, s) => n + s.tasks.filter((t) => t.done).length, 0);
  return [`Specs in the repository: ${specs.length}. Tasks ticked: ${done} of ${total}.`, '', ...specs.map((s) => `- \`${s.spec}\`: ${s.tasks.filter((t) => t.done).length} of ${s.tasks.length} ticked${s.tasks.filter((t) => !t.done).length ? `; open: ${s.tasks.filter((t) => !t.done).map((t) => t.id || t.title).join(', ')}` : ''}`)].join('\n');
}

export function replaceBlock(text: string, name: string, content: string): string {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < a) throw new Error(`markers ${start} ... ${end} not found`);
  return `${text.slice(0, a + start.length)}\n${content}\n${text.slice(b)}`;
}

export function readSpecs(root: string): SpecTasks[] {
  return readdirSync(`${root}.kiro/specs`, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ spec: d.name, tasks: parseTasks(readFileSync(`${root}.kiro/specs/${d.name}/tasks.md`, 'utf8')) }))
    .filter((s) => s.tasks.length > 0)
    .sort((a, b) => a.spec.localeCompare(b.spec));
}

if (process.argv[1]?.endsWith('sync-from-specs.ts')) {
  const root = new URL('../../', import.meta.url).pathname;
  const specs = readSpecs(root);
  const targets: [string, string, string][] = [['README.md', 'features', featureBlock(specs)], ['docs/build-log.md', 'spec-status', statusBlock(specs)]];
  let stale = 0;
  for (const [file, name, content] of targets) {
    const before = readFileSync(root + file, 'utf8');
    const after = replaceBlock(before, name, content);
    if (after !== before) {
      stale++;
      if (!process.argv.includes('--check')) writeFileSync(root + file, after);
      console.log(`${process.argv.includes('--check') ? 'out of date' : 'updated'}: ${file} (${name})`);
    } else console.log(`unchanged: ${file} (${name})`);
  }
  process.exit(process.argv.includes('--check') && stale ? 1 : 0);
}
