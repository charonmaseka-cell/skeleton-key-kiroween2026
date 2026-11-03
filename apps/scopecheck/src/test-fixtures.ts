import type { Fixture } from '@skeleton-key/ui';
import { FIXTURES } from './fixtures';

/** The small two-quotation set first (the old default), for tests written against it. */
export const STANDARD_FIRST: Fixture[] = [FIXTURES.find((f) => f.id === 'scopecheck-standard')!, ...FIXTURES.filter((f) => f.id !== 'scopecheck-standard')];
