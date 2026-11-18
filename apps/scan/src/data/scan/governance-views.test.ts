import type {
  ScanEpochSources,
  ScanLockDistribution,
  ScanVoterEpoch,
} from "@matchbox/contracts/scan"
import { EPOCH_SECONDS, epochStartForIndex } from "@matchbox/domain/epoch"
import { describe, expect, it } from "vitest"
import {
  aprText,
  columnAmount,
  emissionsEarnedView,
  gaugeAprView,
  gaugeVoterApr,
  lockAmount,
  lockDistributionView,
  paidBySource,
  votingAprView,
} from "./governance-views"
import { lockWireIn, lockWireOut } from "./lock-wire"
import { btcToken, mezoToken } from "./pricing"

const usdc = "0x04671c72aab5ac02a03c1098314b1bb6b560c197"
const e46 = epochStartForIndex(46)
const e47 = epochStartForIndex(47)
/** Sunday of Epoch 47. */
const now = e47 + 3 * 86_400
const unit = 10n ** 18n
const day = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)
const prices = {
  btc: [{ day: day(e46), price: "100000" }],
  mezo: [{ day: day(e46), price: "0.01" }],
}

function source(
  epoch: number,
  name: string,
  incentives: Record<string, string>,
  fees: Record<string, string> = {},
): ScanEpochSources["data"][number] {
  return {
    epoch_start: epoch,
    source: name,
    emissions: "0",
    incentives,
    fees,
    vote_weight: "1",
    gauges: 1,
    emission_gauges: 0,
    updated_at: epoch,
    complete: true,
  }
}

