import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
  scenario: undefined as string | undefined,
}))
vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) =>
    name === "x-scan-fixture" ? state.scenario : undefined,
  setResponseHeader: () => undefined,
}))

const { knownNames, forgetNames, namesKeepMs } = await import("./names.server")
const { nameViews, nameVotes, namesFromValidators, mergeNames, noNames } =
  await import("./names")
const { matchedProposer, unmatchedProposer, validatorCards } = await import(
  "./fixtures/validators"
)
const { blockRow } = await import("../views")
const { mainPageBlocksSchema } = await import("@matchbox/contracts/blockscout")
const recorded = await import("../blockscout/fixtures/main-page-blocks.json")

/**
 * Proposers and gauges named from one cached lookup: validators by their
 * directory name (else Scan's label), gauges by Pro's directory, labels
 * of ours winning, and no read per row or per page.
 */

const view = (address: string, label: unknown = null) => ({
  address,
  name: null,
  contract: false,
  label,
})

describe("names", () => {
  it("names a validator by its name, else its label, and its gauge", () => {
    const names = namesFromValidators({
      validators: [
        { address: "0xAA", name: "aras.haus", label: null, gauge: "0xGA" },
        { address: "0xbb", name: null, label: "Kiln", gauge: null },
        { address: "0xcc", name: " ", label: null, gauge: null },
      ],
      pool_without_operator: [{ gauge: "0xGD", name: "Tallow & Co" }],
    })
    expect(names.validators).toEqual({ "0xaa": "aras.haus", "0xbb": "Kiln" })
    expect(names.gauges).toEqual({ "0xga": "aras.haus", "0xgd": "Tallow & Co" })
  })

  it("fills only addresses with no label of ours", () => {
    const names = mergeNames(noNames, {
      validators: { "0xaa": "aras.haus" },
      gauges: { "0xbb": "BTC/MUSD" },
    })
    const ours = { name: "Treasury", kind: "protocol", tags: [] }
    const page = nameViews(
      { rows: [view("0xaa"), view("0xbb"), view("0xaa", ours), view("0xcc")] },
      names,
    )
    expect(page.rows.map((row) => row.label)).toEqual([
      { name: "aras.haus", kind: "validator", tags: [] },
      { name: "BTC/MUSD", kind: "gauge", tags: [] },
      ours,
      null,
    ])
  })

  it("prefers a gauge's directory name over a generated label", () => {
    const epochs = nameVotes(
      [
        {
          epoch: 47,
          votes: [
            { gauge: "0xB4", gaugeName: "Gauge Pool 0xb4d4…51cc" },
            { gauge: "0xc5", gaugeName: "Kept" },
          ],
        },
      ],
      { validators: {}, gauges: { "0xb4": "BTC/MUSD" } },
    )
    expect(epochs[0]?.votes.map((vote) => vote.gaugeName)).toEqual([
      "BTC/MUSD",
      "Kept",
    ])
  })
})

describe("the isolate's lookup", () => {
  it("names the recorded blocks' proposers from the fixtures", async () => {
    forgetNames()
    state.scenario = undefined
    const names = await knownNames()
    expect(names.validators[matchedProposer]).toBe(
      validatorCards.harborStake.gauge.name,
    )
    expect(names.validators[unmatchedProposer]).toBeUndefined()
    const blocks = mainPageBlocksSchema.parse(recorded.default)
    const rows = nameViews(blocks.map(blockRow), names)
    const named = rows.find((row) => row.miner.address === matchedProposer)
    expect(named?.miner.label?.name).toBe(validatorCards.harborStake.gauge.name)
  })

  it("reads once for many pages, and again after five minutes", async () => {
    forgetNames()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(1_800_000_000_000)
    const first = await Promise.all([knownNames(), knownNames()])
    expect(first[0]).toBe(first[1])
    expect(await knownNames()).toBe(first[0])
    vi.setSystemTime(1_800_000_000_000 + namesKeepMs + 1)
    expect(await knownNames()).not.toBe(first[0])
    vi.useRealTimers()
  })

  it("keeps the last names when a read fails", async () => {
    forgetNames()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(1_800_000_000_000)
    state.scenario = undefined
    const good = await knownNames()
    vi.setSystemTime(1_800_000_000_000 + namesKeepMs + 1)
    state.scenario = "disabled"
    const after = await knownNames()
    expect(after.validators).toEqual(good.validators)
    state.scenario = undefined
    vi.useRealTimers()
  })
})
