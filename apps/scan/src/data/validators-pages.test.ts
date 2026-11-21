import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
  scenario: undefined as string | undefined,
  headers: new Map<string, string>(),
}))
vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) =>
    name === "x-scan-fixture" ? state.scenario : undefined,
  setResponseHeader: (name: string, value: string) => {
    state.headers.set(name, value)
  },
}))

const { validatorsPage, validatorPage, validatorTable } = await import(
  "./validators.server"
)
const { matchedProposer, unmatchedProposer, validatorCards, validatorsAnswer } =
  await import("./scan/fixtures/validators")
const { fixtureNow } = await import("./scan/fixtures/shared")

// The fixtures' "now" (Mon 9 Nov 2026, Epoch 47).
vi.useFakeTimers({ toFake: ["Date"] })
vi.setSystemTime(fixtureNow * 1000)

/**
 * The Validators pages' view models from the fixtures: the set and blocks
 * proposed per day from `/validators`, vote shares from the epoch's
 * ranking, each section degrading on its own; before the second daily read
 * the day's counts are "not available yet", and with a validator's count
 * missing the shares are not complete.
 */

function reset(scenario?: string): void {
  state.scenario = scenario
  state.headers.clear()
}

describe("validators", () => {
  it("says which votes an epoch's emissions pay for", async () => {
    // Distributed in Epoch 47, for the validators' votes in Epoch 46.
    reset()
    const page = await validatorsPage({ epoch: null, sort: "share" })
    expect(page.emissions.status).toBe("ok")
    if (page.emissions.status !== "ok") return
    expect(page.emissions.data?.value).toMatch(/ MEZO$/)
    expect(page.emissions.data?.note).toMatch(/for Epoch 46 votes$/)
  })

  it("lists the set with blocks per day, vote shares and incentives", async () => {
    reset()
    const page = await validatorsPage({ epoch: null, sort: "share" })
    expect(page.epoch).toMatchObject({ number: 47, current: true, next: null })
    expect(page.table.status).toBe("ok")
    if (page.table.status !== "ok") return
    const { rows, blocks } = page.table.data
    expect(page.table.data).toMatchObject({ active: 2, left: 1 })
    expect(blocks).toEqual({
      available: true,
      day: "Sun 8 Nov",
      // Of every block on the day, as the API from b07ccde shares them;
      // the rest no listed validator was counted for.
      total: "24,965",
      shareOf: "all_blocks",
      unattributed: { blocks: "2,269", share: "9.1%" },
      complete: true,
      missing: [],
    })
    expect(rows.map((row) => row.gauge.name)).toEqual([
      "Northfield Nodes",
      "Harbor Stake",
      "Tallow & Co",
    ])
    expect(rows[0]).toMatchObject({
      voteShare: "77.7%",
      blocks: "11,512",
      share: "46.1%",
      total: "6,481,203",
    })
    expect(rows[1]).toMatchObject({
      voteShare: "22.3%",
      operator: matchedProposer,
      blocks: "10,944",
      share: "43.8%",
      // 652.17 MEZO, in USD at the epoch's MEZO price.
      incentives: expect.stringMatching(/^\$[\d,]+$/),
    })
    expect(rows[1]?.proUrl).toBe(
      `https://pro.matchbox.markets/vote/validators?pick=${validatorCards.harborStake.gauge.address.toLowerCase()}`,
    )
    // Left the set: no operator, so no blocks and no page.
    expect(rows[2]).toMatchObject({
      status: "left",
      operator: null,
      voteShare: null,
      blocks: null,
      total: null,
    })
    expect(page.table.data.outside).toMatchObject([
      {
        address: unmatchedProposer,
        name: null,
        blocks: "240",
        share: "1.0%",
        total: "120,544",
        // Down in the uptime fixtures: signed nothing in 24 hours.
        uptime: { uptime: "0.00%", missedCount: 22_736 },
      },
    ])
    expect(page.table.data.uptime).toMatchObject({ live: true })
    expect(page.table.data.signing).toBe("20 of 21 signing")
    expect(state.headers.get("x-scan-cache")).toBe("list")
  })

  it("orders by blocks proposed, validators that left last", async () => {
    reset()
    const page = await validatorsPage({ epoch: 46, sort: "proposed" })
    expect(page.epoch).toMatchObject({ number: 46, current: false, next: 47 })
    const votes = page.votes.status === "ok" ? page.votes.data : null
    const history = page.history.status === "ok" ? page.history.data : null
    if (votes === null || votes === "not-yet") throw new Error("no votes")
    if (history === null || history === "not-yet") throw new Error("none")
    expect(votes.gauges).toBe(2)
    expect(history.bars.find((bar) => bar.current)?.epoch).toBe(46)
    if (page.table.status !== "ok") return
    expect(page.table.data.rows.map((row) => row.gauge.name)).toEqual([
      "Northfield Nodes",
      "Harbor Stake",
      "Tallow & Co",
    ])
  })

  it("orders by uptime, and pauses the column while the node is behind", async () => {
    reset()
    const page = await validatorsPage({ epoch: null, sort: "uptime" })
    if (page.table.status !== "ok") throw new Error("no table")
    expect(
      page.table.data.rows.map((row) => [row.gauge.name, row.uptime?.uptime]),
    ).toEqual([
      ["Northfield Nodes", "100.00%"],
      ["Harbor Stake", "99.94%"],
      ["Tallow & Co", undefined],
    ])
    reset("delayed")
    const paused = await validatorsPage({ epoch: null, sort: "uptime" })
    if (paused.table.status !== "ok") throw new Error("no table")
    expect(paused.table.data.uptime).toMatchObject({
      live: false,
      line: "Uptime paused: the node we read is behind",
    })
    expect(paused.table.data.signing).toBeNull()
  })

  it("says the day's counts are not available yet before the second read", async () => {
    reset("filling")
    const page = await validatorsPage({ epoch: null, sort: "share" })
    expect(page.table.status).toBe("ok")
    if (page.table.status !== "ok") return
    expect(page.table.data.blocks).toMatchObject({ available: false })
    expect(
      !page.table.data.blocks.available && page.table.data.blocks.reason,
    ).toBe("A day's count needs two daily reads of each validator's counter")
    // Running totals from the first read still show; no day's count.
    expect(page.table.data.rows[0]).toMatchObject({
      blocks: null,
      share: null,
      total: "6,481,203",
    })
  })

  it("says a new epoch's votes are not available yet, never none", async () => {
    // As live each Thursday before the aggregates run: the epoch's ranking
    // answers no rows and its meta says it is not complete.
    reset("filling")
    const page = await validatorsPage({ epoch: null, sort: "share" })
    expect(page.votes).toEqual({ status: "ok", data: "not-yet" })
    if (page.table.status !== "ok") throw new Error("no table")
    expect(page.table.data.votes).toBe("not-yet")
    expect(page.table.data.rows.every((row) => row.voteShare === null)).toBe(
      true,
    )
    // Once computed, an epoch with no validator votes is none.
    reset()
    const counted = await validatorsPage({ epoch: null, sort: "share" })
    expect(counted.votes.status === "ok" && counted.votes.data).not.toBe(
      "not-yet",
    )
  })

  it("says shares are not available yet without the day's block count", () => {
    // As live once b07ccde is deployed, before the jobs side has two
    // height reads: counts, but no chain.blocks row, so no shares.
    const body = validatorsAnswer("normal")
    const table = validatorTable(
      {
        ...body,
        data: {
          ...body.data,
          share_of: null,
          blocks_in_day: null,
          unattributed_blocks: null,
          shares_complete: false,
          validators: body.data.validators.map((row) => ({
            ...row,
            share_bps: null,
          })),
        },
      },
      null,
      "ok",
      "share",
    )
    expect(table.blocks).toMatchObject({
      available: true,
      shareOf: null,
      unattributed: null,
      total: "22,696",
    })
    expect(table.rows[0]).toMatchObject({ blocks: "11,512", share: null })
  })

  it("reads an API from before shares of every block as of known ones", () => {
    // The deployed API sends no share_of: its shares are of the known
    // validators' sum, and the page says so.
    const body = validatorsAnswer("normal")
    const {
      share_of: _shareOf,
      blocks_in_day: _inDay,
      unattributed_blocks: _rest,
      ...older
    } = body.data
    const table = validatorTable({ ...body, data: older }, null, "ok", "share")
    expect(table.blocks).toMatchObject({
      shareOf: "known",
      total: "22,696",
      unattributed: null,
    })
  })

  it("shows counts without shares while a validator's count is missing", () => {
    const body = validatorsAnswer("normal")
    const incomplete = {
      ...body,
      data: {
        ...body.data,
        shares_complete: false,
        missing_counts: [matchedProposer],
        // As the API sends it: counted validators keep their share of the
        // day's blocks; the page hides every share until all are counted.
        validators: body.data.validators.map((row) =>
          row.address === matchedProposer
            ? { ...row, share_bps: null, blocks: null }
            : row,
        ),
      },
    }
    const table = validatorTable(incomplete, null, "ok", "share")
    expect(table.blocks).toMatchObject({
      available: true,
      complete: false,
      missing: ["Harbor Stake"],
    })
    const harbor = table.rows.find((row) => row.operator === matchedProposer)
    expect(harbor).toMatchObject({ blocks: null, share: null })
    expect(table.rows[0]).toMatchObject({ blocks: "11,512", share: null })
    expect(table.rows.every((row) => row.share === null)).toBe(true)
    expect(table.outside.every((row) => row.share === null)).toBe(true)
  })

  it("shows the current epoch for one past it", async () => {
    reset()
    const page = await validatorsPage({ epoch: 4000, sort: "share" })
    expect(page.epoch.number).toBe(47)
  })

  it("degrades each section on its own while the database is not bound", async () => {
    reset("disabled")
    const page = await validatorsPage({ epoch: null, sort: "share" })
    expect(page.table.status).toBe("disabled")
    expect(page.votes.status).toBe("disabled")
    expect(page.history.status).toBe("disabled")
    expect(state.headers.get("x-scan-degraded")).toBe("1")
  })
})

