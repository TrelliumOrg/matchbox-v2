import {
  scanUptimeSchema,
  scanValidatorUptimeSchema,
} from "@matchbox/contracts/scan"
import { describe, expect, it } from "vitest"
import { scanFixture } from "./scan/fixtures"
import { fixtureNow } from "./scan/fixtures/shared"
import { matchedProposer, unmatchedProposer } from "./scan/fixtures/validators"
import {
  agoText,
  freshnessOf,
  overviewOf,
  uptimeText,
  validatorUptimeOf,
} from "./uptime-views"

// Validator uptime as the pages show it, over the uptime fixtures (which
// parse with the API's contracts).

function uptime(scenario: "normal" | "delayed" | "filling" = "normal") {
  return scanUptimeSchema.parse(
    scanFixture("uptime", new URLSearchParams(), scenario).body,
  )
}

function validator(
  address: string,
  scenario: "normal" | "delayed" | "filling" = "normal",
) {
  return scanValidatorUptimeSchema.parse(
    scanFixture(`validators/${address}/uptime`, new URLSearchParams(), scenario)
      .body,
  )
}

describe("uptime figures", () => {
  it("rounds down, so 99.995% never reads as 100%", () => {
    expect(uptimeText(9_999)).toBe("99.99%")
    expect(uptimeText(10_000)).toBe("100.00%")
    expect(uptimeText(5)).toBe("0.05%")
  })

  it("says how long ago in words", () => {
    expect(agoText(20)).toBe("under a minute ago")
    expect(agoText(61)).toBe("1 minute ago")
    expect(agoText(7_300)).toBe("2 hours ago")
  })

  it("names the node and its freshness only while live", () => {
    expect(freshnessOf(uptime().data.status, fixtureNow)).toMatchObject({
      live: true,
      line: "From a community node (Pathrock), 2 minutes ago",
    })
    expect(
      freshnessOf(uptime("delayed").data.status, fixtureNow),
    ).toMatchObject({
      live: false,
      line: "Uptime paused: the node we read is behind",
    })
    expect(
      freshnessOf({ ...uptime().data.status, state: "down" }, fixtureNow).line,
    ).toBe("Uptime paused: no community node is answering")
    expect(freshnessOf(uptime("filling").data.status, fixtureNow)).toEqual({
      live: false,
      line: "Uptime not counted yet",
      asOf: null,
    })
  })
})

describe("overviewOf", () => {
  it("gives each operator's 24 hours and the newest block's signers", () => {
    const view = overviewOf(uptime(), fixtureNow)
    expect(view.signing).toMatchObject({ signing: 20, of: 21 })
    expect(view.byOperator[matchedProposer]?.day).toMatchObject({
      uptime: "99.94%",
      missed: "12",
      missedCount: 12,
      proposed: "1,080",
    })
    expect(view.byOperator[unmatchedProposer]?.day.uptime).toBe("0.00%")
  })
})

describe("validatorUptimeOf", () => {
  it("orders the strip oldest first and counts its misses", () => {
    const view = validatorUptimeOf(validator(matchedProposer), fixtureNow)
    expect(view.strip).toHaveLength(100)
    const heights = view.strip.map((block) => block.height)
    expect(heights).toEqual([...heights].sort((a, b) => a - b))
    expect(view.stripSummary).toBe("3 of the last 100 missed")
    expect(view.lastSigned).toBeNull()
    expect(view.windows?.d1).toMatchObject({
      uptime: "99.94%",
      share: "4.75%",
      expected: "4.76%",
      since: null,
    })
    expect(view.windows?.d30.since).not.toBeNull()
  })

  it("says when a validator that stopped signing last signed", () => {
    const view = validatorUptimeOf(validator(unmatchedProposer), fixtureNow)
    expect(view.stripSummary).toBe("100 of the last 100 missed")
    expect(view.lastSigned).toMatch(
      /^Last signed [A-Z][a-z]{2} \d+ [A-Z][a-z]{2}$/,
    )
    expect(view.strip.some((block) => block.missedProposal)).toBe(true)
  })

  it("has no windows for an address the counts never saw", () => {
    const view = validatorUptimeOf(
      validator(`0x${"12".repeat(20)}`),
      fixtureNow,
    )
    expect(view).toMatchObject({ inSet: false, windows: null, strip: [] })
  })
})
