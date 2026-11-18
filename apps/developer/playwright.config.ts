import { defineConfig, devices } from "@playwright/test"

/**
 * Cutover flows against the built Worker in workerd (`vite preview`) on the
 * memory store: copy .dev.vars.example to .dev.vars (PLATFORM_STORE=memory)
 * and run `pnpm build` first. Every test fails on a console error. The
 * server starts fresh (fresh seed) and logs to .e2e-server.log, where the
 * invitation test reads the link the memory store's log mailer printed.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: "list",
  use: { baseURL: "http://localhost:5175", trace: "retain-on-failure" },
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
    url: "http://localhost:5175/sign-in",
    reuseExistingServer: false,
    timeout: 90_000,
  },
})
