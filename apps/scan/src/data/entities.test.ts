import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The entity documents over the fixtures: one composed read each, labels
 * on every address, the plain-words headline, per-part degradation (and a
 * degraded page is never stored), and the fallback to the proxy while the
 * API answers 503.
 */

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
  request: new Map<string, string>(),
  response: new Map<string, string>(),
}))

vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => state.request.get(name),
  setResponseHeader: (name: string, value: string) => {
    state.response.set(name, value)
  },
}))
vi.mock("@matchbox/logger", () => ({
  createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {} }),
}))

const { addressDocument, blockPage, transactionPage } = await import(
  "./entities.server"
)
const { fixtureIds } = await import("./blockscout/fixtures")
const {
  degradedAddress,
  indexedAfterMs,
  liveHashes,
  loanTransactions,
  minedAfterMs,
} = await import("./scan/fixtures/entities")
const { otherVoter, wallet } = await import("./scan/fixtures/world")
const { scanFixture } = await import("./scan/fixtures")

beforeEach(() => {
  state.request.clear()
  state.response.clear()
})

describe("a loan transaction", () => {
  it("titles a trove borrowing in words and says what changed", async () => {
    const page = await transactionPage({ hash: loanTransactions.trove })
    expect(page.headline?.decoded).toBe(false)
    expect(page.loan?.status).toBe("ok")
    if (page.loan?.status !== "ok") return
    expect(page.loan.data).toMatchObject({
      kind: "trove",
      title: "Borrowed 4,000.00 MUSD",
      venue: "MUSD loan",
      account: wallet,
    })
    expect(page.loan.data.changes[0]).toMatchObject({
      label: "Debt",
      value: "10,012.50 MUSD",
    })
    // The live trove fills the card.
    expect(page.loan.data.position.status).toBe("Active")
    expect(page.loan.data.position.rows.length).toBeGreaterThan(0)
    // The position moves on: never kept as a final page.
    expect(state.response.get("x-scan-cache")).toBe("fresh")
  })

  it("reads an Enclave opening from its position's events and locks", async () => {
    const page = await transactionPage({ hash: loanTransactions.enclave })
    if (page.loan?.status !== "ok") throw new Error("no loan")
    expect(page.loan.data).toMatchObject({
      kind: "enclave",
      title: "Opened 25,000.00 MUSD",
      against: "veBTC #604",
      notYet: ["Collateral ratio", "Price at the minimum"],
    })
  })

  it("has no loan where the logs name none", async () => {
    const page = await transactionPage({ hash: fixtureIds.transaction })
    expect(page.loan).toBeNull()
  })
})

