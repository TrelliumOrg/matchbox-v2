import { defineConfig, devices } from "@playwright/test"

/**
 * Smoke tests against the built Worker in workerd (`vite preview`) with the
 * fixtures (`SCAN_DATA=fixtures` in .dev.vars, copied from .dev.vars.example
 * before the build). Run `pnpm build` first.
 *
 * The tests start their own preview on their own port (`SCAN_E2E_PORT`,
 * 4175 by default: measure uses 4173 and Lighthouse 4174) and never reuse
 * a server already listening there, so a run cannot test another
 * checkout's build. A port in use fails the run instead.
 */
export const e2ePort = Number(process.env.SCAN_E2E_PORT ?? 4175)
const origin = `http://localhost:${e2ePort}`

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["github"]],
  use: { baseURL: origin, trace: "retain-on-failure" },
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
    command: `pnpm exec vite preview --port ${e2ePort} --strictPort`,
    url: origin,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
