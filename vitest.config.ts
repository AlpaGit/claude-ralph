import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared")
    }
  },
  test: {
    // Default environment for main-process tests (DB, schemas, migrations).
    // Renderer tests opt in to jsdom via per-file annotation:
    //   // @vitest-environment jsdom
    environment: "node",
    globals: false,
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/*.spec.ts",
      "src/**/*.spec.tsx",
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx"
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.spec.ts",
        "src/**/*.spec.tsx",
        "src/**/test-utils/**",
        "src/renderer/vite-env.d.ts"
      ]
    },
    // Sensible defaults
    restoreMocks: true,
    testTimeout: 10_000
  }
});
