import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * In fixtures mode every page's "now" is the fixture world's (Mon 9 Nov
 * 2026, Epoch 47), so from Thu 12 Nov on dev and e2e never show Epoch 48
 * beside Epoch 47's data.
 */

vi.mock("cloudflare:workers", () => ({ env: { SCAN_DATA: "fixtures" } }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: () => {},
}))

const { networkOverview } = await import("./network.server")
const { validatorsPage } = await import("./validators.server")
const { epochStart, fixtureNow } = await import("./scan/fixtures/shared")

describe("the fixture clock", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    // A week after the fixture world, well into Epoch 48.
    vi.setSystemTime((epochStart(48) + 7 * 86_400) * 1000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("holds the network and validators pages on the fixture world's day", async () => {
    expect((await networkOverview({ range: "30d" })).now).toBe(fixtureNow)
    const validators = await validatorsPage({ epoch: null, sort: "share" })
    expect(validators.now).toBe(fixtureNow)
    expect(validators.epoch.number).toBe(47)
  })
})
