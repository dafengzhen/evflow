import css from '@eslint/css';
import js from '@eslint/js';
import json from '@eslint/json';
import markdown from '@eslint/markdown';
import perfectionist from 'eslint-plugin-perfectionist';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    extends: ['js/recommended'], files: ['**/*.{js,mjs,cjs,ts,mts,cts}'], languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }, plugins: { js }
  },
  tseslint.configs.recommended,
  {
    extends: ['json/recommended'],
    files: ['**/*.json'],
    ignores: ['package-lock.json'],
    language: 'json/json',
    plugins: { json },
    rules: {
      'json/sort-keys': ['error', 'asc', { natural: true }]
    }
  },
  {
    extends: ['json/recommended'],
    files: ['**/*.jsonc'],
    language: 'json/jsonc',
    plugins: { json }
  },
  {
    extends: ['json/recommended'],
    files: ['**/*.json5'],
    language: 'json/json5',
    plugins: { json }
  },
  { extends: ['markdown/recommended'], files: ['**/*.md'], language: 'markdown/commonmark', plugins: { markdown } },
  { extends: ['css/recommended'], files: ['**/*.css'], language: 'css/css', plugins: { css } },
  {
    ignores: ['**/build/**', '**/dist/**', 'node_modules/']
  },
  {
    ...perfectionist.configs['recommended-natural'],
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    ignores: ['**/build/**', '**/dist/**', 'node_modules/'],
    rules: {
      ...perfectionist.configs['recommended-natural'].rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          'argsIgnorePattern': '^_',
          'caughtErrorsIgnorePattern': '^_',
          'varsIgnorePattern': '^_'
        }
      ],
      curly: 'error'
    }
  }
]);
