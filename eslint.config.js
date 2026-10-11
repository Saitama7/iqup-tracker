import js from '@eslint/js'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dev-dist',
      'coverage',
      'playwright-report',
      'test-results',
      'src/routeTree.gen.ts',
      'src/lib/supabase/types.gen.ts',
      // Deno entrypoints (npm: specifiers, Deno globals) — checked by the Edge Runtime
      'supabase/functions/*/index.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // shadcn CLI falls back to the unrelated npm package `cn` when it can't resolve `@/`
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'cn', message: "Use cn from '@/lib/utils'." }] },
      ],
    },
  },
  {
    // shadcn-generated primitives: keep upstream code as-is
    files: ['src/components/ui/**'],
    rules: { 'jsx-a11y/heading-has-content': 'off', 'jsx-a11y/anchor-has-content': 'off' },
  },
  {
    files: ['src/routes/**'],
    rules: { '@typescript-eslint/only-throw-error': 'off' },
  },
)
