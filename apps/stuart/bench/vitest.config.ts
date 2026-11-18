import { defineConfig } from "vitest/config"

// The benchmark runs on its own: `pnpm --filter @matchbox/stuart bench`.
export default defineConfig({
  test: {
    include: ["bench/**/*.test.ts"],
    testTimeout: 600_000,
  },
})