describe("paidBySource", () => {
  it("splits veBTC voters' rewards into chain fees, pool fees and incentives", () => {
    const view = paidBySource({
      escrow: "vebtc",
      sources: [
        source(
          e46,
          "POOLS_VOTER",
          { [usdc]: "1000000000" },
          { [usdc]: "500000000" },
        ),
        source(e46, "VALIDATORS_VOTER", {
          [mezoToken]: (100_000n * unit).toString(),
        }),
        // veMEZO's: left out of veBTC's figures.
        source(e46, "BOOST_VOTER", { [mezoToken]: (9n * unit).toString() }),
      ],
      // Paid at the flip into Epoch 47 (00:10 UTC Thursday), for Epoch 46.
      distributed: [{ day: day(e47), decimal: "0.01" }],
      prices,
      now,
      complete: true,
      asOf: null,
    })
    expect(view).not.toBeNull()
    expect(view?.bars.map((each) => each.epoch)).toEqual([46])
    // $1,000 + $1,000 incentives, $500 pool fees, $1,000 chain fees.
    expect(view?.figure).toBe("$3,500")
    expect(view?.note).toBe("Epoch 46")
    expect(view?.series.map((each) => each.label)).toEqual([
      "Chain fees",
      "Pool fees",
      "Incentives",
    ])
    const bar = view?.bars[0]
    expect(bar?.parts).toEqual([1000, 500, 2000])
    expect(view?.stats[0]).toEqual({
      label: "From incentives",
      value: "57.1%",
    })
  })

  it("gives veMEZO voters their incentives and the rebase", () => {
    const view = paidBySource({
      escrow: "vemezo",
      sources: [
        source(e46, "BOOST_VOTER", {}),
        source(e47, "BOOST_VOTER", { [mezoToken]: (1_000n * unit).toString() }),
      ],
      distributed: [{ day: day(e47), decimal: "2000" }],
      prices,
      now,
      complete: false,
      asOf: 5,
    })
    // The rebase paid at the flip belongs to Epoch 46; Epoch 47's comes
    // at its own close.
    expect(view?.bars.map((each) => [each.epoch, each.parts])).toEqual([
      [46, [20, 0, 0]],
      [47, [0, 0, 10]],
    ])
    expect(view?.bars[1]?.current).toBe(true)
    expect(view?.filling).toEqual({ asOf: 5 })
  })

  it("draws no bar of chain fees alone before the sources' first epoch", () => {
    const view = paidBySource({
      escrow: "vebtc",
      sources: [source(e47, "POOLS_VOTER", { [usdc]: "1000000000" })],
      distributed: [
        { day: day(e47), decimal: "0.01" },
        { day: day(e47 + EPOCH_SECONDS), decimal: "0.01" },
      ],
      prices,
      now: e47 + EPOCH_SECONDS + 86_400,
      complete: true,
      asOf: null,
    })
    expect(view?.bars.map((each) => each.epoch)).toEqual([47])
    expect(view?.bars[0]?.parts[0]).toBe(1000)
  })

  describe("before the flip's chain fees land", () => {
    const e45 = epochStartForIndex(45)
    const e48 = epochStartForIndex(48)
    const sources = [45, 46, 47].map((index) =>
      source(epochStartForIndex(index), "POOLS_VOTER", {
        [usdc]: "1000000000",
      }),
    )
    // Paid at the flips into Epochs 46 and 47, for Epochs 45 and 46.
    const paid = [
      { day: day(e46), decimal: "0.01" },
      { day: day(e47), decimal: "0.01" },
    ]
    const early = { btc: [{ day: day(e45), price: "100000" }], mezo: [] }

    it("headlines the epoch before and leaves the pending one out of the average", () => {
      const view = paidBySource({
        escrow: "vebtc",
        sources,
        distributed: paid,
        prices: early,
        // Thursday 01:00 UTC: Epoch 47 has closed, its chain fees are paid
        // but the finished-day series has no Thursday point yet.
        now: e48 + 3_600,
        complete: true,
        asOf: null,
      })
      expect(view?.bars.map((each) => [each.epoch, each.current])).toEqual([
        [45, false],
        [46, false],
        [47, true],
      ])
      expect(view?.figure).toBe("$2,000")
      expect(view?.note).toBe("Epoch 46")
      expect(view?.stats).toContainEqual({
        label: "Avg 2 epochs",
        value: "$2,000",
      })
    })

    it("holds no epoch when the series shows no payment is due", () => {
      // Jobs deployed before the backfill: an empty series, or one whose
      // last payment is older than the previous flip.
      for (const distributed of [[], [{ day: day(e46), decimal: "0.01" }]]) {
        const view = paidBySource({
          escrow: "vebtc",
          sources,
          distributed,
          prices: early,
          now: e48 + 3_600,
          complete: true,
          asOf: null,
        })
        expect(view?.bars.map((each) => each.current)).toEqual([
          false,
          false,
          false,
        ])
        expect(view?.note).toBe("Epoch 47")
      }
    })

    it("settles the epoch once the series has its flip day", () => {
      const view = paidBySource({
        escrow: "vebtc",
        sources,
        distributed: [...paid, { day: day(e48), decimal: "0.01" }],
        prices: early,
        now: e48 + 86_400 + 3_600,
        complete: true,
        asOf: null,
      })
      expect(view?.bars.map((each) => each.current)).toEqual([
        false,
        false,
        false,
      ])
      expect(view?.note).toBe("Epoch 47")
      expect(view?.stats).toContainEqual({
        label: "Avg 3 epochs",
        value: "$2,000",
      })
    })
  })

  it("has nothing to draw without either source", () => {
    expect(
      paidBySource({
        escrow: "vebtc",
        sources: [],
        distributed: null,
        prices,
        now,
        complete: true,
        asOf: null,
      }),
    ).toBeNull()
  })
})

function aprRow(
  epoch: number,
  voter: ScanVoterEpoch["voter"],
  apr: string | null,
): ScanVoterEpoch {
  return {
    epoch_start: epoch,
    voter,
    total_usd: "1",
    weight: "1",
    voting_token_usd: "1",
    apr_percent: apr,
    funded_gauges: 1,
    unpriced_rewards: 0,
    open: epoch === e47,
    updated_at: epoch,
  }
}

