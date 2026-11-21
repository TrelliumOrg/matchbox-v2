import { defineConfig } from "vitest/config"

export default defineConfig({
  // The build-time constants vite.config.ts sets: no prerender token and no
  // Stuart, so "Ask about this page" opens search in unit tests.
  define: {
    __DOCS_PRERENDER_TOKEN__: JSON.stringify(""),
    __DOCS_STUART_ORIGIN__: "null",
  },
  test: {
    // The same limits locally and in CI (CONTRIBUTING.md, Tests): a slow
    // pass on a busy runner is a pass; the limits only catch a hang.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
