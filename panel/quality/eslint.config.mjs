import js from '@eslint/js';
import globals from 'globals';
import {nativeTemplates} from './template-rules.mjs';

export default [
  {
    files: ['panel/applications/*/public/**/*.js'],
    plugins: {product: {rules: {'native-templates': nativeTemplates}}},
    rules: {'product/native-templates': 'error'},
  },
  {
    ignores: [
      '**/node_modules/**',
      'panel/test/fixtures/**',
      'output/**',
      'dist/**',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      'no-constant-condition': ['error', {checkLoops: false}],
      'no-empty': ['error', {allowEmptyCatch: true}],
      'no-var': 'error',
      // These validators intentionally reject control bytes and sanitize terminal
      // escape sequences. Escaped control characters are part of their contract.
      'no-control-regex': 'off',
      eqeqeq: ['error', 'always', {null: 'ignore'}],
    },
  },
  {
    files: ['panel/public/**/*.js', 'panel/applications/*/public/**/*.js'],
    languageOptions: {
      globals: Object.fromEntries([
        ...Object.keys(globals.node).map((key) => [key, 'off']),
        ...Object.entries(globals.browser),
      ]),
    },
  },
];
