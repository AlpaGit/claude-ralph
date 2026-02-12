import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import reactRefreshPlugin from "eslint-plugin-react-refresh";
import prettierConfig from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import globals from "globals";

// ── Shared rules applied to all non-test TypeScript files ─────────
const baseTypescriptRules = {
  "prettier/prettier": "warn",
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { prefer: "type-imports", fixStyle: "separate-type-imports" },
  ],
  "@typescript-eslint/no-non-null-assertion": "warn",
  "@typescript-eslint/prefer-nullish-coalescing": "off",
};

// ── Shared parser options for type-aware linting ──────────────────
const baseParserOptions = {
  projectService: true,
  tsconfigRootDir: import.meta.dirname,
};

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────────────
  {
    ignores: [
      "out/**",
      "dist/**",
      "node_modules/**",
      "test-results/**",
      "coverage/**",
      "resources/**",
      "src/test-utils/**",
      "*.config.ts",
      "*.config.js",
    ],
  },

  // ── Base JS recommended rules ───────────────────────────────────
  js.configs.recommended,

  // ── TypeScript strict + stylistic (replaces airbnb-typescript) ──
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,

  // ── Prettier: disable conflicting formatting rules ──────────────
  prettierConfig,

  // ── Main / Preload / Shared (Node-side TypeScript) ──────────────
  {
    files: ["src/main/**/*.ts", "src/preload/**/*.ts", "src/shared/**/*.ts"],
    languageOptions: {
      parserOptions: baseParserOptions,
      globals: { ...globals.node },
    },
    plugins: { prettier: prettierPlugin },
    rules: { ...baseTypescriptRules },
  },

  // ── Test files (relaxed) ────────────────────────────────────────
  {
    files: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/*.spec.ts",
      "src/**/*.spec.tsx",
      "tests/**/*.ts",
      "tests/**/*.tsx",
    ],
    languageOptions: {
      parserOptions: baseParserOptions,
      globals: { ...globals.node },
    },
    plugins: { prettier: prettierPlugin },
    rules: {
      "prettier/prettier": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // ── Renderer (React + Browser TypeScript) ───────────────────────
  {
    files: ["src/renderer/**/*.ts", "src/renderer/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        ...baseParserOptions,
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "react-refresh": reactRefreshPlugin,
      prettier: prettierPlugin,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...baseTypescriptRules,
      // ── React ──
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactPlugin.configs.flat["jsx-runtime"].rules,
      "react/prop-types": "off",
      "react/display-name": "off",
      // ── React Hooks (strict per PRD) ──
      ...reactHooksPlugin.configs["recommended-latest"].rules,
      "react-hooks/exhaustive-deps": "error",
      // ── React Refresh ──
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
