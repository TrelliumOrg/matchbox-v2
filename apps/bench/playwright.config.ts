import { defineConfig, devices } from "@playwright/test"

/**
 * End to end tests against the built site in workerd (`vite preview`), the
 * way Cloudflare serves it: static assets first, `_headers` and the 404
 * page. Run `pnpm build` first. Port 4203, clear of the other apps.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["github"]],
  use: { baseURL: "http://localhost:4203", trace: "retain-on-failure" },
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
    url: "http://localhost:4203/favicon.svg",
    reuseExistingServer: process.env.CI === undefined,
    timeout: 60_000,
  },
})
