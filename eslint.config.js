// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Boundary rules are the point of this file.
 *
 * With a single package there is no dependency graph to enforce layering, so the
 * two rules that keep the architecture honest — analytics performs no I/O, and
 * nothing outside src/db touches the raw Prisma client — live here and fail CI.
 * See CLAUDE.md and docs/00-overview.md §5.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules',
      '.next',
      'dist',
      'coverage',
      // Generated: Prisma's client and the derived tenant-model list.
      'src/db/generated',
      'src/db/tenant-models.generated.ts',
      // Build-tool config, outside the TypeScript project service.
      'postcss.config.mjs',
      'next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // A leading underscore marks a parameter that exists to satisfy a
      // signature — Express error handlers need all four arguments.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  /*
   * ORDER MATTERS. In flat config, a later object that sets the same rule
   * REPLACES the earlier setting — it does not merge. So the general rule comes
   * first and the narrower layer rules come after it, each restating everything
   * it needs. Getting this backwards silently disables the stricter rule, which
   * is exactly the failure this comment exists to prevent.
   *
   * Patterns end in `*` because this codebase imports with explicit `.js`
   * extensions (`@db/client.js`), and a bare `@db/client` pattern does not
   * match that.
   */

  // ── Boundary A (general): only src/db may touch the unscoped client ──────
  // Everywhere else receives a tenant-scoped client, so forgetting the
  // workspace filter is structurally impossible. See ADR-0005.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client', '@db/client', '@db/client.js', '@/db/client*'],
              message:
                'Use tenantClient(workspaceId) from @db. The unscoped client is confined to src/db.',
            },
          ],
        },
      ],
    },
  },

  // ── Boundary B: the analytics layer is pure ──────────────────────────────
  // No database, no cache, no network, no clock, no randomness. This is what
  // makes every formula testable against fixtures with exact expected values.
  // Type-only imports from @db are banned too: the point is not merely to keep
  // I/O out, it is to keep the algorithms independent of the schema.
  {
    files: ['src/analytics/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@db', '@db/*', '@/db', '@/db/*',
                '@prisma/*', '@prisma/client',
                '@providers', '@providers/*',
                '@api/*', '@worker/*',
                'ioredis', 'bullmq', 'express', 'pg',
                'node:fs', 'node:fs/*', 'node:http', 'node:https', 'node:net', 'node:child_process',
              ],
              message:
                'src/analytics must be pure — no I/O and no schema coupling. Load data in the caller and pass DTOs in.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'src/analytics must be pure — no network.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'src/analytics must be deterministic — pass `now` in as a parameter.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'src/analytics must be deterministic — pass `now` in as a parameter.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'src/analytics must be deterministic — use a seeded PRNG passed in.',
        },
      ],
    },
  },

  // ── Boundary C: providers never write ────────────────────────────────────
  {
    files: ['src/providers/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@db', '@db/*', '@/db', '@/db/*', '@prisma/*', '@prisma/client'],
              message:
                'src/providers returns DTOs; persistence is the pipeline’s decision, not the provider’s.',
            },
          ],
        },
      ],
    },
  },

  // ── The boundaries cannot be switched off from inside a file ─────────────
  // Inline `// eslint-disable-*` comments are inert in the three layers whose
  // boundaries ARE the architecture. A genuine exception has to be made here,
  // in this file, where it appears in a diff as an architectural change rather
  // than hiding on one line in the middle of a module.
  {
    files: ['src/analytics/**/*.ts', 'src/providers/**/*.ts', 'src/db/**/*.ts'],
    ignores: ['**/*.test.ts', 'src/db/generated/**'],
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
  },

  /*
   * Tests may reach across boundaries deliberately — that is how a boundary
   * gets verified. The `no-unsafe-*` family is off because an HTTP response
   * body is untyped by nature: asserting on `res.body.data.user.email` is the
   * point of an integration test, and typing it would only restate the
   * assertion.
   */
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },

  prettier,
);
