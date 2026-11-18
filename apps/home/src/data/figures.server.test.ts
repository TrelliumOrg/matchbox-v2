import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The edge snapshot: pages never wait upstream, the browser's fresh read
 * does, every read has a deadline, and a failed read keeps what was known.
 * The API binding is a fake whose answers the test releases by hand.
 */

const waits: Promise<unknown>[] = []

type Call = { url: string; signal: AbortSignal | null }

const api = {
  calls: [] as Call[],
  answer: (url: string): Response | Promise<Response> => {
    void url
    return new Promise<Response>(() => {})
  },
}

const env: Record<string, unknown> = {
  HOME_DATA: "api",
  API_ORIGIN: "https://api.example",
  API: {
    fetch(request: Request) {
      api.calls.push({ url: request.url, signal: request.signal })
      return api.answer(request.url)
    },
  },
}

vi.mock("cloudflare:workers", () => ({
  env,
  waitUntil(promise: Promise<unknown>) {
    waits.push(promise)
  },
}))

const {
  borrowEveryMs,
  getHomeFigures,
  namesEveryMs,
  namesRetryMs,
  resetFigures,
  snapshotKey,
  upstreamTimeoutMs,
} = await import("./figures.server")
const { emptyFigures } = await import("./figures")
const {
  borrowTotalsFixtures,
  fixtureNames,
  unnamedProposer,
  validatorsFixture,
} = await import("./fixtures")

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  })
}

const token = (symbol: string) => ({
  address: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
  symbol,
  name: symbol,
  decimals: 18,
})

const meta = {
  network: "mezo",
  source: "live",
  block: 1,
  updatedAt: 1_700_000_000,
}

const summary = {
  data: {
    epoch: { number: 47, start: 1_793_836_800, end: 1_794_441_600 },
    incentives: { usd: "14820.5", previousUsd: null, changeUsd: null },
    stats: {
      vemezoLocked: "1",
      vemezoLockers: 1,
      vebtcLocked: "1404.32",
      vebtcLockedUsd: "148450000",
      vebtcVoteWeight: "1",
      vebtcVotes: 1,
      medianApy: null,
    },
    topGauges: [],
    gaugeCount: 0,
    fundedCount: 0,
    totalVotes: "0",
  },
  meta,
}

function upstream(url: string): Response {
  if (url.includes("/internal/pro/summary")) return json(summary)
  return new Response("down", { status: 503 })
}

