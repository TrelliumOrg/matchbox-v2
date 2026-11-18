import type { TokenRef } from "@matchbox/contracts/read-models"
import type {
  ScanBorrowTotalsResponse,
  scanValidatorsSchema,
} from "@matchbox/contracts/scan"
import type { z } from "zod"
import { borrowFigures } from "./borrow"
import { dayText, type HomeFigures } from "./figures"
import { nameBlocks, shortAddress, validatorNames } from "./validators"

/**
 * The figures local builds and the smoke tests paint (`HOME_DATA=fixtures`),
 * the example values of the approved frames (docs/design/home-final). Each
 * call moves the latest blocks on with the clock, one block every 3.8 s,
 * so a fresh read differs from the page's and the swap can be seen.
 */

function token(symbol: string, name: string, address: string): TokenRef {
  return { address, symbol, name, decimals: 18 }
}

const btc = token(
  "BTC",
  "Bitcoin",
  "0x7b7c000000000000000000000000000000000000",
)
const musd = token(
  "MUSD",
  "Mezo USD",
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
)
const musdc = token(
  "mUSDC",
  "Mezo USDC",
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
)

/** Block 13,078,795 at Wed 11 Nov 2026 04:00 UTC; one every 3.8 s after. */
const anchorBlock = 13_078_795
const anchorMs = Date.UTC(2026, 10, 11, 4, 0, 0)

/* Validators: an answer of `GET /internal/scan/validators`. */

/** A proposer with a directory name. */
const northfield = "0x6e3540c4e3f8be2a0f6c9a3a0f0b1c2d3e4f23b5"
/** The proposer of Matchscan's recorded block 13,118,576, Harbor Stake. */
const harbor = "0x41b1a7f633eb9dac1fc19adae41aa7562c620971"
/** A proposer Scan has only a label for. */
const copperline = "0x9c0f3d1e2b4a5c6d7e8f90a1b2c3d4e5f6a7b8c9"
/** A proposer with a name too long for its row: it ends in an ellipsis. */
const longName = "0x2f6d8b0a1c3e5f7a9b1d3f5a7c9e1b3d5f7a9c1e"
/** A proposer in no validator's row: the page shows its short address. */
export const unnamedProposer = "0xd056656123bea72fe9139bac0539b8f53d850247"

/** The fixture blocks' proposers in turn, by block number. */
const proposers = [northfield, harbor, copperline, longName, unnamedProposer]

/** The long name, in full: the row cuts it with an ellipsis. */
export const longValidatorName =
  "Northern Hemisphere Validators Collective and Staking Cooperative of Mezo Nodes"

function validatorRow(
  address: string,
  name: string | null,
  label: string | null,
) {
  return {
    address,
    name,
    label,
    operator: name === null ? null : address,
    gauge: null,
    pool_status: name === null ? null : ("active" as const),
    blocks: "22100",
    share_bps: 2500,
    blocks_total: { value: "3270000", day: "2026-11-10" },
  }
}

/**
 * The `/validators` answer the fixtures name their proposers from: two
 * directory names, a label only, a long name, and a validator with
 * neither (an empty name counts as none). The unnamed proposer is in no
 * row at all.
 */
export const validatorsFixture: z.input<typeof scanValidatorsSchema> = {
  data: {
    available: true,
    reason: null,
    day: "2026-11-10",
    day_total: "88400",
    shares_complete: true,
    share_of: "all_blocks",
    blocks_in_day: "88400",
    unattributed_blocks: "0",
    missing_counts: [],
    validators: [
      validatorRow(northfield, "Northfield Nodes", null),
      validatorRow(harbor, "Harbor Stake", "Harbor Stake (label)"),
      validatorRow(copperline, null, "Copperline"),
      validatorRow(longName, longValidatorName, null),
      validatorRow("0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a", " ", null),
    ],
    pool_without_operator: [
      {
        gauge: "0x3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c",
        name: "Tallow & Co",
        pool_status: "left",
      },
    ],
  },
  meta: { complete: true, asOf: 1_794_355_200 },
}

/** The fixture proposers' names, as the edge reads them. */
export const fixtureNames = validatorNames(validatorsFixture)

/* Borrow totals: three answers of `GET /internal/scan/borrow/totals`. */

const musdAddress = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
const musdcAddress = "0x04671c72aab5ac02a03c1098314b1bb6b560c197"

