import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', 'spikes/**', '**/*.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      // Package boundaries: cross-package access only through the published barrel.
      // (Edge-direction enforcement lives in scripts/check-boundaries.mjs.)
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@looper/*/*'],
              message:
                "Import other packages only via their public barrel ('@looper/<name>'), never package internals.",
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', '**/*.config.*'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