beforeEach(() => {
  resetFigures()
  waits.length = 0
  api.calls = []
  api.answer = () => new Promise<Response>(() => {})
  env.HOME_DATA = "api"
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("getHomeFigures", () => {
  it("renders a page at once with no snapshot, every slot not available", async () => {
    // The API never answers; the page must not wait for it.
    const figures = await getHomeFigures({ fresh: false, nowMs: 1_000 })
    expect(figures).toEqual(emptyFigures)
    expect(waits).toHaveLength(1)
    // The refresh it started is still reading in the background.
    await vi.waitFor(() => expect(api.calls).toHaveLength(6))
  })

  it("gives every upstream read its deadline", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout")
    await getHomeFigures({ fresh: false, nowMs: 1_000 })
    await vi.waitFor(() => expect(api.calls).toHaveLength(6))
    expect(timeout).toHaveBeenCalledTimes(6)
    for (const call of timeout.mock.calls)
      expect(call[0]).toBe(upstreamTimeoutMs)
    for (const call of api.calls) expect(call.signal).not.toBeNull()
  })

  it("waits for the fresh read, and fills only the slots that answered", async () => {
    api.answer = upstream
    const figures = await getHomeFigures({ fresh: true, nowMs: 5_000 })
    expect(figures.pro.incentivesUsd).toBe("14820.5")
    expect(figures.scan.vebtcLocked).toBe("1404.32")
    expect(figures.scan.vebtcLockedUsd).toBe("148450000")
    // Gauges, the series, the blocks and the borrow totals answered 503.
    expect(figures.pro.gauges).toBeNull()
    expect(figures.scan.blocks).toBeNull()
    expect(figures.scan.borrowedMusd).toBeNull()
    // Each read has its own time: only the summary was read.
    expect(figures.at).toEqual({
      summary: 5_000,
      gauges: null,
      vebtcSeries: null,
      blocks: null,
      borrow: null,
    })
  })

  it("moves on only the read times of the reads that answered", async () => {
    const hash = `0x${"b".repeat(64)}`
    const blocks = (height: number) => [
      {
        height,
        hash,
        parent_hash: hash,
        timestamp: "2026-11-11T04:00:00Z",
        transactions_count: 2,
        gas_used: "0",
        gas_limit: "0",
        base_fee_per_gas: null,
        burnt_fees: null,
        priority_fee: null,
        transaction_fees: null,
        size: null,
        miner: {
          hash: `0x${"a".repeat(40)}`,
          name: "Harbor Stake",
          is_contract: null,
          is_verified: null,
          implementations: null,
        },
        is_pending_update: null,
      },
    ]
    api.answer = (url) =>
      url.includes("/main-page/blocks") ? json(blocks(100)) : upstream(url)
    await getHomeFigures({ fresh: true, nowMs: 5_000 })
    // Twenty minutes on, only the blocks answer: the summary's figures
    // are kept, and so is their time, so the page can call them stale.
    api.answer = (url) =>
      url.includes("/main-page/blocks")
        ? json(blocks(200))
        : new Response("down", { status: 503 })
    const later = await getHomeFigures({ fresh: true, nowMs: 1_205_000 })
    expect(later.scan.blocks?.[0]?.number).toBe(200)
    expect(later.pro.incentivesUsd).toBe("14820.5")
    expect(later.at.blocks).toBe(1_205_000)
    expect(later.at.summary).toBe(5_000)
  })

  it("serves a young snapshot without reading upstream", async () => {
    api.answer = upstream
    await getHomeFigures({ fresh: true, nowMs: 5_000 })
    const before = api.calls.length
    const page = await getHomeFigures({ fresh: false, nowMs: 10_000 })
    const fresh = await getHomeFigures({ fresh: true, nowMs: 10_000 })
    expect(api.calls.length).toBe(before)
    expect(page.pro.incentivesUsd).toBe("14820.5")
    expect(fresh.pro.incentivesUsd).toBe("14820.5")
  })

  it("serves an old snapshot at once and keeps its values when the refresh fails", async () => {
    api.answer = upstream
    await getHomeFigures({ fresh: true, nowMs: 5_000 })
    api.answer = () => new Response("down", { status: 503 })
    const page = await getHomeFigures({ fresh: false, nowMs: 60_000 })
    expect(page.pro.incentivesUsd).toBe("14820.5")
    await Promise.all(waits)
    const after = await getHomeFigures({ fresh: false, nowMs: 61_000 })
    expect(after.pro.incentivesUsd).toBe("14820.5")
    expect(after.scan.vebtcLocked).toBe("1404.32")
    // Nothing answered, so no read time is moved on.
    expect(after.at.summary).toBe(5_000)
  })

  it("takes the gauges with the most incentives, three of them", async () => {
    const card = (name: string, usd: string) => ({
      gauge: {
        address: `0x${name.length.toString(16).padStart(40, "0")}`,
        voter: "pools",
        kind: "pool",
        name,
        vebtcTokenId: null,
        picture: { type: "pair", tokens: [token("BTC"), token("MUSD")] },
        poolType: "volatile",
        color: null,
        tickSpacing: null,
        coin: null,
      },
      tagline: null,
      isAlive: true,
      apy: null,
      incentives: {
        usd,
        tokens: [{ token: token("MUSD"), amount: "1", usd: "1" }],
      },
      vebtcWeight: null,
      votes: "112.4",
      votesUnit: "veBTC",
      optimalVotes: null,
      boost: null,
      meta: null,
    })
    api.answer = (url) => {
      if (!url.includes("/internal/pro/gauges")) return upstream(url)
      expect(new URL(url).searchParams.get("sort")).toBe("incentives")
      return json({
        data: {
          epoch: summary.data.epoch,
          gauges: [card("BTC/MUSD", "4210"), card("A/B", "2480")],
          totalVotes: "0",
          total: 2,
          kinds: { vebtc: 0, validator: 0, pool: 2, mezo: 0 },
          nextCursor: null,
        },
        meta,
      })
    }
    const figures = await getHomeFigures({ fresh: true, nowMs: 5_000 })
    // The card's schema is the contract's; if this fixture drifts from it
    // the read fails validation and the slot stays empty.
    if (figures.pro.gauges === null) {
      throw new Error(
        "the gauge directory fixture no longer matches its contract",
      )
    }
    expect(figures.pro.gauges.map((gauge) => gauge.name)).toEqual([
      "BTC/MUSD",
      "A/B",
    ])
    expect(figures.pro.gauges[0]?.tokens).toEqual(["MUSD"])
  })

  it("keeps snapshots under this build's key and never reads another build's", async () => {
    const stored = new Map<string, string>()
    vi.stubGlobal("caches", {
      open: async () => ({
        match: async (key: string) => {
          const body = stored.get(key)
          return body === undefined ? undefined : new Response(body)
        },
        put: async (key: string, response: Response) => {
          stored.set(key, await response.text())
        },
      }),
    })
    try {
      expect(snapshotKey).toBe("https://home.internal/figures/v4/test-build")
      // A snapshot an earlier build stored, young enough to be served.
      const earlier = "https://home.internal/figures/v4/earlier-build"
      stored.set(
        earlier,
        JSON.stringify({
          storedAt: 4_000,
          figures: {
            ...emptyFigures,
            pro: { incentivesUsd: "1", gauges: null },
          },
        }),
      )
      api.answer = upstream
      const page = await getHomeFigures({ fresh: false, nowMs: 5_000 })
      expect(page.pro.incentivesUsd).toBeNull()
      await Promise.all(waits)
      expect([...stored.keys()]).toContain(snapshotKey)
      resetFigures()
      // A fresh isolate of this build reads its own snapshot back.
      const again = await getHomeFigures({ fresh: false, nowMs: 6_000 })
      expect(again.pro.incentivesUsd).toBe("14820.5")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  describe("borrow totals", () => {
    const borrowPath = "/internal/scan/borrow/totals"
    const borrowCalls = () =>
      api.calls.filter((call) => call.url.endsWith(borrowPath)).length

    it("reads the route and fills the Borrowed stat in MUSD", async () => {
      api.answer = (url) =>
        url.endsWith(borrowPath)
          ? json(borrowTotalsFixtures.normal(5_000))
          : upstream(url)
      const figures = await getHomeFigures({ fresh: true, nowMs: 5_000 })
      expect(figures.scan.borrowedMusd).toBe("4055533.400000000000000000")
      expect(figures.scan.borrowedEnclaves).toBe("98.6")
      expect(figures.scan.borrowedSeries).toHaveLength(30)
      expect(figures.at.borrow).toBe(5_000)
    })

    it("re-reads no sooner than the route's minute, answered or not", async () => {
      api.answer = (url) =>
        url.endsWith(borrowPath)
          ? json(borrowTotalsFixtures.normal(5_000))
          : upstream(url)
      await getHomeFigures({ fresh: true, nowMs: 5_000 })
      expect(borrowCalls()).toBe(1)
      // The snapshot is old enough to refresh every 15 s; the borrow
      // totals are read again only once a minute has passed.
      await getHomeFigures({ fresh: true, nowMs: 25_000 })
      const kept = await getHomeFigures({ fresh: true, nowMs: 45_000 })
      expect(borrowCalls()).toBe(1)
      expect(kept.scan.borrowedMusd).toBe("4055533.400000000000000000")
      expect(kept.at.borrow).toBe(5_000)
      api.answer = () => new Response("down", { status: 503 })
      await getHomeFigures({ fresh: true, nowMs: 5_000 + borrowEveryMs })
      expect(borrowCalls()).toBe(2)
      // That read failed: the next waits a minute from it, not from the
      // last good one.
      await getHomeFigures({
        fresh: true,
        nowMs: 5_000 + borrowEveryMs + 20_000,
      })
      expect(borrowCalls()).toBe(2)
      await getHomeFigures({ fresh: true, nowMs: 5_000 + 2 * borrowEveryMs })
      expect(borrowCalls()).toBe(3)
    })

    it("keeps the last figures and their time when a venue is missing", async () => {
      api.answer = (url) =>
        url.endsWith(borrowPath)
          ? json(borrowTotalsFixtures.normal(5_000))
          : upstream(url)
      await getHomeFigures({ fresh: true, nowMs: 5_000 })
      api.answer = (url) =>
        url.endsWith(borrowPath)
          ? json(borrowTotalsFixtures.missingVenue(70_000))
          : upstream(url)
      const later = await getHomeFigures({ fresh: true, nowMs: 70_000 })
      expect(borrowCalls()).toBe(2)
      expect(later.scan.borrowedMusd).toBe("4055533.400000000000000000")
      expect(later.at.borrow).toBe(5_000)
    })

    it("says nothing with no total and nothing known before", async () => {
      api.answer = (url) =>
        url.endsWith(borrowPath)
          ? json(borrowTotalsFixtures.missingVenue(5_000))
          : upstream(url)
      const figures = await getHomeFigures({ fresh: true, nowMs: 5_000 })
      expect(figures.scan.borrowedMusd).toBeNull()
      expect(figures.scan.borrowedEnclaves).toBeNull()
      expect(figures.scan.borrowedSeries).toBeNull()
      expect(figures.at.borrow).toBeNull()
    })
  })

  describe("validator names", () => {
    const namesPath = "/internal/scan/validators"
    const namesCalls = () =>
      api.calls.filter((call) => call.url.endsWith(namesPath)).length
    const harbor = "0x41b1a7f633eb9dac1fc19adae41aa7562c620971"
    const hash = `0x${"b".repeat(64)}`

    /** Blockscout's newest blocks, proposed by `miners` in turn; no names. */
    const blocksAnswer = (height: number, miners: readonly string[]) =>
      miners.map((miner, index) => ({
        height: height - index,
        hash,
        parent_hash: hash,
        timestamp: "2026-11-11T04:00:00Z",
        transactions_count: 2,
        gas_used: "0",
        gas_limit: "0",
        base_fee_per_gas: null,
        burnt_fees: null,
        priority_fee: null,
        transaction_fees: null,
        size: null,
        // Mixed case, as Blockscout writes it.
        miner: {
          hash: miner.replace(
            /^0x(.)/,
            (_, first: string) => `0x${first.toUpperCase()}`,
          ),
          name: null,
          is_contract: null,
          is_verified: null,
          implementations: null,
        },
        is_pending_update: null,
      }))

    type Answers = { blocks: number | null; names: boolean }

    /** Answers the blocks at a height (null: down) and the names (or down). */
    const answering =
      (
        answers: Answers,
        miners: readonly string[] = [harbor, unnamedProposer],
      ) =>
      (url: string): Response => {
        if (url.includes("/main-page/blocks")) {
          return answers.blocks === null
            ? new Response("down", { status: 503 })
            : json(blocksAnswer(answers.blocks, miners))
        }
        if (url.endsWith(namesPath)) {
          return answers.names
            ? json(validatorsFixture)
            : new Response("down", { status: 503 })
        }
        return upstream(url)
      }

    const proposers = (figures: { scan: { blocks: unknown } }) =>
      (figures.scan.blocks as { proposer: string }[] | null)?.map(
        (block) => block.proposer,
      )

    it("names each block's proposer as Matchscan does, and shortens one with no name", async () => {
      api.answer = answering({ blocks: 100, names: true })
      const figures = await getHomeFigures({ fresh: true, nowMs: 5_000 })
      // Harbor Stake has a directory name and a label: the name wins.
      expect(proposers(figures)).toEqual(["Harbor Stake", "0xD056…0247"])
      expect(figures.scan.blocks?.[0]?.address).toBe(harbor)
      // The names stay at the edge: the browser gets named blocks only.
      expect(Object.keys(figures).sort()).toEqual(["at", "pro", "scan"])
      expect(JSON.stringify(figures)).not.toContain("Copperline")
    })

    it("keeps the last names when their read fails and the blocks answer", async () => {
      api.answer = answering({ blocks: 100, names: true })
      await getHomeFigures({ fresh: true, nowMs: 5_000 })
      expect(namesCalls()).toBe(1)
      api.answer = answering({ blocks: 200, names: false }, [harbor])
      const later = await getHomeFigures({
        fresh: true,
        nowMs: 5_000 + namesEveryMs,
      })
      expect(namesCalls()).toBe(2)
      expect(later.scan.blocks?.[0]?.number).toBe(200)
      expect(proposers(later)).toEqual(["Harbor Stake"])
      expect(later.at.blocks).toBe(5_000 + namesEveryMs)
    })

    it("keeps a name a later answer lacks", async () => {
      api.answer = answering({ blocks: 100, names: true }, [harbor])
      await getHomeFigures({ fresh: true, nowMs: 5_000 })
      // The API could not read the directory: no names, no labels.
      api.answer = (url) =>
        url.endsWith(namesPath)
          ? json({
              ...validatorsFixture,
              data: {
                ...validatorsFixture.data,
                validators: validatorsFixture.data.validators.map((row) => ({
                  ...row,
                  name: null,
                  label: null,
                })),
              },
            })
          : answering({ blocks: 200, names: true }, [harbor])(url)
      const later = await getHomeFigures({
        fresh: true,
        nowMs: 5_000 + namesEveryMs,
      })
      expect(namesCalls()).toBe(2)
      expect(proposers(later)).toEqual(["Harbor Stake"])
    })

    it("swaps a name in on a block already shown when the names answer later", async () => {
      api.answer = answering({ blocks: 100, names: false })
      const first = await getHomeFigures({ fresh: true, nowMs: 5_000 })
      // No names yet: the short address, never blank, never "Unknown".
      expect(proposers(first)).toEqual(["0x41b1…0971", "0xD056…0247"])
      // A minute on the names answer and the blocks do not: the kept
      // blocks take their names, and keep their own read time.
      api.answer = answering({ blocks: null, names: true })
      const later = await getHomeFigures({
        fresh: true,
        nowMs: 5_000 + namesRetryMs,
      })
      expect(proposers(later)).toEqual(["Harbor Stake", "0xD056…0247"])
      expect(later.at.blocks).toBe(5_000)
    })

    it("re-reads the names every five minutes, not with each block", async () => {
      api.answer = answering({ blocks: 100, names: true }, [harbor])
      for (let at = 5_000; at < 5_000 + namesEveryMs; at += 15_000) {
        api.answer = answering({ blocks: 100 + at / 1000, names: true }, [
          harbor,
        ])
        await getHomeFigures({ fresh: true, nowMs: at })
      }
      // Twenty refreshes, twenty blocks reads, one names read.
      expect(namesCalls()).toBe(1)
      await getHomeFigures({ fresh: true, nowMs: 5_000 + namesEveryMs })
      expect(namesCalls()).toBe(2)
    })

    it("re-reads sooner for a proposer with no name, at most once a minute", async () => {
      api.answer = answering({ blocks: 100, names: true })
      await getHomeFigures({ fresh: true, nowMs: 5_000 })
      expect(namesCalls()).toBe(1)
      // The unnamed proposer stays on screen and in no answer's names.
      for (const at of [20_000, 35_000, 50_000]) {
        await getHomeFigures({ fresh: true, nowMs: at })
      }
      expect(namesCalls()).toBe(1)
      await getHomeFigures({ fresh: true, nowMs: 5_000 + namesRetryMs })
      expect(namesCalls()).toBe(2)
      await getHomeFigures({ fresh: true, nowMs: 80_000 })
      expect(namesCalls()).toBe(2)
      // A failed read counts too: the next waits a minute from it.
      api.answer = answering({ blocks: 100, names: false })
      await getHomeFigures({ fresh: true, nowMs: 5_000 + 2 * namesRetryMs })
      expect(namesCalls()).toBe(3)
      await getHomeFigures({ fresh: true, nowMs: 140_000 })
      expect(namesCalls()).toBe(3)
    })
  })

  it("names the fixture proposers in fixtures mode", async () => {
    env.HOME_DATA = "fixtures"
    const figures = await getHomeFigures({
      fresh: false,
      nowMs: Date.UTC(2026, 10, 11, 5),
    })
    const shown = figures.scan.blocks?.map((block) => block.proposer) ?? []
    expect(shown).toHaveLength(3)
    // Every proposer is named but the one no row names.
    for (const block of figures.scan.blocks ?? []) {
      expect(block.proposer).toBe(
        block.address === unnamedProposer
          ? "0xd056…0247"
          : fixtureNames[block.address],
      )
    }
  })

  it("paints the fixtures on the first request in fixtures mode", async () => {
    env.HOME_DATA = "fixtures"
    const figures = await getHomeFigures({
      fresh: false,
      nowMs: Date.UTC(2026, 10, 11, 5),
    })
    expect(figures.pro.incentivesUsd).toBe("14820")
    expect(api.calls).toHaveLength(0)
  })
})
