import type { Fixture } from '@skeleton-key/ui';
import layout from '../../../samples/fixtures/scopecheck-layout.json';
import standard from '../../../samples/fixtures/scopecheck-standard.json';

// Fictional sample inputs: source text blocks plus the model's recorded claims. The rules run on them in the browser.
export const FIXTURES = [standard, layout] as unknown as Fixture[];
