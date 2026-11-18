import {
  demoChainHead,
  demoGaugeCards,
  demoGaugeDirectory,
  demoMeta,
  demoPrices,
  demoWallet,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { apiBlockscout } from "./blockscout"
import {
  type ApiFetcher,
  createApiReadModels,
  ReadModelError,
} from "./readModels"

function fakeApi(
  routes: Record<string, () => Response>,
  seen: string[] = [],
): ApiFetcher {
  return {
    async fetch(request) {
      const url = new URL(request.url)
      const path = `${url.pathname}${url.search}`
      seen.push(path)
      const route = routes[path]
      return route ? route() : new Response("{}", { status: 404 })
    },
  }
}

function json(body: unknown, status = 200): () => Response {
  return () => Response.json(body, { status })
}

describe("API read models over the service binding", () => {
  it("validates documents and follows directory pages", async () => {
    const [first, second] = [
      demoGaugeDirectory.gauges.slice(0, 3),
      demoGaugeDirectory.gauges.slice(3),
    ]
    const seen: string[] = []
    const api = createApiReadModels(
      fakeApi(
        {
          "/internal/pro/gauges?voter=boost&limit=100": json({
            data: { ...demoGaugeDirectory, gauges: first, nextCursor: "3" },
            meta: demoMeta,
          }),
          "/internal/pro/gauges?voter=boost&limit=100&cursor=3": json({
            data: { ...demoGaugeDirectory, gauges: second, nextCursor: null },
            meta: demoMeta,
          }),
          "/internal/pro/prices": json({ data: demoPrices }),
          "/internal/pro/head": json({ data: demoChainHead }),
        },
        seen,
      ),
    )
    const gauges = await api.gauges("boost")
    expect(gauges.data.gauges).toHaveLength(demoGaugeDirectory.gauges.length)
    expect(gauges.meta.block).toBe(demoMeta.block)
    expect(await api.prices()).toEqual(demoPrices)
    expect(await api.head()).toEqual(demoChainHead)
    expect(seen).toContain(
      "/internal/pro/gauges?voter=boost&limit=100&cursor=3",
    )
  })

  it("answers null for a 404 and lower-cases addresses", async () => {
    const seen: string[] = []
    const api = createApiReadModels(fakeApi({}, seen))
    const upper = `0x${demoWallet.slice(2).toUpperCase()}`
    expect(await api.walletOverview(upper)).toBeNull()
    expect(await api.gaugeProfile(demoGaugeCards.kilnLabs.gauge.address)).toBe(
      null,
    )
    expect(seen[0]).toBe(`/internal/pro/wallets/${demoWallet}/overview`)
  })

  it("throws on failures and on documents that miss their schema", async () => {
    const failing = createApiReadModels(
      fakeApi({ "/internal/pro/prices": json({ error: "x" }, 503) }),
    )
    await expect(failing.prices()).rejects.toBeInstanceOf(ReadModelError)
    const malformed = createApiReadModels(
      fakeApi({ "/internal/pro/prices": json({ data: { btc: 1 } }) }),
    )
    await expect(malformed.prices()).rejects.toThrow(/schema/)
  })
})

describe("Blockscout through the API", () => {
  const schema = z.object({ hash: z.string() })

  it("is unavailable without a binding, on a 404 and on a failure", async () => {
    expect(await apiBlockscout(null)("api/v2/blocks/1", schema)).toEqual({
      status: "unavailable",
    })
    expect(await apiBlockscout(fakeApi({}))("api/v2/blocks/1", schema)).toEqual(
      { status: "unavailable" },
    )
    const throwing: ApiFetcher = {
      fetch: async () => {
        throw new Error("down")
      },
    }
    expect(await apiBlockscout(throwing)("api/v2/blocks/1", schema)).toEqual({
      status: "unavailable",
    })
  })

  it("sends the visitor's end-user key, so each visitor has a bucket", async () => {
    const seen: Request[] = []
    const api: ApiFetcher = {
      fetch: async (request) => {
        seen.push(request)
        return json({ hash: "0xabc" })()
      },
    }
    const key = "aGFzaGVkLWlwLXByZWZpeC0wMDE"
    await apiBlockscout(api, key)("api/v2/transactions/0xabc", schema)
    await apiBlockscout(api)("api/v2/transactions/0xabc", schema)
    expect(
      seen.map((request) => request.headers.get("x-matchbox-client")),
    ).toEqual(["stuart", "stuart"])
    expect(
      seen.map((request) => request.headers.get("x-matchbox-end-user")),
    ).toEqual([key, null])
  })

  it("reads /internal/blockscout/<path> and validates the body", async () => {
    const read = apiBlockscout(
      fakeApi({
        "/internal/blockscout/api/v2/transactions/0xabc": json({
          hash: "0xabc",
        }),
      }),
    )
    expect(await read("/api/v2/transactions/0xabc", schema)).toEqual({
      status: "ok",
      data: { hash: "0xabc" },
    })
  })
})
