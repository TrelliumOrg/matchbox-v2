import { defineConfig, devices } from "@playwright/test"

/**
 * Smoke tests against the built site in workerd (`vite preview`), the way
 * Cloudflare serves it: static assets first, `_redirects`, `_headers` and
 * the 404 page. Run `pnpm build` first. Port 4183, so it never collides
 * with the other apps' previews on 4173.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["github"]],
  use: { baseURL: "http://localhost:4183", trace: "retain-on-failure" },
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
    url: "http://localhost:4183/favicon.svg",
    reuseExistingServer: process.env.CI === undefined,
    timeout: 60_000,
  },
})
