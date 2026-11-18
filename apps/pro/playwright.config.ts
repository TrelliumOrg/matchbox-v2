import { defineConfig, devices } from "@playwright/test"

/**
 * Smoke tests against the built Worker in workerd (`vite preview`), with the
 * Epoch 9 fixtures (`PRO_DATA=fixtures` in .dev.vars, copied from
 * .dev.vars.example before the build). Run `pnpm build` first.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["github"]],
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
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
    command: "pnpm preview",
    url: "http://localhost:4173",
    reuseExistingServer: process.env.CI === undefined,
    timeout: 60_000,
  },
})
