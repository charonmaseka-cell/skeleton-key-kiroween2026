import type { Fixture } from '@skeleton-key/ui';
import full from '../../../samples/fixtures/scopecheck-full.json';
import layout from '../../../samples/fixtures/scopecheck-layout.json';
import standard from '../../../samples/fixtures/scopecheck-standard.json';

// Fictional sample inputs: source text blocks plus the model's recorded claims. The rules run on them in the browser.
// The full-length set is the default; the small set and the free-text set stay as further options.
export const FIXTURES = [full, standard, layout] as unknown as Fixture[];
