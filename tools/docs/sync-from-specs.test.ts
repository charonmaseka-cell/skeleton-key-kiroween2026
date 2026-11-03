import { describe, expect, it } from 'vitest';
import { featureBlock, parseTasks, readSpecs, replaceBlock, statusBlock } from './sync-from-specs';

const ROOT = new URL('../../', import.meta.url).pathname;

describe('reading the specs', () => {
  it('parses ticked and open tasks with their ids and a short title', () => {
    const t = parseTasks('# x\n- [x] HU-T1 Mode logic and toggle (HU-3, HU-5). Done 2026-11-03.\n- [ ] HU-T6 Theme complete and reviewed; build-log entry.\n  - [x] 3.2 Sub-task: with detail\n- [ ] Task without an id');
    expect(t).toEqual([
      { done: true, id: 'HU-T1', title: 'Mode logic and toggle' },
      { done: false, id: 'HU-T6', title: 'Theme complete and reviewed; build-log entry.' },
      { done: true, id: '3.2', title: 'Sub-task' },
      { done: false, id: '', title: 'Task without an id' },
    ]);
  });
  it('reads every spec in the repository', () => {
    const specs = readSpecs(ROOT);
    expect(specs.map((s) => s.spec)).toEqual(expect.arrayContaining(['haunted-ui', 'skeleton-key-foundation']));
    expect(specs.every((s) => s.tasks.length > 0)).toBe(true);
  });
});

describe('the generated blocks', () => {
  const specs = [{ spec: 'a', tasks: [{ done: true, id: 'A1', title: 'one' }, { done: false, id: 'A2', title: 'two' }] }];
  it('list delivered features, count open ones, and state their source; they carry no date', () => {
    const f = featureBlock(specs);
    expect(f).toMatch(/\| `a` \| 1 \| 1 \|/);
    expect(f).toMatch(/- A1: one/);
    expect(f).toMatch(/\*\*Open:\*\*\n- `a` A2: two/);
    expect(f).toMatch(/Generated from/);
    expect(f + statusBlock(specs)).not.toMatch(/20\d\d-\d\d-\d\d/);
    expect(statusBlock(specs)).toMatch(/ticked: 1 of 2/);
  });
  it('replaces only the text between the markers and is idempotent', () => {
    const doc = 'before\n<!-- features:start -->\nold\n<!-- features:end -->\nafter';
    const once = replaceBlock(doc, 'features', 'NEW');
    expect(once).toBe('before\n<!-- features:start -->\nNEW\n<!-- features:end -->\nafter');
    expect(replaceBlock(once, 'features', 'NEW')).toBe(once);
    expect(() => replaceBlock('no markers', 'features', 'x')).toThrow();
  });
});
