import eslintPluginYml from 'eslint-plugin-yml';
import eslintPluginJsonc from 'eslint-plugin-jsonc';
import * as yamlParser from 'yaml-eslint-parser';
import * as jsoncParser from 'jsonc-eslint-parser';

export default [
  ...eslintPluginYml.configs['flat/standard'],
  ...eslintPluginJsonc.configs['flat/recommended-with-jsonc'],
  {
    files: ['**/*.yaml', '**/*.yml'],
    languageOptions: {
      parser: yamlParser,
    },
    rules: {
      'yml/no-multi-spaces': 'off',
      'yml/key-spacing': ['error', { mode: 'minimum' }],
      'yml/quotes': ['error', { prefer: 'double', avoidEscape: true }],
      'yml/indent': ['error', 2],
    },
  },
  {
    files: ['**/*.json', '**/*.jsonc'],
    languageOptions: {
      parser: jsoncParser,
    },
    rules: {
      'jsonc/no-multi-spaces': 'off',
      'jsonc/key-spacing': ['error', { mode: 'minimum' }],
      'jsonc/array-bracket-spacing': 'off',
      'jsonc/object-curly-spacing': 'off',
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', '.github/', 'artifacts/'],
  }
];