describe("APR views", () => {
  it("shows the escrow's APR per epoch with its change and averages", () => {
    const view = votingAprView(
      [
        aprRow(e46 - EPOCH_SECONDS, "vebtc", "3.1"),
        aprRow(e46, "vebtc", "2.5"),
        aprRow(e47, "vebtc", "2.92"),
        aprRow(e47, "vemezo", "11"),
        aprRow(e46, "pools", "9"),
      ],
      "vebtc",
      now,
    )
    expect(view?.figure).toBe("2.92%")
    expect(view?.note).toBe("+0.42 pts vs Epoch 46")
    expect(view?.bars.map((bar) => bar.text)).toEqual([
      "3.10%",
      "2.50%",
      "2.92%",
    ])
    expect(view?.stats).toEqual([
      { label: "veMEZO voters", value: "11.00%" },
      { label: "Epoch 46", value: "2.50%" },
      { label: "2 epoch avg", value: "2.80%" },
      { label: "High", value: "3.10%" },
    ])
  })

  it("puts the voters' APR first on a gauge's history", () => {
    const view = gaugeAprView(
      [
        {
          epoch_start: e46,
          voter: "validators",
          weight: "1",
          total_usd: "1",
          apr_percent: "2.61",
          unpriced_rewards: 0,
        },
        {
          epoch_start: e47,
          voter: "validators",
          weight: "1",
          total_usd: null,
          apr_percent: null,
          unpriced_rewards: 0,
        },
      ],
      { label: "veBTC voters", percent: "2.74" },
      now,
    )
    expect(view?.figure).toBe("2.61%")
    expect(view?.stats[0]).toEqual({ label: "veBTC voters", value: "2.74%" })
    expect(aprText("12")).toBe("12.00%")
  })

  it("compares a gauge with its own voter's ballot, not the escrow's sum", () => {
    const point = (voter: "pools" | "validators") => ({
      epoch_start: e47,
      voter,
      weight: "1",
      total_usd: "1",
      apr_percent: "2.61",
      unpriced_rewards: 0,
    })
    const rows = [
      aprRow(e47, "vebtc", "6.70"),
      aprRow(e47, "pools", "4.10"),
      aprRow(e47, "validators", "2.60"),
      aprRow(e46, "validators", "9.99"),
    ]
    expect(gaugeVoterApr([point("validators")], rows, e47)).toEqual({
      label: "Validator gauges",
      percent: "2.60",
    })
    expect(gaugeVoterApr([point("pools")], rows, e47)).toEqual({
      label: "Pool gauges",
      percent: "4.10",
    })
    expect(gaugeVoterApr([], rows, e47)).toBeNull()
    expect(
      gaugeVoterApr([point("pools")], [aprRow(e47, "pools", null)], e47),
    ).toBeNull()
  })
})

describe("emissionsEarnedView", () => {
  it("sums a gauge's epochs and leaves claims unknown", () => {
    const view = emissionsEarnedView(
      [
        {
          gauge: "0x0000000000000000000000000000000000000001",
          epoch_start: e47,
          source: "VALIDATORS_VOTER",
          amount: (62_580n * unit).toString(),
          events: 1,
          updated_at: e47,
        },
        {
          gauge: "0x0000000000000000000000000000000000000001",
          epoch_start: e46,
          source: "VALIDATORS_VOTER",
          amount: (60_000n * unit).toString(),
          events: 1,
          updated_at: e46,
        },
      ],
      prices,
      now,
    )
    expect(view?.figure).toBe("62,580 MEZO")
    expect(view?.note).toBe("Epoch 47, $625.80")
    expect(view?.bars.map((bar) => bar.epoch)).toEqual([46, 47])
    expect(view?.stats).toContainEqual({
      label: "Claimed",
      value: "Not indexed",
    })
    expect(view?.stats[0]).toEqual({
      label: "Since Epoch 46",
      value: "122.6k MEZO",
    })
  })
})

