import { describe, expect, it } from "vitest"
import {
  demoMezoId,
  fixtureDownMezoId,
  fixtureResponse,
} from "../data/fixture-api"

const demo = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"

function identity(key: string) {
  return fixtureResponse(`/internal/pro/wallets/${key}/identity`, 0)
}

function mezoIds(key: string) {
  return fixtureResponse(`/internal/scan/mezo-ids/${key}`, 0)
}

function body(response: ReturnType<typeof fixtureResponse>): unknown {
  return response.status === 200 ? response.body : null
}

describe("identity fixtures", () => {
  it("names the demo wallet pyke.mezo by address", () => {
    for (const key of [demo, demo.toUpperCase().replace("0X", "0x")]) {
      expect(body(identity(key))).toMatchObject({
        data: { address: demo, mezoId: "pyke.mezo", status: "found" },
        meta: { source: "mezo-accounts" },
      })
    }
  })

  it("takes addresses only, as the API's identity route does", () => {
    const other = `0x1f3a${"0".repeat(32)}88b2`
    expect(body(identity(other))).toMatchObject({
      data: { address: other, mezoId: null, status: "not-found" },
    })
    expect(identity(demoMezoId).status).toBe(404)
    expect(identity("alice.mezo").status).toBe(404)
  })
})

describe("Mezo ID resolver fixtures", () => {
  it("answers pyke.mezo with the demo wallet, in the API's shape", () => {
    for (const key of [demoMezoId, "PYKE.MEZO"]) {
      expect(body(mezoIds(key))).toEqual({
        data: { status: "found", mezo_id: demoMezoId, wallets: [demo] },
      })
    }
    expect(body(mezoIds(demo))).toEqual({
      data: { status: "found", mezo_id: demoMezoId, wallets: [demo] },
    })
  })

  it("answers misses, an outage and refused keys as the API does", () => {
    expect(body(mezoIds("nobody.mezo"))).toEqual({
      data: { status: "not-found" },
    })
    expect(body(mezoIds(fixtureDownMezoId))).toEqual({
      data: { status: "unavailable" },
    })
    expect(mezoIds("pyke_1.mezo").status).toBe(404)
    expect(fixtureResponse("/internal/scan/labels", 0).status).toBe(404)
  })
})
