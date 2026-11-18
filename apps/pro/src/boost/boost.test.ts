import { afterEach, describe, expect, it } from "vitest"
import { validateRootSearch } from "../lib/viewer"
import { calcFill, calcSearch, calcSearchFrom, withoutCalc } from "./calc-link"
import {
  type Fetcher,
  forgetBoostTotals,
  lastBoostTotals,
  readBoostTotals,
  rememberBoostTotals,
} from "./totals"

const word = (value: bigint): string =>
  `0x${value.toString(16).padStart(64, "0")}`

const veBtcTotal = 654_520_000_000_000_000_000n
const veMezoTotal = 99_390_000n * 10n ** 18n

type Sent = { url: string; body: unknown }

function rpc(
  answer: (body: unknown) => unknown,
  status = 200,
): { fetcher: Fetcher; sent: Sent[] } {
  const sent: Sent[] = []
  return {
    sent,
    fetcher: async (url, init) => {
      const body: unknown = JSON.parse(String(init.body))
      sent.push({ url, body })
      return new Response(JSON.stringify(answer(body)), { status })
    },
  }
}

function mezo(body: unknown): unknown {
  if (!Array.isArray(body)) {
    return {
      jsonrpc: "2.0",
      id: 1,
      result: { number: "0xc8fd6b", timestamp: "0x6af42f38" },
    }
  }
  return [
    // Out of order on purpose: answers are matched by id.
    { jsonrpc: "2.0", id: 2, result: word(veMezoTotal) },
    { jsonrpc: "2.0", id: 1, result: word(veBtcTotal) },
  ]
}

afterEach(() => forgetBoostTotals())

describe("reading the system totals", () => {
  it("reads both escrows at one block", async () => {
    const { fetcher, sent } = rpc(mezo)
    const read = await readBoostTotals("https://rpc.example", fetcher)
    expect(read).toEqual({
      veBtc: veBtcTotal,
      veMezo: veMezoTotal,
      block: 13_172_075,
      readAt: 1_794_387_768,
    })
    expect(sent).toHaveLength(2)
    expect(sent[1]?.body).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to: "0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279",
            data: "0xdbfeca50",
          },
          "0xc8fd6b",
        ],
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "eth_call",
        params: [
          {
            to: "0xb90fdAd3DFD180458D62Cc6acedc983D78E20122",
            data: "0x671b3793",
          },
          "0xc8fd6b",
        ],
      },
    ])
  })

  it("fails, with no numbers at all, when the RPC does", async () => {
    await expect(
      readBoostTotals("https://rpc.example", rpc(mezo, 503).fetcher),
    ).rejects.toThrow("503")
    await expect(
      readBoostTotals(
        "https://rpc.example",
        rpc((body) =>
          Array.isArray(body)
            ? [
                { jsonrpc: "2.0", id: 1, error: { code: -32000 } },
                { jsonrpc: "2.0", id: 2, result: word(veMezoTotal) },
              ]
            : mezo(body),
        ).fetcher,
      ),
    ).rejects.toThrow()
    // An empty total is a bad answer, never something to divide by.
    await expect(
      readBoostTotals(
        "https://rpc.example",
        rpc((body) =>
          Array.isArray(body)
            ? [
                { jsonrpc: "2.0", id: 1, result: word(0n) },
                { jsonrpc: "2.0", id: 2, result: word(veMezoTotal) },
              ]
            : mezo(body),
        ).fetcher,
      ),
    ).rejects.toThrow("Empty totals")
  })

  it("keeps the last good read for this visit only", async () => {
    expect(lastBoostTotals()).toBeNull()
    const read = await readBoostTotals("https://rpc.example", rpc(mezo).fetcher)
    rememberBoostTotals(read)
    expect(lastBoostTotals()).toEqual(read)
  })
})

