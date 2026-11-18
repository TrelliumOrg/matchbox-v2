import { describe, expect, it, vi } from "vitest"
import type { GaugeRow } from "./gauges.server"

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
  /** Per path: edits a read's parsed data before the page sees it. */
  edits: new Map<string, (data: never) => unknown>(),
  /** Per path: the read answers only once this promise settles. */
  holds: new Map<string, Promise<void>>(),
  /** Paths read, in the order the reads started. */
  started: [] as string[],
}))
vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: () => undefined,
}))
vi.mock("./scan/read.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("./scan/read.server")>()
  return {
    ...real,
    readScan: async (...args: Parameters<typeof real.readScan>) => {
      state.started.push(args[0])
      await state.holds.get(args[0])
      const read = await real.readScan(...args)
      const edit = state.edits.get(args[0])
      return edit === undefined || read.status !== "ok"
        ? read
        : { ...read, data: edit(read.data as never) }
    },
  }
})

const { gaugesPage, gaugePage } = await import("./gauges.server")
const { liveVotes, lockPage, locksPage, voteReadsMost } = await import(
  "./locks.server"
)
const { epochPage } = await import("./epochs.server")
const { epochStart } = await import("./scan/fixtures/shared")
const { gauges } = await import("./scan/fixtures/world")
const { demoKindCards, demoTokens } = await import(
  "@matchbox/contracts/read-models/fixtures"
)

/**
 * The review's fixes on the voting pages, each against the fixtures with
 * one read edited to the case at hand.
 */

type Card = {
  gauge: { address: string }
  incentives: {
    usd: string
    tokens: { token: unknown; amount: string; usd: string | null }[]
  }
}
type Directory = { data: { gauges: Card[] } }

function withIncentives(
  address: string,
  incentives: Card["incentives"],
): (body: Directory) => Directory {
  return (body) => ({
    ...body,
    data: {
      ...body.data,
      gauges: body.data.gauges.map((card) =>
        card.gauge.address.toLowerCase() === address
          ? { ...card, incentives }
          : card,
      ),
    },
  })
}

describe("unpriced incentives", () => {
  const onlyUnpriced = {
    usd: "0",
    tokens: [{ token: demoTokens.mezo, amount: "2500", usd: null }],
  }
  const partlyPriced = {
    usd: "500.00",
    tokens: [
      { token: demoTokens.mezo, amount: "2717.39", usd: "500.00" },
      { token: demoTokens.musd, amount: "10", usd: null },
    ],
  }

  it("say so instead of $0.00, and sort as unknown", async () => {
    const northgate = withIncentives(gauges.northgate, onlyUnpriced)
    const hearth = withIncentives(gauges.hearthCapital, partlyPriced)
    state.edits.set("gauges", (body: Directory) => hearth(northgate(body)))
    try {
      // Every page of the order: unknown totals sort last, past the
      // first page of a production-sized directory.
      const rows: GaugeRow[] = []
      let after: string | null = null
      do {
        const page = await gaugesPage({ type: "all", sort: "rewards", after })
        if (page.directory.status !== "ok") throw new Error("no directory")
        rows.push(...page.directory.data.rows)
        after = page.directory.data.next
      } while (after !== null)
      const row = (address: string) =>
        rows.find((each) => each.gauge.address === address)
      expect(row(gauges.northgate)?.rewards).toBe("Unpriced")
      expect(row(gauges.hearthCapital)?.rewards).toBe("$500.00 + unpriced")
      // Every gauge with a known total (even $0.00) sorts above them.
      const unknown = rows.findIndex(
        (each) =>
          each.gauge.address === gauges.northgate ||
          each.gauge.address === gauges.hearthCapital,
      )
      const known = rows
        .slice(unknown)
        .filter(
          (each) =>
            !each.expired &&
            each.gauge.address !== gauges.northgate &&
            each.gauge.address !== gauges.hearthCapital,
        )
      expect(known).toEqual([])
    } finally {
      state.edits.clear()
    }
  })

  it("say so on a gauge's header and incentives panel", async () => {
    state.edits.set(
      `gauges/${gauges.kilnLabs}`,
      (body: { data: { card: Card } }) => ({
        ...body,
        data: {
          ...body.data,
          card: { ...body.data.card, incentives: partlyPriced },
        },
      }),
    )
    try {
      const page = await gaugePage({ gauge: gauges.kilnLabs, range: "30d" })
      if (page.header.status !== "ok") throw new Error("no header")
      expect(page.header.data.incentives).toBe("$500.00 + unpriced")
      expect(page.header.data.stats).toContainEqual(
        expect.objectContaining({
          label: "Incentives",
          value: "$500.00 + unpriced",
        }),
      )
      expect(
        page.incentives.status === "ok" && page.incentives.data?.figure,
      ).toBe("$500.00 + unpriced")
    } finally {
      state.edits.clear()
    }
  })
})