describe("transaction document", () => {
  it("titles the page in plain words and labels its addresses", async () => {
    const page = await transactionPage({ hash: fixtureIds.transaction })
    expect(page.headline).toMatchObject({
      decoded: true,
      text: "Swapped 5.00 mUSDC in mUSDC/MUSD",
    })
    expect(page.tx.status).toBe("ok")
    if (page.tx.status !== "ok") return
    expect(page.tx.data.to?.label?.name).toBe("Universal Router")
    expect(page.final).toBe(true)
    expect(state.response.get("x-scan-cache")).toBe("final")
    expect(state.response.has("x-scan-degraded")).toBe(false)
  })

  it("is the page's 404 when the chain has no such transaction", async () => {
    const page = await transactionPage({ hash: `0x${"1".repeat(64)}` })
    expect(page.tx.status).toBe("missing")
  })

  it("draws a transaction the explorer lacks from the chain, decoded", async () => {
    const hash = `${liveHashes.mined}${"1".repeat(60)}`
    const page = await transactionPage({ hash })
    expect(page.live).toBe("mined")
    expect(page.tx.status).toBe("ok")
    if (page.tx.status !== "ok") return
    expect(page.tx.data).toMatchObject({
      status: "success",
      block: 13_334_700,
      method: "vote",
      pending: false,
    })
    // Our sentence, from the receipt, before the copy has the rows.
    expect(page.headline?.decoded).toBe(true)
    expect(page.headline?.text).toMatch(/^Voted /)
    expect(page.activity.status).toBe("ok")
    expect(page.logs).toMatchObject({ status: "ok" })
    // Moves every block: never kept long.
    expect(state.response.get("x-scan-cache")).toBe("list")
  })

  it("draws a pending transaction, then the indexed page", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const hash = `${liveHashes.pending}${"2".repeat(60)}`
      const pending = await transactionPage({ hash })
      expect(pending.live).toBe("pending")
      if (pending.tx.status !== "ok") throw new Error("not drawn")
      expect(pending.tx.data).toMatchObject({
        status: "pending",
        block: null,
        // Its fee cap is not a price paid.
        gasPrice: null,
      })
      vi.advanceTimersByTime(minedAfterMs)
      const mined = await transactionPage({ hash })
      expect(mined.live).toBe("mined")
      if (mined.tx.status !== "ok") throw new Error("not drawn")
      expect(mined.tx.data.gasPrice).not.toBeNull()
      vi.advanceTimersByTime(indexedAfterMs)
      const indexed = await transactionPage({ hash })
      expect(indexed.live).toBeNull()
      expect(indexed.final).toBe(true)
      expect(indexed.headline?.text).toMatch(/^Voted /)
    } finally {
      vi.useRealTimers()
    }
  })

  it("is the page's 404 while the chain has never seen the hash", async () => {
    const page = await transactionPage({ hash: `0x${"3".repeat(64)}` })
    expect(page.tx.status).toBe("missing")
  })

  it("reads the proxy while the API answers 503", async () => {
    state.request.set("x-scan-fixture", "disabled")
    const page = await transactionPage({ hash: fixtureIds.transaction })
    expect(page.tx.status).toBe("ok")
    expect(page.activity).toEqual({ status: "disabled" })
    // The decoded method stands in for our sentence.
    expect(page.headline).toMatchObject({
      decoded: false,
      text: "Called execute",
    })
    expect(state.response.get("x-scan-degraded")).toBe("1")
  })
})

describe("block document", () => {
  it("names the proposer from our labels", async () => {
    const page = await blockPage({ id: String(fixtureIds.block), cursor: {} })
    expect(page.block.status).toBe("ok")
    if (page.block.status !== "ok") return
    expect(page.block.data.miner?.label?.name).toBe("Kiln Labs")
    expect(page.final).toBe(true)
  })
})

