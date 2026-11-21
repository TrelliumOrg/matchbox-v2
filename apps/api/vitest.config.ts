import { defineConfig } from "vitest/config"

// Unit tests that need no Workers runtime (the ported developer-api suite).
export default defineConfig({
  test: {
    // The same limits locally and in CI (CONTRIBUTING.md, Tests): a slow
    // pass on a busy runner is a pass; the limits only catch a hang.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.workers.test.ts"],
  },
})