describe("a pool gauge's charts", () => {
  it("are labelled as the one token their series count", async () => {
    const page = await gaugePage({
      gauge: demoKindCards.btcMusdCl.gauge.address.toLowerCase(),
      range: "30d",
    })
    expect(page.pool).toMatchObject({
      volumeLabel: "BTC swapped into BTC/MUSD",
      liquidityLabel: "BTC in BTC/MUSD",
    })
    expect(page.pool?.liquidityStats.map((stat) => stat.label)).toEqual([
      "MUSD in pool",
    ])
  })
})

describe("a pool gauge's reads", () => {
  it("start the pool's series once the profile answers", async () => {
    const gauge = demoKindCards.btcMusdCl.gauge.address.toLowerCase()
    let release = () => {}
    state.holds.set(
      `gauges/${gauge}/voters`,
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    state.started.length = 0
    try {
      const page = gaugePage({ gauge, range: "30d" })
      // The voters read stays out for the whole wait, so the series can
      // only start from the profile; waiting for that, not for a fixed
      // time, holds on a loaded machine.
      await vi.waitFor(() => expect(state.started).toContain("series"), {
        timeout: 5_000,
      })
      release()
      expect((await page).pool?.name).toBe("BTC/MUSD")
    } finally {
      release()
      state.holds.clear()
    }
  })
})

describe("a lock's vote history", () => {
  type Vote = {
    epoch_start: number
    gauge: string
    weight: string
    carried: boolean
  }
  type VotePage = { data: Vote[]; nextCursor: string | null }

  // Reads of a lock with more votes than a read holds, in turn: each
  // read's votes from `pages`, the cursor on all but the last.
  function readsOf(pages: [epoch: number, gauge: string][][], more = false) {
    let read = 0
    return (body: VotePage): VotePage => {
      const [first] = body.data
      if (first === undefined) throw new Error("no votes")
      const index = read
      read += 1
      const votes = pages[index] ?? []
      return {
        ...body,
        data: votes.map(([epoch, gauge]) => ({
          ...first,
          epoch_start: epochStart(epoch),
          gauge,
          weight: "6000000000000000000000",
          carried: false,
        })),
        nextCursor: more || index < pages.length - 1 ? `fx${index + 1}` : null,
      }
    }
  }

  const path = "locks/vemezo/2207/votes"
  const reads = () => state.started.filter((each) => each === path).length

  it("reads on past an epoch a read cut", async () => {
    // Epoch 46's second vote is in the second read.
    state.edits.set(
      path,
      readsOf([
        [
          [47, gauges.kilnLabs],
          [47, gauges.northgate],
          [46, gauges.kilnLabs],
        ],
        [[46, gauges.northgate]],
      ]),
    )
    state.started.length = 0
    try {
      const page = await lockPage({ escrow: "vemezo", id: "2207" })
      if (page.votes.status !== "ok") throw new Error("no votes")
      expect(reads()).toBe(2)
      expect(page.votes.data.cut).toBe(false)
      expect(page.votes.data.splits.map((split) => split.epoch)).toEqual([
        47, 46,
      ])
      expect(page.votes.data.splits[1]?.parts).toHaveLength(2)
    } finally {
      state.edits.clear()
    }
  })

  it("stops after its reads, leaves out an epoch they cut, and says so", async () => {
    // A lock voting for many gauges: each read holds one epoch.
    const epoch = (number: number): [number, string][] => [
      [number, gauges.kilnLabs],
      [number, gauges.northgate],
    ]
    state.edits.set(
      path,
      readsOf([epoch(47), epoch(46), epoch(45), epoch(44), epoch(43)], true),
    )
    state.started.length = 0
    try {
      const page = await lockPage({ escrow: "vemezo", id: "2207" })
      if (page.votes.status !== "ok") throw new Error("no votes")
      expect(reads()).toBe(voteReadsMost)
      expect(page.votes.data.cut).toBe(true)
      // Epoch 44 may go on in the next read: left out.
      expect(page.votes.data.splits.map((split) => split.epoch)).toEqual([
        47, 46, 45,
      ])
    } finally {
      state.edits.clear()
    }
  })

  type LockDocument = {
    data: unknown
    indexed?: boolean
    live?: {
      votes: { gauge: string; source: string; weight: string }[]
      last_voted_at: number | null
    } | null
  }
  const lockPath = "locks/vemezo/2207"
  const votesCard = (page: Awaited<ReturnType<typeof lockPage>>) =>
    page.cards.find((card) => card.label === "Votes Epoch 47")?.value

  it("takes this epoch's votes from the chain over the stored ones", async () => {
    // Voted again since the copy: all on one gauge.
    state.edits.set(lockPath, (body: LockDocument) => ({
      ...body,
      live: {
        ...body.live,
        votes: [
          {
            gauge: gauges.satsCollective,
            source: "BOOST_VOTER",
            weight: "18402000000000000000000",
          },
        ],
        last_voted_at: epochStart(47) + 90_000,
      },
    }))
    try {
      const page = await lockPage({ escrow: "vemezo", id: "2207" })
      if (page.votes.status !== "ok") throw new Error("no votes")
      expect(page.votes.data.splits.map((split) => split.epoch)).toEqual([
        47, 46, 45,
      ])
      expect(
        page.votes.data.splits[0]?.parts.map((part) => part.gauge.address),
      ).toEqual([gauges.satsCollective])
      expect(page.votes.data.splits[0]?.carried).toBe(false)
      expect(votesCard(page)).toBe("18,402 veMEZO")
    } finally {
      state.edits.clear()
    }
  })

  it("says a lock whose votes the chain has reset has not voted this epoch", async () => {
    state.edits.set(lockPath, (body: LockDocument) => ({
      ...body,
      live: { ...body.live, votes: [] },
    }))
    try {
      const page = await lockPage({ escrow: "vemezo", id: "2207" })
      if (page.votes.status !== "ok") throw new Error("no votes")
      expect(page.votes.data.splits.map((split) => split.epoch)).toEqual([
        46, 45,
      ])
      expect(votesCard(page)).toBe("Not voted")
    } finally {
      state.edits.clear()
    }
  })

  it("keeps the stored votes and leaves voting power out when the chain was not read", async () => {
    state.edits.set(lockPath, (body: LockDocument) => ({ ...body, live: null }))
    try {
      const page = await lockPage({ escrow: "vemezo", id: "2207" })
      if (page.votes.status !== "ok") throw new Error("no votes")
      expect(page.votes.data.splits.map((split) => split.epoch)).toEqual([
        47, 46, 45,
      ])
      expect(page.cards.map((card) => card.label)).toEqual([
        "Amount locked",
        "Unlocks",
        "Votes Epoch 47",
        "Boost",
      ])
    } finally {
      state.edits.clear()
    }
  })

  it("decides carried per voter, from that voter's own last vote", () => {
    // veBTC votes validators and pools on separate voters: a fresh vote on
    // one leaves the other's earlier vote carried.
    const start = epochStart(47)
    const rows = liveVotes(
      { escrow: "0xve", token_id: "604" },
      {
        block: 1,
        voting_power: "1",
        votes: [
          {
            gauge: gauges.kilnLabs,
            source: "VALIDATORS_VOTER",
            weight: "1",
            voted_at: start + 3_600,
          },
          {
            gauge: gauges.northgate,
            source: "POOLS_VOTER",
            weight: "1",
            voted_at: start - 86_400,
          },
        ],
        last_voted_at: start + 3_600,
      },
      start + 7_200,
    )
    expect(rows.map((row) => [row.source, row.carried, row.voted_at])).toEqual([
      ["VALIDATORS_VOTER", false, start + 3_600],
      ["POOLS_VOTER", true, start - 86_400],
    ])
  })

  it("is whole when one page holds it", async () => {
    const page = await lockPage({ escrow: "vemezo", id: "2207" })
    if (page.votes.status !== "ok") throw new Error("no votes")
    expect(page.votes.data.cut).toBe(false)
    expect(page.votes.data.splits.map((split) => split.epoch)).toEqual([
      47, 46, 45,
    ])
  })
})

describe("an epoch whose vote weights are not integers", () => {
  type Item = { vote_weight: Record<string, string> }
  type EpochDoc = { data: { epoch: Item } | null }

  it("fails its read instead of throwing", async () => {
    const { scanFixture } = await import("./scan/fixtures")
    const { scanSchemas } = await import("./scan/schemas")
    const body = scanFixture(`epochs/${epochStart(47)}`, new URLSearchParams())
      .body as EpochDoc
    const epoch = body.data?.epoch
    if (epoch === undefined) throw new Error("no epoch")
    const bad = {
      ...body,
      data: {
        ...body.data,
        epoch: { ...epoch, vote_weight: { BOOST_VOTER: "1.5e21" } },
      },
    }
    expect(scanSchemas.epoch.safeParse(bad).success).toBe(false)
    const page = scanFixture("epochs", new URLSearchParams()).body as {
      data: Item[]
    }
    const badPage = {
      ...page,
      data: page.data.map((item) => ({
        ...item,
        vote_weight: { POOLS_VOTER: "12abc" },
      })),
    }
    expect(scanSchemas.epochPage.safeParse(badPage).success).toBe(false)
  })
})

describe("an epoch's top gauges for a source with no total", () => {
  type Doc = {
    data: { epoch: { vote_weight: Record<string, string> } } | null
  }

  it("show no share instead of 0.0%", async () => {
    state.edits.set(`epochs/${epochStart(47)}`, (body: Doc) =>
      body.data === null
        ? body
        : {
            ...body,
            data: {
              ...body.data,
              epoch: {
                ...body.data.epoch,
                vote_weight: Object.fromEntries(
                  Object.entries(body.data.epoch.vote_weight).filter(
                    ([source]) => source !== "POOLS_VOTER",
                  ),
                ),
              },
            },
          },
    )
    try {
      const page = await epochPage({ epoch: 47 })
      if (page.doc.status !== "ok" || page.doc.data === null) {
        throw new Error("no epoch")
      }
      const pools = page.doc.data.sources.find(
        (table) => table.source === "POOLS_VOTER",
      )
      expect(pools?.total).toBeNull()
      expect(pools?.rows.length).toBeGreaterThan(0)
      for (const row of pools?.rows ?? []) expect(row.share).toBeNull()
      const boost = page.doc.data.sources.find(
        (table) => table.source === "BOOST_VOTER",
      )
      expect(boost?.rows[0]?.share).toMatch(/%$/)
    } finally {
      state.edits.clear()
    }
  })
})

describe("an epoch's incentive tokens", () => {
  const tokens = {
    btc: "0x7b7c000000000000000000000000000000000000",
    mezo: demoTokens.mezo.address.toLowerCase(),
    musd: demoTokens.musd.address.toLowerCase(),
    musdc: demoTokens.musdc.address.toLowerCase(),
    unknown: `0x${"ab".repeat(20)}`,
  }
  type Doc = { data: { epoch: { incentives: Record<string, string> } } | null }

  it("list the largest first, and say how many more there are", async () => {
    // Insertion order is not the order shown.
    const incentives = {
      [tokens.unknown]: "7",
      [tokens.musdc]: "25000000", // 25 mUSDC
      [tokens.btc]: "100000000000000000", // 0.1 BTC
      [tokens.musd]: "10000000000000000000", // 10 MUSD
      [tokens.mezo]: "5000000000000000000000", // 5,000 MEZO
    }
    state.edits.set(`epochs/${epochStart(47)}`, (body: Doc) =>
      body.data === null
        ? body
        : {
            ...body,
            data: {
              ...body.data,
              epoch: { ...body.data.epoch, incentives },
            },
          },
    )
    try {
      const page = await epochPage({ epoch: 47 })
      if (page.doc.status !== "ok" || page.doc.data === null) {
        throw new Error("no epoch")
      }
      const { figure, stats } = page.doc.data.incentives
      // In USD at the epoch's prices; the unknown token has none.
      expect(figure).toMatch(/^\$[\d,]+ \+ unpriced$/)
      expect(
        stats.filter((stat) => stat.label === "Incentives").map((s) => s.value),
      ).toEqual([
        expect.stringMatching(/^5,000\.00 MEZO$/),
        expect.stringMatching(/MUSDC, \+3 more$/i),
      ])
    } finally {
      state.edits.clear()
    }
  })
})

describe("locks by unlock date", () => {
  it("say that locks past their unlock date come first", async () => {
    const page = await locksPage({
      escrow: "vebtc",
      order: "unlock",
      range: "30d",
      cursor: null,
    })
    if (page.list.status !== "ok") throw new Error("no locks")
    expect(page.list.data.rows[0]).toMatchObject({ id: "77", state: "expired" })
    expect(page.list.data.expired).toBe(1)
    const byAmount = await locksPage({
      escrow: "vebtc",
      order: "amount",
      range: "30d",
      cursor: null,
    })
    expect(byAmount.list.status === "ok" && byAmount.list.data.expired).toBe(0)
  })
})
