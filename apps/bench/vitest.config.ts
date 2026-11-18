import { defineConfig } from "vitest/config"
import questionIndex from "./scripts/question-index.mjs"

export default defineConfig({
  define: { __BENCH_PRERENDER_TOKEN__: JSON.stringify("") },
  plugins: [questionIndex()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
