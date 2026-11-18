import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Suites start an in-process Postgres and apply every migration in
    // beforeAll. On a shared CI runner that can take longer than the 10 s
    // default while other packages' tests run beside it.
    hookTimeout: 60_000,
  },
})
