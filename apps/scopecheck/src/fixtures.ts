import type { Fixture } from '@skeleton-key/ui';
import fulllength from '../../../samples/fixtures/scopecheck-fulllength.json';
import layout from '../../../samples/fixtures/scopecheck-layout.json';
import standard from '../../../samples/fixtures/scopecheck-standard.json';

// Fictional sample inputs: source text blocks plus the model's recorded claims. The rules run on them in the browser.
// The full-length recorded run is the default (first); the small two-quotation set is the second option.
export const FIXTURES = [fulllength, standard, layout] as unknown as Fixture[];
