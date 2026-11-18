// @vitest-environment node
import { describe, expect, it } from "vitest"
import config, { e2ePort } from "../playwright.config"

/**
 * The smoke tests run against their own preview: never one already
 * listening (another checkout's build), never measure's or Lighthouse's.
 */
describe("the e2e config", () => {
  it("starts its own preview on its own port", () => {
    const server = Array.isArray(config.webServer)
      ? config.webServer[0]
      : config.webServer
    expect(server?.reuseExistingServer).toBe(false)
    expect([4173, 4174]).not.toContain(e2ePort)
    expect(server?.command).toContain(`--port ${e2ePort} --strictPort`)
    expect(config.use?.baseURL).toBe(`http://localhost:${e2ePort}`)
  })
})
