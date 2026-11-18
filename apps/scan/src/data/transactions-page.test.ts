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

const { transactionsPage, txWords } = await import("./transactions.server")
const { transactionsPageSchema } = await import(
  "@matchbox/contracts/blockscout"
)
const { MUSD_CONTRACTS } = await import("@matchbox/chain")
const { tokenLookup } = await import("./scan/tokens")
const { swapActivity } = await import("./scan/fixtures/world")
const recorded = await import("./blockscout/fixtures/transactions.json")
const { fixtureNow } = await import("./scan/fixtures/shared")

vi.useFakeTimers({ toFake: ["Date"] })
vi.setSystemTime(fixtureNow * 1000)

/**
 * Transactions in plain words: activity rows first, then MUSD's loan
 * calls, decoded methods and "Contract call" for a bare selector; the
 * category tabs from their activity actions, paged without repeats.
 */

type Summary = ReturnType<typeof transactionsPageSchema.parse>["items"][number]

const first = transactionsPageSchema.parse(recorded.default).items[0]
if (first === undefined) throw new Error("no recorded transaction")
const template: Summary = first
const context = { tokens: tokenLookup(), labels: {} }

function tx(fields: Partial<Summary>): Summary {
  return { ...template, ...fields }
}

describe("transaction words", () => {
  it("says a bare selector is a contract call", () => {
    const words = txWords(tx({ method: "0x6a761202" }), [], context)
    expect(words.text).toBe("Contract call")
    expect(words.amount).toBeNull()
  })

  it("names a decoded method", () => {
    expect(txWords(tx({ method: "execute" }), [], context).text).toBe(
      "Called execute",
    )
  })

  it("words MUSD's loan calls, with the BTC sent", () => {
    const words = txWords(
      tx({
        method: "addColl",
        value: "500000000000000000",
        to: {
          ...(template.to ?? template.from),
          hash: MUSD_CONTRACTS.mainnet.borrowerOperations,
        },
      }),
      [],
      context,
    )
    expect(words.text).toBe("Added collateral")
    expect(words.icon).toBe("LOAN")
    expect(words.amount).toBe("0.5000 BTC")
  })

  it("prefers the transaction's activity, with its amount and token", () => {
    const words = txWords(
      tx({ hash: swapActivity.tx_hash }),
      [swapActivity],
      context,
    )
    expect(words.icon).toBe("SWAP")
    expect(words.text).toMatch(/^Swapped 5\.00 mUSDC/)
    expect(words.amount).toBe("5.00 mUSDC")
  })
})

describe("transactions page", () => {
  it("lists All in words with the proxy's cursor", async () => {
    state.scenario = undefined
    const page = await transactionsPage({ tab: "all", cursor: {} })
    expect(page.tab).toBe("all")
    if (page.tab !== "all" || page.list.status !== "ok") {
      throw new Error("all did not read")
    }
    expect(page.list.data.items.length).toBeGreaterThan(0)
    expect(page.list.data.items.every((row) => row.text !== "")).toBe(true)
  })

  it("lists a tab's actions, newest first, every row once", async () => {
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 10; guard++) {
      const page = await transactionsPage({
        tab: "votes",
        cursor: cursor === null ? {} : { cursor },
      })
      if (page.tab === "all" || page.list.status !== "ok") {
        throw new Error("votes did not read")
      }
      seen.push(...page.list.data.rows.map((row) => row.id))
      expect(
        page.list.data.rows.every((row) => row.action.startsWith("BOOST_")),
      ).toBe(true)
      cursor = page.list.data.next
      if (cursor === null) break
    }
    expect(seen.length).toBeGreaterThan(0)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it("starts over from a cursor it cannot read", async () => {
    const page = await transactionsPage({
      tab: "claims",
      cursor: { cursor: "bm90LWEtY3Vyc29y" },
    })
    if (page.tab === "all" || page.list.status !== "ok") {
      throw new Error("claims did not read")
    }
    expect(
      page.list.data.rows.every((row) => row.action.endsWith("_CLAIMED")),
    ).toBe(true)
  })

  it("degrades a tab when the read routes are disabled", async () => {
    state.scenario = "disabled"
    const page = await transactionsPage({ tab: "swaps", cursor: {} })
    expect(page.list.status).toBe("disabled")
    state.scenario = undefined
  })
})
