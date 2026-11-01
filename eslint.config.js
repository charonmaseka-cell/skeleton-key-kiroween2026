import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.wrangler/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // R1.3: the engine is domain-neutral and must not import app code.
    files: ['packages/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/apps/*', '**/apps/**', '@skeleton-key/scopecheck*', '@skeleton-key/packcheck*'], message: 'packages/engine must not import app code.' },
            { group: ['@skeleton-key/ui*'], message: 'packages/engine must not depend on UI.' },
          ],
        },
      ],
    },
  },
);