function lockDoc(): ScanLockDistribution {
  const group = (count: number, amount: bigint, power = amount) => ({
    count,
    amount: amount.toString(),
    voting_power: power.toString(),
  })
  const week = 7 * 86_400
  return {
    escrow: "vebtc",
    day: "2026-11-15",
    block: 13_201_553,
    read_at: now,
    max_lock_seconds: 4 * week,
    ids_read: 10,
    supply: (16n * unit).toString(),
    live: group(6, 16n * unit),
    permanent: group(2, 10n * unit),
    timed: group(3, 4n * unit, 2n * unit),
    expired: group(1, 2n * unit, 0n),
    largest: (8n * unit).toString(),
    median: (2n * unit).toString(),
    mean_remaining_seconds: 9 * 86_400,
    by_size: [
      { ...group(1, unit / 1000n), min: "0", max: (unit / 100n).toString() },
      {
        ...group(5, 16n * unit - unit / 1000n),
        min: (unit / 100n).toString(),
        max: null,
      },
    ],
    by_remaining: [
      { ...group(1, unit), min_seconds: 0, max_seconds: week },
      { ...group(2, 3n * unit), min_seconds: 3 * week, max_seconds: 4 * week },
    ],
    unlocks: [
      { at: e47 + EPOCH_SECONDS, count: 1, amount: unit.toString() },
      { at: e47 + 4 * EPOCH_SECONDS, count: 2, amount: (3n * unit).toString() },
    ],
  }
}

