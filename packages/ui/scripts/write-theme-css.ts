// Regenerates packages/ui/src/theme.css from the tokens:  npx tsx packages/ui/scripts/write-theme-css.ts
import { writeFileSync } from 'node:fs';
import { themeCss } from '../src/theme-tokens';

writeFileSync(new URL('../src/theme.css', import.meta.url), themeCss());
console.log('wrote packages/ui/src/theme.css');