describe("the calculator's link", () => {
  it("opens filled from ?calc&vebtc=1&vemezo=100000&for=5", () => {
    expect(
      calcSearchFrom({ calc: "", vebtc: "1", vemezo: "100000", for: "5" }),
    ).toEqual({ calc: 1, vebtc: "1", vemezo: "100000", target: 500 })
    // The router parses bare numbers.
    expect(calcSearchFrom({ calc: 1, vebtc: 0.611, vemezo: 41260 })).toEqual({
      calc: 1,
      vebtc: "0.611",
      vemezo: "41260",
    })
  })

  it("takes a boost to two places and the figure to work out", () => {
    expect(
      calcSearchFrom({ calc: 1, vemezo: 100000, for: 3.25, solve: "vebtc" }),
    ).toEqual({ calc: 1, vemezo: "100000", target: 325, solve: "vebtc" })
    expect(calcSearchFrom({ calc: 1, for: "1" })).toEqual({
      calc: 1,
      target: 100,
    })
    expect(calcSearchFrom({ calc: 1, for: "4.5" })).toEqual({
      calc: 1,
      target: 450,
    })
    for (const bad of ["5.01", "0.5", "6", "3.255", "x", "-2"]) {
      expect(calcSearchFrom({ calc: 1, for: bad })).toEqual({ calc: 1 })
    }
    expect(calcSearchFrom({ calc: 1, solve: "both" })).toEqual({ calc: 1 })
  })

  it("drops what is not an amount or a target, and stays closed without calc", () => {
    expect(
      calcSearchFrom({
        calc: 1,
        vebtc: "<script>",
        vemezo: "-5",
        for: "9",
      }),
    ).toEqual({ calc: 1 })
    expect(calcSearchFrom({ vebtc: "1" })).toEqual({})
    expect(calcSearchFrom({ calc: "0" })).toEqual({})
  })

  it("builds the link's search and takes it away again", () => {
    const open = calcSearch({ veBtc: "0.6110", veMezo: null, target: 500 })
    expect(open).toEqual({ calc: 1, vebtc: "0.6110", for: 5 })
    expect(
      calcSearch({ veMezo: "100000", target: 325, solve: "vebtc" }),
    ).toEqual({ calc: 1, vemezo: 100000, for: 3.25, solve: "vebtc" })
    expect(calcSearch({ target: 450 })).toEqual({ calc: 1, for: 4.5 })
    expect(calcSearch({ target: 900 })).toEqual({ calc: 1 })
    // A plain number goes in the URL as one: ?vebtc=1&vemezo=100000, with
    // no quoted string for the router to redirect to.
    expect(calcSearch({ veBtc: "1", veMezo: "100000" })).toEqual({
      calc: 1,
      vebtc: 1,
      vemezo: 100000,
    })
    expect(withoutCalc({ ...open, solve: "vebtc", address: "0xabc" })).toEqual({
      address: "0xabc",
    })
  })

  it("keeps the link's keys as they came, and checks them when the sheet opens", () => {
    const search = validateRootSearch({
      calc: 1,
      vebtc: 1,
      vemezo: "<script>",
      for: "7",
    })
    // The root route passes them through (a number stays a number).
    expect(search).toEqual({
      calc: 1,
      vebtc: 1,
      vemezo: "<script>",
      for: "7",
    })
    // The sheet takes only what is an amount or a boost.
    expect(calcFill(search)).toEqual({ vebtc: "1" })
    expect(
      calcFill({
        calc: 1,
        vebtc: 0.611,
        vemezo: 41260,
        for: 4,
        solve: "boost",
      }),
    ).toEqual({
      vebtc: "0.611",
      vemezo: "41260",
      target: 400,
      solve: "boost",
    })
  })

  it("rides in the root route's search beside the wallet address", () => {
    const address = "0xdc887b3d44bdf789d60d2d427d5e8db6e4ed6ad1"
    expect(
      validateRootSearch({ address, calc: "", for: 4, solve: "vemezo" }),
    ).toEqual({
      address,
      calc: 1,
      for: 4,
      solve: "vemezo",
    })
    expect(validateRootSearch({ address })).toEqual({ address })
    expect(validateRootSearch({})).toEqual({})
  })
})