describe("lockDistributionView", () => {
  it("builds the four lock panels from one day's read", () => {
    const view = lockDistributionView({
      now: Date.parse(`${lockDoc().day}T12:00:00Z`) / 1000,
      latest: lockDoc(),
      ago30: {
        ...lockDoc(),
        permanent: { count: 1, amount: "1", voting_power: "1" },
      },
      ago90: null,
    })
    // Permanent 10 plus the longest bucket's 3 of 16.
    expect(view.length.figure).toBe("81.3%")
    expect(view.length.note).toBe("over 3 weeks or permanent")
    expect(view.length.columns.map((column) => column.label)).toEqual([
      "1 week",
      "4 weeks",
      "Permanent",
      "Expired",
    ])
    expect(view.permanence.figure).toBe("62.5%")
    expect(view.permanence.stats).toContainEqual({
      label: "Permanent 30d",
      value: "+1 lock",
    })
    expect(view.calendar.figure).toBe("4.0000 BTC")
    expect(view.calendar.note).toBe("in the next 12 months")
    expect(view.calendar.stats[0]).toEqual({
      label: "Next 30 days",
      value: "4.0000 BTC",
    })
    expect(view.permanence.stats.slice(0, 2)).toEqual([
      expect.objectContaining({ label: "Permanent lock", note: "average" }),
      expect.objectContaining({ label: "Timed lock", note: "average" }),
    ])
    for (const column of view.calendar.columns) {
      expect(column.text).toMatch(/ BTC$/)
      expect(column.short).toMatch(/ BTC$/)
    }
    for (const part of view.permanence.power) {
      expect(part.value).toMatch(/ veBTC$/)
    }
    expect(view.calendar.columns).toHaveLength(2)
    expect(view.size.columns.map((column) => column.label)).toEqual([
      "<0.01",
      "0.01+",
    ])
    expect(view.asOf).toBe("As of 15 Nov")
  })

  it("travels to the page as one string and back unchanged", () => {
    for (const daysLater of [0, 3]) {
      const view = lockDistributionView({
        now:
          Date.parse(`${lockDoc().day}T12:00:00Z`) / 1000 + daysLater * 86_400,
        latest: lockDoc(),
        ago30: null,
        ago90: null,
      })
      const wire = lockWireOut(view)
      expect(typeof wire).toBe("string")
      expect(lockWireIn(wire, "vebtc")).toEqual(view)
    }
  })

  it("ends veMEZO's unlock calendar after 12 months, one column each", () => {
    const at = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000
    const view = lockDistributionView({
      now,
      latest: {
        ...lockDoc(),
        escrow: "vemezo",
        // Read 8 Nov 2026: Nov 2026 to Oct 2027, never Nov 2027 as well.
        unlocks: [
          { at: at("2026-11-20"), count: 1, amount: (5n * unit).toString() },
          { at: at("2027-10-05"), count: 1, amount: (7n * unit).toString() },
          { at: at("2027-11-03"), count: 1, amount: (9n * unit).toString() },
        ],
      },
      ago30: null,
      ago90: null,
    })
    expect(view.calendar.columns.map((column) => column.label)).toEqual([
      "Nov",
      "Oct",
    ])
    expect(view.calendar.figure).toBe(lockAmount("vemezo", 12n * unit))
  })

  it("says plainly when the newest read is older than yesterday", () => {
    const read = Date.parse(`${lockDoc().day}T00:05:00Z`) / 1000
    const at = (seconds: number) =>
      lockDistributionView({
        now: seconds,
        latest: lockDoc(),
        ago30: null,
        ago90: null,
      })
    // Today's and yesterday's reads are current (the next one comes after
    // midnight).
    expect(at(read + 3_600).stale).toBe(false)
    expect(at(read + 86_400 + 3_600).stale).toBe(false)
    const old = at(read + 2 * 86_400 + 3_600)
    expect(old.stale).toBe(true)
    expect(old.asOf).toMatch(/^Last read \d+ [A-Z][a-z]{2}$/)
  })

  it("writes every amount with its unit", () => {
    expect(lockAmount("vemezo", 282_900_000n * unit)).toBe("282.9M MEZO")
    expect(lockAmount("vemezo", unit / 2n)).toBe("<1 MEZO")
    expect(lockAmount("vebtc", unit / 2n)).toBe("0.5000 BTC")
    expect(lockAmount("vebtc", 0n)).toBe("0.0000 BTC")
    // Never finer than 0.0001 BTC: no "0.00000200".
    expect(lockAmount("vebtc", 2_000_000_000_000n)).toBe("<0.0001 BTC")
    expect(lockAmount("vebtc", 228n * 10n ** 12n)).toBe("0.000228 BTC")
  })

  it("draws column amounts short", () => {
    expect(columnAmount("vebtc", 500_070n * 10n ** 15n)).toBe("500.07 BTC")
    expect(columnAmount("vebtc", 1_404_324n * 10n ** 15n)).toBe("1,404.32 BTC")
    expect(columnAmount("vebtc", 26n * 10n ** 16n)).toBe("0.26 BTC")
    expect(columnAmount("vebtc", 386n * 10n ** 15n)).toBe("0.386 BTC")
    expect(columnAmount("vebtc", 15n * 10n ** 14n)).toBe("0.0015 BTC")
    expect(columnAmount("vebtc", 10n ** 13n)).toBe("<0.0001 BTC")
    expect(columnAmount("vebtc", 99_999n * 10n ** 14n)).toBe("10.00 BTC")
    expect(columnAmount("vemezo", 35_930_000n * unit)).toBe("35.9M MEZO")
    expect(columnAmount("vemezo", 121_100_000n * unit)).toBe("121M MEZO")
    expect(columnAmount("vemezo", 4_570_000n * unit)).toBe("4.57M MEZO")
    expect(columnAmount("vemezo", 897_200n * unit)).toBe("897k MEZO")
    expect(columnAmount("vemezo", 195n * unit)).toBe("195 MEZO")
  })

  it("keeps BTC token ids priced", () => {
    expect(btcToken).toMatch(/^0x7b7c/)
  })
})
