import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { featureBlock, readSpecs, replaceBlock } from './sync-from-specs';

// The README describes what is deployed and what leaves the device, and its generated block is in step with the specs.
const ROOT = new URL('../../', import.meta.url).pathname;
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

describe('README', () => {
  it('links both live apps and says exactly what leaves the device', () => {
    expect(readme).toContain('https://skeleton-key-scopecheck.pages.dev/');
    expect(readme).toContain('https://skeleton-key-packcheck.pages.dev/');
    expect(readme).toMatch(/only the \*extracted text\* is sent to an AI service/);
    expect(readme).toMatch(/original files are never uploaded/);
    expect(readme).not.toMatch(/planned design|none is connected yet|admission .* is closed/i);
  });
  it('names the extraction profile behind each measured result', () => {
    expect(readme).toMatch(/`scopecheck\.quote\.v1`/);
    expect(readme).toMatch(/`scopecheck\.quote\.v2`/);
  });
  it('the generated feature block matches the specs (npm run docs:sync leaves nothing to change)', () => {
    expect(replaceBlock(readme, 'features', featureBlock(readSpecs(ROOT)))).toBe(readme);
  });
});