describe("address document", () => {
  it("carries locks, loans and activity in one read", async () => {
    const doc = await addressDocument({ address: wallet })
    expect(doc.summary.status).toBe("ok")
    // #6179 is the chain's, not in the store yet (fixtures/world).
    expect(
      doc.locks.status === "ok" && doc.locks.data.items.map((lock) => lock.id),
    ).toEqual(["604", "6179", "2207"])
    expect(
      doc.borrow.status === "ok" && doc.borrow.data.trove?.collateralRatio,
    ).toBe("200.2%")
    // The document labels what its parts name, so activity names the pool.
    expect(
      doc.activity.status === "ok" && doc.activity.data.items[0]?.text,
    ).toBe("Swapped 5.00 mUSDC in mUSDC/MUSD")
    expect(state.response.has("x-scan-degraded")).toBe(false)
  })

  it("names and sizes a Morpho loan in a discovered market from the market list", async () => {
    const doc = await addressDocument({ address: wallet })
    if (doc.borrow.status !== "ok") throw new Error("borrow")
    const discovered = doc.borrow.data.morpho.find(
      (position) =>
        position.marketId ===
        "0x4bff245ddc101cd43e365aa1faff97351ab36a225e43d9a76aab82ff763030b8",
    )
    expect(discovered).toMatchObject({
      market: "BTC / MUSD (0x4bff…30b8)",
      collateral: "0.0500 BTC",
      debt: "1,000.00 MUSD",
    })
    expect(state.response.has("x-scan-degraded")).toBe(false)
  })

  it("says whether its loans' live snapshot is delayed", async () => {
    expect((await addressDocument({ address: wallet })).borrowDelayed).toBe(
      false,
    )
    state.request.set("x-scan-fixture", "delayed")
    const delayed = await addressDocument({ address: wallet })
    expect(delayed.borrowDelayed).toBe(true)
    // The positions themselves are as before.
    expect(
      delayed.borrow.status === "ok" &&
        delayed.borrow.data.trove?.collateralRatio,
    ).toBe("200.2%")
    // No borrow part, so no snapshot: the page asks /status instead.
    const degraded = await addressDocument({ address: degradedAddress })
    expect(degraded.borrowDelayed).toBeNull()
  })

  it("lists no closed Enclave position as a loan", async () => {
    // otherVoter's only Enclave position was opened and then closed.
    const doc = await addressDocument({ address: otherVoter })
    expect(doc.borrow.status === "ok" && doc.borrow.data.enclave).toEqual([])
    const open = await addressDocument({ address: wallet })
    expect(open.borrow.status === "ok" && open.borrow.data.enclave.length).toBe(
      1,
    )
  })

  it("degrades each unavailable part and is never stored", async () => {
    const doc = await addressDocument({ address: degradedAddress })
    expect(doc.summary).toEqual({ status: "rate-limited" })
    expect(doc.locks).toEqual({ status: "unavailable" })
    expect(doc.borrow).toEqual({ status: "unavailable" })
    expect(doc.activity).toEqual({ status: "rate-limited" })
    expect(state.response.get("x-scan-degraded")).toBe("1")
  })

  describe("over the API", () => {
    /** The API binding answering with the fixtures, `edit` applied to the address document. */
    function api(edit: (body: unknown, call: number) => unknown): string[] {
      const seen: string[] = []
      state.env.SCAN_DATA = "api"
      state.env.API = {
        fetch: async (request: Request) => {
          const url = new URL(request.url)
          const path = url.pathname.replace("/internal/scan/", "")
          seen.push(path)
          const answer = scanFixture(path, url.searchParams)
          const calls = seen.filter((each) => each === path).length
          const body = path.startsWith("entities/address/")
            ? edit(answer.body, calls)
            : answer.body
          return Response.json(body, { status: answer.status })
        },
      }
      return seen
    }
    /** The document with its summary part failed in passing. */
    function withoutSummary(body: unknown): unknown {
      const { data } = body as { data: Record<string, unknown> }
      return {
        data: {
          ...data,
          summary: { status: "unavailable", reason: "upstream" },
        },
      }
    }

    afterEach(() => {
      state.env.SCAN_DATA = "fixtures"
      delete state.env.API
    })

    it("reads a document again once when a part failed in passing", async () => {
      const seen = api((body, call) =>
        call === 1 ? withoutSummary(body) : body,
      )
      const doc = await addressDocument({ address: wallet })
      expect(doc.summary.status).toBe("ok")
      expect(
        seen.filter((path) => path.startsWith("entities/address/")),
      ).toHaveLength(2)
      expect(state.response.has("x-scan-degraded")).toBe(false)
    })

    it("keeps the first document when the part is still missing", async () => {
      const seen = api((body) => withoutSummary(body))
      const doc = await addressDocument({ address: wallet })
      expect(doc.summary).toEqual({ status: "unavailable" })
      expect(doc.locks.status).toBe("ok")
      expect(
        seen.filter((path) => path.startsWith("entities/address/")),
      ).toHaveLength(2)
      expect(state.response.get("x-scan-degraded")).toBe("1")
    })
  })

  it("keeps Blockscout's parts while the API answers 503", async () => {
    state.request.set("x-scan-fixture", "disabled")
    const doc = await addressDocument({ address: fixtureIds.address })
    expect(doc.summary.status).toBe("ok")
    expect(doc.locks).toEqual({ status: "disabled" })
    expect(doc.borrow).toEqual({ status: "disabled" })
  })
})
