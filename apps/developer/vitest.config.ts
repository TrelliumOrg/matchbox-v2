import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Some suites drive hundreds of requests; turbo runs every package at
    // once, so the 5s default flakes under load (the slowest takes 0.2s alone).
    testTimeout: 30_000,
    projects: [
      {
        test: {
          name: "worker",
          environment: "node",
          include: ["src/worker/**/*.test.ts", "src/lib/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "app",
          environment: "happy-dom",
          include: ["src/app/**/*.test.{ts,tsx}"],
          setupFiles: ["./src/app/test-setup.ts"],
        },
      },
    ],
  },
})
