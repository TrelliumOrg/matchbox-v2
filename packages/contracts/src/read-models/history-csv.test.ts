import { describe, expect, it } from "vitest"
import {
  type ActivityRow,
  activityRowSchema,
  type ClaimValue,
} from "./activity"
import { demoActivityRows, demoGauges, demoTokens } from "./fixtures"
import {
  csvCell,
  historyCsvBom,
  historyCsvColumns,
  historyCsvFileName,
  historyCsvHeader,
  historyCsvLines,
  historyCsvNote,
  historyCsvPriceSources,
  historyCsvStart,
} from "./history-csv"
import type { TokenRef } from "./primitives"

const wallet = `0x50d4${"0".repeat(32)}c139`
/** When the file is made: 13 Mar 2026, 12:00 UTC. */
const now = Date.parse("2026-03-13T12:00:00Z") / 1000
const tx = `0x${"ab".repeat(32)}`

/** A spreadsheet's reading of the cells of one CSV line (RFC 4180). */
function parseLine(text: string): string[] {
  const cells: string[] = []
  let cell = ""
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ",") {
      cells.push(cell)
      cell = ""
    } else cell += char
  }
  cells.push(cell)
  return cells
}

function lines(text: string): string[] {
  expect(text.endsWith("\r\n")).toBe(true)
  return text.slice(0, -2).split("\r\n")
}

function claim(
  tokens: { token: TokenRef; amount: string }[],
  atClaim?: ClaimValue,
): ActivityRow {
  return activityRowSchema.parse({
    type: "claim",
    id: `${tx}-3`,
    txHash: tx,
    block: 10,
    timestamp: Date.UTC(2026, 2, 12, 15, 20, 5) / 1000,
    status: "confirmed",
    actor: wallet,
    epoch: null,
    rewards: {
      usd: "1.00",
      tokens: tokens.map((each) => ({ ...each, usd: "1.00" })),
    },
    ...(atClaim === undefined ? {} : { atClaim }),
    locks: [
      { escrow: "vebtc", tokenId: "4120" },
      { escrow: "vemezo", tokenId: "2207" },
    ],
    gauges: [demoGauges.kilnLabs],
  })
}

