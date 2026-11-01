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
  {
    // Independent builds: each app depends on the shared engine and UI, never on the other app.
    files: ['apps/scopecheck/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/apps/packcheck/**', '@skeleton-key/packcheck*'], message: 'ScopeCheck must not import PackCheck.' }] }],
    },
  },
  {
    files: ['apps/packcheck/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/apps/scopecheck/**', '@skeleton-key/scopecheck*'], message: 'PackCheck must not import ScopeCheck.' }] }],
    },
  },
);
