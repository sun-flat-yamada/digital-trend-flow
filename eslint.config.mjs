import eslintPluginYml from "eslint-plugin-yml";
import eslintPluginJsonc from "eslint-plugin-jsonc";
import * as yamlParser from "yaml-eslint-parser";
import * as jsoncParser from "jsonc-eslint-parser";
import tseslint from "typescript-eslint";

export default [
  ...eslintPluginYml.configs["flat/standard"],
  ...eslintPluginJsonc.configs["flat/recommended-with-jsonc"],
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["**/*.ts"] })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type-aware rules for promises: a forgotten await silently drops errors in the pipeline.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // Tests load modules with require() to get a fresh module registry after jest.mock / resetModules.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["**/*.yaml", "**/*.yml"],
    languageOptions: {
      parser: yamlParser,
    },
    rules: {
      "yml/no-multi-spaces": "off",
      "yml/key-spacing": ["error", { mode: "minimum" }],
      "yml/quotes": ["error", { prefer: "double", avoidEscape: true }],
      "yml/indent": ["error", 2],
    },
  },
  {
    files: ["**/*.json", "**/*.jsonc"],
    languageOptions: {
      parser: jsoncParser,
    },
    rules: {
      "jsonc/no-multi-spaces": "off",
      "jsonc/key-spacing": ["error", { mode: "minimum" }],
      "jsonc/array-bracket-spacing": "off",
      "jsonc/object-curly-spacing": "off",
    },
  },
  {
    ignores: ["node_modules/", "dist/", "coverage/", ".github/", "artifacts/", "_tmp_ai/", "_site/"],
  },
];
