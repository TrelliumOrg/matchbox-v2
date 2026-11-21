import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The transaction page as shown: pools by pair and pool type, as the pool
 * and gauge pages name them, never by the labels' contract name.
 */

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
}))

vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: () => {},
}))
vi.mock("@matchbox/logger", () => ({
  createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {} }),
}))

const { transactionPage } = await import("../data/entities.server")
const { fixtureIds } = await import("../data/blockscout/fixtures")
const { presentTx } = await import("./tx-present.server")

/** The BTC/MUSD basic pool, labelled by its contract name as on mainnet. */
const btcMusd = "0x52e604c44417233b6ccedddc0d640a405caacefb"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("a swap's pool", () => {
  it("is named by pair and pool type in the title and the actions", async () => {
    const page = presentTx(
      await transactionPage({ hash: fixtureIds.transaction }),
    )
    expect(page.headline?.text).toBe("Swapped 5.00 mUSDC in mUSDC/MUSD Stable")
    expect(page.headline?.parts.at(-1)).toMatchObject({
      kind: "address",
      name: "mUSDC/MUSD Stable",
    })
    expect(page.activity.status).toBe("ok")
    if (page.activity.status !== "ok") return
    expect(page.activity.data[0]?.text).toBe(
      "Swapped 5.00 mUSDC in mUSDC/MUSD Stable",
    )
  })

  it("never reads as the indexer's contract name", async () => {
    const real = await transactionPage({ hash: fixtureIds.transaction })
    const parts = [
      { kind: "text" as const, text: "Swapped tokens in " },
      { kind: "address" as const, address: btcMusd, name: "Pool Musd Btc" },
    ]
    const page = presentTx({
      ...real,
      headline: {
        parts,
        text: "Swapped tokens in Pool Musd Btc",
        decoded: true,
      },
      logs: {
        status: "ok",
        data: [
          {
            index: 0,
            address: {
              address: btcMusd,
              name: null,
              contract: true,
              label: { name: "Pool Musd Btc", kind: "pool", tags: [] },
            },
            decoded: null,
            topics: [],
            data: "0x",
          },
        ],
      },
    })
    expect(page.headline?.text).toBe("Swapped tokens in BTC/MUSD Volatile")
    expect(page.logs.status === "ok" && page.logs.data[0]?.address).toEqual({
      address: btcMusd,
      name: null,
      contract: true,
      label: { name: "BTC/MUSD Volatile", kind: "pool", tags: [] },
    })
  })
})

describe("a token's own logs", () => {
  it("read their amounts in the token, the raw value beside", async () => {
    const page = presentTx(
      await transactionPage({ hash: fixtureIds.transaction }),
    )
    expect(page.logs.status).toBe("ok")
    if (page.logs.status !== "ok") return
    const values = page.logs.data.map(
      (log) =>
        log.decoded?.params.find((param) => param.name === "value")?.value,
    )
    expect(values).toEqual([
      "5.00 mUSDC (5000000)",
      "5.04 MUSD (5042176961077758777)",
    ])
  })

  it("leave an unknown token's amounts as they are", async () => {
    const real = await transactionPage({ hash: fixtureIds.transaction })
    if (real.logs.status !== "ok") throw new Error("expected logs")
    const unknown = {
      ...real,
      logs: {
        ...real.logs,
        data: real.logs.data.map((log) => ({
          ...log,
          address: { ...log.address, address: `0x${"77".repeat(20)}` },
        })),
      },
    }
    const page = presentTx(unknown)
    if (page.logs.status !== "ok") throw new Error("expected logs")
    expect(page.logs.data[1]?.decoded?.params[2]?.value).toBe(
      "5042176961077758777",
    )
  })
})
