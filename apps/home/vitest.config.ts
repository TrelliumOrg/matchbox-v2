import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  define: { __HOME_BUILD_ID__: JSON.stringify("test-build") },
  resolve: {
    alias: {
      // Workers' runtime module; tests that import a .server module mock it.
      "cloudflare:workers": fileURLToPath(
        new URL("./src/test-workers-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    // The same limits locally and in CI (CONTRIBUTING.md, Tests): a slow
    // pass on a busy runner is a pass; the limits only catch a hang.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
})
