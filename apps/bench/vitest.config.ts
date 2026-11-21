import { defineConfig } from "vitest/config"
import questionIndex from "./scripts/question-index.mjs"

export default defineConfig({
  define: { __BENCH_PRERENDER_TOKEN__: JSON.stringify("") },
  plugins: [questionIndex()],
  test: {
    // The same limits locally and in CI (CONTRIBUTING.md, Tests): a slow
    // pass on a busy runner is a pass; the limits only catch a hang.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
