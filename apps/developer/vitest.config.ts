import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Some suites drive hundreds of requests; turbo runs every package at
    // once, so the 5s default flakes under load (the slowest takes 0.2s alone).
    // The same limits locally and in CI (CONTRIBUTING.md, Tests). Each
    // project sets them too: an inline project does not inherit these.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    projects: [
      {
        test: {
          name: "worker",
          environment: "node",
          include: ["src/worker/**/*.test.ts", "src/lib/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: "app",
          environment: "happy-dom",
          testTimeout: 30_000,
          hookTimeout: 60_000,
          include: ["src/app/**/*.test.{ts,tsx}"],
          setupFiles: ["./src/app/test-setup.ts"],
        },
      },
    ],
  },
})