/** Whole MUSD, with up to 18 decimals, to base units. */
function musdUnits(whole: string): string {
  const [int = "0", fraction = ""] = whole.split(".")
  return (
    BigInt(int) * 10n ** 18n +
    BigInt(fraction.padEnd(18, "0"))
  ).toString()
}

type Venue = "troves" | "enclaves" | "markets"

/** One day's close: each venue's debt in whole MUSD, or null if missing. */
type Close = Record<Venue, string | null>

function sum(close: Close): string | null {
  if (close.troves === null || close.enclaves === null) return null
  if (close.markets === null) return null
  return (
    BigInt(musdUnits(close.troves)) +
    BigInt(musdUnits(close.enclaves)) +
    BigInt(musdUnits(close.markets))
  ).toString()
}

const unavailable = { status: "unavailable", reason: "upstream" } as const

/**
 * An answer from today's venues (null: unavailable) and 30 daily closes,
 * the last one today's live total, as the route builds it.
 */
function borrowAnswer(
  nowMs: number,
  today: Close,
  closes: readonly Close[],
): ScanBorrowTotalsResponse {
  const total = sum(today)
  const missing = (["troves", "enclaves", "markets"] as const).filter(
    (venue) => today[venue] === null,
  )
  const share =
    total === null || today.enclaves === null || total === "0"
      ? null
      : (
          (BigInt(musdUnits(today.enclaves)) * 10n ** 18n) /
          BigInt(total)
        ).toString()
  const day = (back: number): string =>
    new Date(nowMs - back * 86_400_000).toISOString().slice(0, 10)
  const units = (value: string | null): string | null =>
    value === null ? null : musdUnits(value)
  const points = closes.map((close, index) => ({
    day: day(closes.length - 1 - index),
    total: sum(close),
    troves: units(close.troves),
    enclaves: units(close.enclaves),
    markets: units(close.markets),
    partial: index === closes.length - 1,
  }))
  return {
    data: {
      unit: { symbol: "MUSD", token: musdAddress, decimals: 18 },
      total,
      missing,
      enclaves_share: share,
      venues: {
        troves:
          today.troves === null
            ? unavailable
            : {
                status: "ok",
                data: {
                  basis: "principal_plus_interest",
                  debt: musdUnits(today.troves),
                  principal: musdUnits("55000"),
                  interest: (
                    BigInt(musdUnits(today.troves)) - BigInt(musdUnits("55000"))
                  ).toString(),
                  open: 3,
                  block: 13_078_790,
                },
              },
        enclaves:
          today.enclaves === null
            ? unavailable
            : {
                status: "ok",
                data: {
                  basis: "principal",
                  debt: musdUnits(today.enclaves),
                  open: 4,
                  positions: 5,
                  latest_block: 13_070_112,
                  latest_timestamp: Math.max(
                    0,
                    Math.floor(nowMs / 1000) - 3_600,
                  ),
                },
              },
        markets:
          today.markets === null
            ? unavailable
            : {
                status: "ok",
                data: {
                  basis: "total_borrow_assets",
                  debt: musdUnits(today.markets),
                  included: [
                    {
                      market_id: `0x${"1".repeat(64)}`,
                      loan_token: musdAddress,
                      borrowed: musdUnits(today.markets),
                      loan_decimals: 18,
                    },
                  ],
                  // BTC / mUSDC lends mUSDC: listed in its own token, never added.
                  excluded: [
                    {
                      market_id: `0x${"2".repeat(64)}`,
                      loan_token: musdcAddress,
                      borrowed: "62710840000",
                      loan_decimals: 6,
                      reason: "loan_token",
                    },
                  ],
                },
              },
      },
      history: {
        status: "ok",
        data: { from: points[0]?.day ?? day(0), to: day(0), points },
      },
    },
    snapshot: {
      block: 13_078_790,
      head: 13_078_795,
      behind_blocks: 5,
      stale: false,
      max_behind_blocks: 120,
    },
  }
}

/** Today: 55,533.40 in troves, 4,000,000 in Enclaves, nothing in markets. */
const normalToday: Close = {
  troves: "55533.4",
  enclaves: "4000000",
  markets: "0",
}

