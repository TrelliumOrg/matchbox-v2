import { defineConfig } from "vitest/config"

// Unit tests that need no Workers runtime.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.workers.test.ts"],
  },
})
