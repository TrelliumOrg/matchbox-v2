import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Suites start an in-process Postgres (PGlite) and apply every
    // migration in beforeAll, and some tests replay a whole migration
    // history: 10 to 15 s each on the CI laptop, against vitest's 5 s and
    // 10 s defaults. The same limits locally and in CI (CONTRIBUTING.md,
    // Tests); they only catch a hang.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
