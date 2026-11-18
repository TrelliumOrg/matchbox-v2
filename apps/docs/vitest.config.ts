import { defineConfig } from "vitest/config"

export default defineConfig({
  // The build-time constants vite.config.ts sets: no prerender token and no
  // Stuart, so "Ask about this page" opens search in unit tests.
  define: {
    __DOCS_PRERENDER_TOKEN__: JSON.stringify(""),
    __DOCS_STUART_ORIGIN__: "null",
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