/** 30 days stepping up as the frames' sparkline does, today last. */
function normalCloses(today: Close): Close[] {
  return Array.from({ length: 30 }, (_, index): Close => {
    if (index === 29) return today
    const enclaves = index < 9 ? "2000000" : index < 12 ? "2300000" : "4000000"
    return { troves: `${50_000 + index * 180}.5`, enclaves, markets: "0" }
  })
}

export const borrowTotalsFixtures = {
  /** Every venue read: 4,055,533.40 MUSD, 98.6% of it in Enclaves. */
  normal(nowMs: number): ScanBorrowTotalsResponse {
    return borrowAnswer(nowMs, normalToday, normalCloses(normalToday))
  },
  /**
   * The troves could not be read: no total and no share, and today's
   * point has no total either. The earlier days are whole.
   */
  missingVenue(nowMs: number): ScanBorrowTotalsResponse {
    const today = { ...normalToday, troves: null }
    return borrowAnswer(nowMs, today, normalCloses(today))
  },
  /**
   * Gaps in the history: the closes start on the sixth day, and day 17
   * lacks the markets' close. Today is whole.
   */
  gaps(nowMs: number): ScanBorrowTotalsResponse {
    const closes = normalCloses(normalToday).map(
      (close, index): Close =>
        index < 5
          ? { troves: null, enclaves: close.enclaves, markets: null }
          : index === 17
            ? { ...close, markets: null }
            : close,
    )
    return borrowAnswer(nowMs, normalToday, closes)
  },
}

function borrowed(nowMs: number) {
  const figures = borrowFigures(borrowTotalsFixtures.normal(nowMs))
  if (figures === null) throw new Error("the normal borrow fixture has a total")
  return figures
}

export function fixtureFigures(nowMs: number): HomeFigures {
  const head = anchorBlock + Math.max(0, Math.floor((nowMs - anchorMs) / 3800))
  // Blockscout names no proposer: each block comes with its address, and
  // the names are put on as the edge puts them on.
  const read = [0, 1, 2].map((back) => {
    const number = head - back
    const address = proposers[number % proposers.length] ?? unnamedProposer
    return {
      number,
      address,
      proposer: shortAddress(address),
      transactions: (number * 7) % 6,
    }
  })
  const blocks = nameBlocks(read, fixtureNames)
  return {
    pro: {
      incentivesUsd: "14820",
      gauges: [
        {
          address: "0x1000000000000000000000000000000000000001",
          name: "BTC/MUSD",
          kind: "pool",
          picture: { type: "pair", tokens: [btc, musd] },
          votes: "112.40",
          votesUnit: "veBTC",
          incentivesUsd: "4210",
          tokens: ["MEZO", "MUSD"],
        },
        {
          address: "0x1000000000000000000000000000000000000002",
          name: "mUSDC/MUSD",
          kind: "pool",
          picture: { type: "pair", tokens: [musdc, musd] },
          votes: "79.30",
          votesUnit: "veBTC",
          incentivesUsd: "2480",
          tokens: ["MUSD"],
        },
        {
          address: "0x1000000000000000000000000000000000000003",
          name: "Kiln Labs",
          kind: "vebtc",
          picture: { type: "initials", text: "KL" },
          votes: "5880000",
          votesUnit: "veMEZO",
          incentivesUsd: "1180",
          tokens: ["MEZO"],
        },
      ],
    },
    scan: {
      ...borrowed(nowMs),
      vebtcLocked: "1404.32",
      vebtcLockedUsd: "148450000",
      vebtcSeries: [
        0, 0.13, 0.22, 0.28, 0.31, 0.41, 0.5, 0.59, 0.72, 0.84, 0.94, 1,
      ],
      vebtcDays: [
        "1,321.10",
        "1,332.14",
        "1,339.79",
        "1,344.89",
        "1,347.44",
        "1,355.94",
        "1,363.59",
        "1,371.24",
        "1,382.30",
        "1,392.50",
        "1,401.00",
        "1,404.32",
      ].map((amount, index, all) => ({
        label: dayText(
          new Date(nowMs - (all.length - 1 - index) * 86_400_000)
            .toISOString()
            .slice(0, 10),
          index === all.length - 1,
        ),
        text: `${amount} BTC`,
      })),
      blocks,
    },
    at: {
      summary: nowMs,
      gauges: nowMs,
      vebtcSeries: nowMs,
      blocks: nowMs,
      borrow: nowMs,
    },
  }
}
