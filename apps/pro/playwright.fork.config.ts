import { defineConfig, devices } from "@playwright/test"

/**
 * Transaction flows against an Anvil fork of Mezo mainnet (Foundry's
 * `anvil` on PATH). One serial run: the flows share the fork's state and
 * move its clock. It builds Pro for the `fork` env itself; see e2e-fork/global-setup.ts.
 */
export default defineConfig({
  testDir: "./e2e-fork",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["github"]],
  globalSetup: "./e2e-fork/global-setup.ts",
  use: {
    baseURL: "http://localhost:4180",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
})