describe("history CSV", () => {
  it("has the columns tax tools read", () => {
    expect(historyCsvHeader).toBe(`${historyCsvColumns.join(",")}\r\n`)
    expect(historyCsvColumns).toEqual([
      "date_utc",
      "epoch",
      "claimed_in_epoch",
      "type",
      "tx_hash",
      "token_symbol",
      "token_address",
      "amount",
      "usd_value_at_time",
      "price_usd",
      "price_source",
      "price_date_utc",
      "gauge",
      "lock_id",
    ])
  })

  it("writes one line a token, with the value when claimed", () => {
    const row = claim(
      [
        { token: demoTokens.btc, amount: "0.000412" },
        { token: demoTokens.mezo, amount: "1234.5" },
      ],
      {
        usd: "44.13",
        tokens: [
          {
            token: demoTokens.btc.address,
            price: "70123.456789",
            usd: "28.89",
            day: "2026-03-12",
            source: "coingecko",
            pricedAs: "btc",
          },
          {
            token: demoTokens.mezo.address,
            price: null,
            usd: null,
            day: "2026-03-12",
            source: null,
            pricedAs: null,
          },
        ],
      },
    )
    const [btc, mezo] = lines(historyCsvLines(row, now)).map(parseLine)
    expect(btc).toEqual([
      "2026-03-12T15:20:05Z",
      // No epoch known for the claim: the one it happened in, twice.
      "13",
      "13",
      "claim",
      tx,
      "BTC",
      demoTokens.btc.address,
      "0.000412",
      "28.89",
      "70123.456789",
      "CoinGecko daily",
      "2026-03-12T00:00:00Z",
      "Kiln Labs",
      "veBTC #4120 | veMEZO #2207",
    ])
    // No price is said, never $0.
    expect(mezo?.slice(7, 12)).toEqual(["1234.5", "", "", "No price", ""])
  })

  it("says a claim whose day is not priced yet is pending", () => {
    const [cells] = lines(
      historyCsvLines(claim([{ token: demoTokens.musd, amount: "151" }]), now),
    ).map(parseLine)
    expect(cells?.[10]).toBe("Not priced yet")
    expect(cells?.[8]).toBe("")
  })

  it("writes a settling claim's estimate, said to be one", () => {
    const row = activityRowSchema.parse({
      ...claim([
        { token: demoTokens.mezo, amount: "100" },
        { token: demoTokens.btc, amount: "1" },
      ]),
      estimate: {
        usd: "2.00",
        tokens: [
          { token: demoTokens.mezo.address, price: "0.02", usd: "2.00" },
          { token: demoTokens.btc.address, price: null, usd: null },
        ],
        finalOn: "2026-03-15",
      },
    })
    const [mezo, btc] = lines(historyCsvLines(row, now)).map(parseLine)
    expect(mezo?.slice(8, 12)).toEqual([
      "2.00",
      "0.02",
      "Estimate, not final",
      "",
    ])
    expect(btc?.slice(8, 12)).toEqual(["", "", "No price", ""])
  })

  it("writes an estimate past its day to be final as not priced yet", () => {
    // A stored row the fill has not reached, read after 15 Mar.
    const row = activityRowSchema.parse({
      ...claim([{ token: demoTokens.mezo, amount: "100" }]),
      estimate: {
        usd: "2.00",
        tokens: [
          { token: demoTokens.mezo.address, price: "0.02", usd: "2.00" },
        ],
        finalOn: "2026-03-15",
      },
    })
    const on = (iso: string) =>
      lines(historyCsvLines(row, Date.parse(iso) / 1000)).map(parseLine)[0]
    // Still an estimate on its day to be final.
    expect(on("2026-03-15T23:00:00Z")?.slice(8, 12)).toEqual([
      "2.00",
      "0.02",
      "Estimate, not final",
      "",
    ])
    expect(on("2026-03-16T00:00:00Z")?.slice(8, 12)).toEqual([
      "",
      "",
      "Not priced yet",
      "",
    ])
  })

  it("keeps 18-decimal amounts exact, never a float or an exponent", () => {
    const tiny = "0.000000000000000001"
    const large = "123456789012345678.123456789012345678"
    const text = historyCsvLines(
      claim([
        { token: demoTokens.btc, amount: tiny },
        { token: demoTokens.mezo, amount: large },
      ]),
      now,
    )
    const [first, second] = lines(text).map(parseLine)
    expect(first?.[7]).toBe(tiny)
    expect(second?.[7]).toBe(large)
    expect(text).not.toMatch(/\de[+-]?\d/)
  })

  it("guards every cell against formula injection and quotes correctly", () => {
    for (const value of [
      "=HYPERLINK(1)",
      "+1",
      "-1",
      "@SUM(A1)",
      "\tx",
      "\rx",
      "\nx",
      "  =1+1",
      " @SUM(A1)",
      `${String.fromCharCode(0x3000)}=1`,
      "＝1+1",
      "＋1",
      "－1",
      "＠SUM(A1)",
      " ＝1",
    ]) {
      expect(csvCell(value).replace(/^"|"$/g, "").startsWith("'")).toBe(true)
    }
    for (const value of ["a=1", "1-2", "MUSD", " plain", "0x7b7c", "0.5"]) {
      expect(csvCell(value).replace(/^"|"$/g, "").startsWith("'")).toBe(false)
    }
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"')
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"')
    expect(csvCell("plain")).toBe("plain")
    expect(csvCell("")).toBe("")

    // A token and a gauge named to run a formula, from a contract anyone
    // can deploy.
    const evil = {
      address: "0x9999999999999999999999999999999999999999",
      symbol: '=cmd|" /C calc"!A0',
      name: "Evil",
      decimals: 18,
    }
    const row = activityRowSchema.parse({
      type: "incentive",
      id: `${tx}-1`,
      txHash: tx,
      block: 1,
      timestamp: Date.UTC(2026, 2, 12) / 1000,
      status: "confirmed",
      actor: wallet,
      gauge: { ...demoGauges.kilnLabs, name: '@evil, "gauge"' },
      epoch: {
        number: 13,
        start: Date.UTC(2026, 2, 12) / 1000,
        end: Date.UTC(2026, 2, 19) / 1000,
      },
      amount: { token: evil, amount: "5", usd: null },
    })
    const [cells] = lines(historyCsvLines(row, now)).map(parseLine)
    expect(cells?.[5]).toBe(`'=cmd|" /C calc"!A0`)
    expect(cells?.[12]).toBe(`'@evil, "gauge"`)
    expect(cells).toHaveLength(historyCsvColumns.length)
  })

  it("leaves amounts, hashes and addresses as written", () => {
    const row = claim([
      { token: demoTokens.mezo, amount: "0.000000000000000001" },
    ])
    const [cells] = lines(historyCsvLines(row, now)).map(parseLine)
    expect(cells?.[4]).toBe(tx)
    expect(cells?.[6]).toBe(demoTokens.mezo.address)
    expect(cells?.[7]).toBe("0.000000000000000001")
  })

  it("starts the file with UTF-8's byte order mark, then the header", () => {
    expect(historyCsvStart).toBe(`${historyCsvBom}${historyCsvHeader}`)
    expect(historyCsvBom.charCodeAt(0)).toBe(0xfeff)
    const bytes = new TextEncoder().encode(historyCsvStart)
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    // A reader that decodes UTF-8 drops it, and the header parses whole.
    const decoded = new TextDecoder().decode(bytes)
    expect(parseLine(lines(decoded)[0] ?? "")).toEqual([...historyCsvColumns])
    // Symbols and names that are not ASCII stay as written.
    const named = activityRowSchema.parse({
      ...claim([
        {
          token: { ...demoTokens.mezo, symbol: "MEZO€", name: "Mézo" },
          amount: "1",
        },
      ]),
      gauges: [{ ...demoGauges.kilnLabs, name: "Kiln 実験室" }],
    })
    const text = new TextDecoder().decode(
      new TextEncoder().encode(historyCsvStart + historyCsvLines(named, now)),
    )
    const [, line] = lines(text).map(parseLine)
    expect(line?.[5]).toBe("MEZO€")
    expect(line?.[12]).toBe("Kiln 実験室")
  })

  it("writes every row type with the same columns", () => {
    for (const row of demoActivityRows) {
      for (const cells of lines(historyCsvLines(row, now)).map(parseLine)) {
        expect(cells).toHaveLength(historyCsvColumns.length)
        expect(cells[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
      }
    }
  })

  it("numbers a claim by the epoch it paid out, as Pro does, and the one it was claimed in", () => {
    // Claimed on 12 Mar 2026 (Epoch 13) for Epoch 12.
    const row = activityRowSchema.parse({
      ...claim([{ token: demoTokens.musd, amount: "1" }]),
      epoch: {
        number: 12,
        start: Date.UTC(2026, 2, 5) / 1000,
        end: Date.UTC(2026, 2, 12) / 1000,
      },
    })
    const [cells] = lines(historyCsvLines(row, now)).map(parseLine)
    expect(cells?.slice(1, 4)).toEqual(["12", "13", "claim"])
    // A vote is the epoch it is for, with no claimed-in epoch.
    const vote = demoActivityRows.find((each) => each.type === "vote")
    if (vote?.type !== "vote") throw new Error("no vote")
    const [voted] = lines(historyCsvLines(vote, now)).map(parseLine)
    expect(voted?.[2]).toBe("")
    expect(voted?.[1]).toBe(
      String(
        Math.round(
          (vote.epoch.start - Date.UTC(2025, 11, 11) / 1000) / 604_800,
        ),
      ),
    )
  })

  it("leaves the epoch out before Epoch 0", () => {
    const row = activityRowSchema.parse({
      ...demoActivityRows.find((each) => each.type === "lock-add"),
      timestamp: Date.UTC(2025, 11, 4) / 1000,
    })
    expect(parseLine(lines(historyCsvLines(row, now))[0] ?? "")[1]).toBe("")
  })

  it("names the file and the notes", () => {
    expect(
      historyCsvFileName(
        "0x50D4000000000000000000000000000000C139",
        "rewards",
        Date.UTC(2026, 10, 20, 23, 59) / 1000,
      ),
    ).toBe("matchbox-0x50d4-c139-rewards-2026-11-20.csv")
    expect(historyCsvNote({ kind: "pending" })).toBe(
      "Note: history still being added. Older rows are not in this file yet.\r\n",
    )
    expect(
      lines(historyCsvNote({ kind: "capped", rows: 20_000 })).map(parseLine),
    ).toEqual([
      ["Note: this file stops at 20000 rows. Older rows are not in it."],
    ])
  })
})

describe("history CSV docs", () => {
  it("lists every price source a line can carry", async () => {
    const { readFile } = await import("node:fs/promises")
    const docs = await readFile(
      new URL("../../../docs/content/pro/rewards.md", import.meta.url),
      "utf8",
    )
    for (const source of Object.values(historyCsvPriceSources)) {
      expect(docs).toMatch(new RegExp(`^[|] ${source} +[|]`, "m"))
    }
  })
})
