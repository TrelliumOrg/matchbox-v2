import { defineConfig, devices } from "@playwright/test"

/**
 * Cutover flows against the built Worker in workerd (`vite preview`) on the
 * memory store: copy .dev.vars.example to .dev.vars (PLATFORM_STORE=memory,
 * ISSUER=http://localhost:5180) and run `pnpm build` first. The server
 * starts fresh, so the seed (worker/store/memory-store.ts) is the same every
 * run. Every test fails on a console error.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: "list",
  use: { baseURL: "http://localhost:5180", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm preview > .e2e-server.log 2>&1",
    url: "http://localhost:5180/.well-known/openid-configuration",
    reuseExistingServer: false,
    timeout: 90_000,
  },
})