describe("one validator", () => {
  it("shows its gauge, blocks per day and vote share", async () => {
    reset()
    const page = await validatorPage({ address: matchedProposer })
    expect(page.header.status).toBe("ok")
    if (page.header.status !== "ok") return
    expect(page.header.data).toMatchObject({
      name: "Harbor Stake",
      gauge: validatorCards.harborStake.gauge.address,
      status: "active",
      incentives: "$120.00",
    })
    expect(page.header.data.beneficiary).toMatch(/^0x0+4a5b0f$/)
    expect(page.blocks).toMatchObject({
      status: "ok",
      data: { blocks: "10,944", share: "43.8%", total: "6,112,418" },
    })
    expect(page.share).toMatchObject({
      status: "ok",
      data: { share: "22.3%", rank: "2 of 2" },
    })
    const gauge = page.gauge
    expect(gauge?.voters.status === "ok" && gauge.voters.data.length).toBe(5)
    expect(gauge?.who.status === "ok" && gauge.who.data?.stats).toContainEqual({
      label: "Voters",
      value: "5",
    })
    expect(
      gauge?.deposits.status === "ok" && gauge.deposits.data[0]?.amount,
    ).toBe("652.17 MEZO")
    expect(state.headers.get("x-scan-cache")).toBe("list")
  })

  it("shows a proposer with no validator gauge by its blocks alone", async () => {
    reset()
    const page = await validatorPage({ address: unmatchedProposer })
    expect(page.header).toMatchObject({
      status: "ok",
      data: { gauge: null, proUrl: null },
    })
    expect(page.gauge).toBeNull()
    expect(page.share).toEqual({ status: "ok", data: null })
    expect(page.blocks).toMatchObject({ status: "ok", data: { blocks: "240" } })
  })

  it("is not found for an address that proposes nothing", async () => {
    reset()
    const page = await validatorPage({ address: `0x${"12".repeat(20)}` })
    expect(page.header.status).toBe("missing")
  })

  it("stands while the route cannot be read", async () => {
    reset("disabled")
    const page = await validatorPage({ address: matchedProposer })
    expect(page.header.status).toBe("disabled")
    expect(page.blocks.status).toBe("disabled")
  })
})
