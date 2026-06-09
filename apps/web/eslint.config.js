import js from '@eslint/js'
import ts from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],

  // TypeScript parser for Svelte files and .svelte.ts rune files
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
  },

  // Global environments
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  // Relaxed rules for this project
  {
    rules: {
      // Allow unused vars prefixed with _ (common Svelte/TS pattern)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Allow explicit any in server-side K8s / openid-client interop code
      '@typescript-eslint/no-explicit-any': 'warn',
      // Svelte stores use $ prefix which triggers this
      'no-undef': 'off',
      // No base path configured — resolve() is not required
      'svelte/no-navigation-without-resolve': 'off',
    },
  },

  // Ignored paths
  {
    ignores: ['.svelte-kit/**', 'build/**', 'drizzle/**', 'node_modules/**'],
  },
]
