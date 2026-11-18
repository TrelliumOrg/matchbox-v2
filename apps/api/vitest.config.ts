import { defineConfig } from "vitest/config"

// Unit tests that need no Workers runtime (the ported developer-api suite).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.workers.test.ts"],
  },
})
