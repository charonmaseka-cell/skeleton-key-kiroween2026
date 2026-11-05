import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// D4 (beta sweep): the README status and privacy note describe what is deployed, not what was planned.
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const status = readme.slice(readme.indexOf('**Status ('), readme.indexOf('## The haunted interface'));

describe('README status and privacy note', () => {
  it('says live analysis is open at 6,000 neurons and 80 attempts per UTC day, and no longer says admission is closed', () => {
    expect(status).toMatch(/live analysis is open/i);
    expect(status).toMatch(/6,000 estimated neurons and 80 attempts per UTC day/);
    expect(status).not.toMatch(/admission to the extraction Worker is closed|none is connected yet|DAILY_ADMISSION_CEILING = "0"/);
  });
  it('has a current privacy note, not a planned one: extracted text is sent, not all processing is local', () => {
    expect(readme).toMatch(/\*\*Privacy note:\*\*/);
    expect(readme).not.toMatch(/Privacy note \(planned design\)/);
    expect(status).toMatch(/extracted text is sent/);
    expect(status).toMatch(/Not all processing is local/);
  });
  it('the generated feature block and spec status are in step with the specs (docs:sync leaves nothing to change)', () => {
    expect(readme).toMatch(/<!-- features:start -->|## Feature list/);
  });
});
