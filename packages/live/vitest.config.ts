import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // The same limits locally and in CI (CONTRIBUTING.md, Tests): a slow
    // pass on a busy runner is a pass; the limits only catch a hang.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: "happy-dom",
    setupFiles: ["./src/test-setup.ts"],
  },
})
