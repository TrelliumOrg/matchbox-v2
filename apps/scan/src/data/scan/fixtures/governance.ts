import type {
  ScanEpochSources,
  ScanGaugeAprPoint,
  ScanGaugeEmissionRow,
  ScanLockDistribution,
  ScanLockEscrow,
  ScanVoterEpoch,
} from "@matchbox/contracts/scan"
import {
  aggregateMeta,
  badRequest,
  btcToken,
  currentEpoch,
  epochStart,
  type FixtureRoute,
  type FixtureScenario,
  fixtureNow,
  mezoToken,
  musdToken,
  ok,
  units,
} from "./shared"
import { fixtureGaugeVoter } from "./voting"

/**
 * The governance summary routes (apps/api README "Governance") in
 * fixtures mode: every voter's epochs, a gauge's emissions and APR, the
 * escrows' voting APR and their lock distribution, with the shapes and
 * the rough sizes production holds (veBTC about 789 BTC in 2,073 live
 * locks on 15 Nov 2026, veMEZO 283.8M MEZO in 1,871).
 */

const address = "(0x[0-9a-f]{40})"
const firstEpoch = currentEpoch - 25

/** A deterministic wobble in [0, 1) from a number and a salt. */
function wobble(n: number, salt: number): number {
  const x = Math.sin(n * 12.9898 + salt * 78.233) * 43_758.5453
  return x - Math.floor(x)
}

function scaledUnits(base: number, epoch: number, salt: number): string {
  return units((base * (0.75 + wobble(epoch, salt) * 0.5)).toFixed(4))
}

const epochs = Array.from(
  { length: currentEpoch - firstEpoch + 1 },
  (_, index) => firstEpoch + index,
)

function sourceRows(scenario: FixtureScenario): ScanEpochSources {
  const data = epochs.flatMap((epoch) => {
    const start = epochStart(epoch)
    const running = epoch === currentEpoch
    const part = running ? 0.55 : 1
    const row = (
      source: string,
      emissions: number,
      incentives: Record<string, string>,
      fees: Record<string, string>,
      weight: number,
      gauges: number,
    ) => ({
      epoch_start: start,
      source,
      // The copied DistributeReward history starts a few epochs in.
      emissions:
        epoch < firstEpoch + 3
          ? null
          : scaledUnits(emissions, epoch, source.length),
      incentives,
      fees,
      vote_weight: scaledUnits(weight, epoch, 7),
      gauges,
      emission_gauges: running ? 0 : gauges,
      updated_at: fixtureNow,
      complete: scenario !== "filling" || !running,
    })
    return [
      row(
        "BOOST_VOTER",
        0,
        { [mezoToken]: scaledUnits(1_400_000 * part, epoch, 1) },
        {},
        5_200_000,
        46,
      ),
      row(
        "POOLS_VOTER",
        880_000,
        { [musdToken]: scaledUnits(6_200 * part, epoch, 2) },
        {
          [musdToken]: scaledUnits(2_100 * part, epoch, 3),
          [btcToken]: scaledUnits(0.012 * part, epoch, 4),
        },
        280,
        5,
      ),
      row(
        "THIRD_PARTY_VOTER",
        90_000,
        { [mezoToken]: scaledUnits(110_000 * part, epoch, 5) },
        {},
        1_100_000,
        3,
      ),
      row(
        "VALIDATORS_VOTER",
        930_000,
        { [mezoToken]: scaledUnits(560_000 * part, epoch, 6) },
        {},
        820,
        21,
      ),
    ]
  })
  return {
    data,
    meta: aggregateMeta(scenario, scenario !== "filling"),
  }
}

function gaugeEmissions(gauge: string): ScanGaugeEmissionRow[] {
  const salt = Number.parseInt(gauge.slice(-4), 16) % 97
  return epochs
    .filter((epoch) => epoch >= firstEpoch + 4)
    .map((epoch) => ({
      gauge,
      epoch_start: epochStart(epoch),
      source: "VALIDATORS_VOTER",
      amount: scaledUnits(62_000, epoch, salt),
      events: 1,
      updated_at: fixtureNow,
    }))
    .reverse()
}

const voterBase = {
  pools: 4.1,
  validators: 2.6,
  boost: 11.4,
  "third-party": 6.2,
} as const

function percent(value: number): string {
  return value.toFixed(2)
}

/** Each voter's rows, then each escrow's: its voters' APRs added up. */
function aprRows(): ScanVoterEpoch[] {
  return epochs
    .filter((epoch) => epoch >= firstEpoch + 13)
    .flatMap((epoch) => {
      const kinds = Object.entries(voterBase).map(([voter, base], index) => ({
        epoch_start: epochStart(epoch),
        voter: voter as ScanVoterEpoch["voter"],
        total_usd: (base * 160 * (0.8 + wobble(epoch, index) * 0.4)).toFixed(2),
        weight: units("1000"),
        voting_token_usd: ["pools", "validators"].includes(voter)
          ? "98000"
          : "0.0041",
        apr_percent: percent(base * (0.8 + wobble(epoch, index) * 0.4)),
        funded_gauges: 3 + index,
        unpriced_rewards: 0,
        open: epoch === currentEpoch,
        updated_at: fixtureNow,
      }))
      const escrow = (
        voter: "vebtc" | "vemezo",
        parts: readonly ScanVoterEpoch["voter"][],
      ): ScanVoterEpoch => {
        const rows = kinds.filter((row) => parts.includes(row.voter))
        const cents = (field: (row: ScanVoterEpoch) => string | null) =>
          rows.reduce(
            (sum, row) => sum + Math.round(Number(field(row) ?? "0") * 100),
            0,
          )
        return {
          ...(rows[0] as ScanVoterEpoch),
          voter,
          total_usd: (cents((row) => row.total_usd) / 100).toFixed(2),
          weight: units("2000"),
          apr_percent: (cents((row) => row.apr_percent) / 100).toFixed(2),
          funded_gauges: rows.reduce((sum, row) => sum + row.funded_gauges, 0),
        }
      }
      return [
        ...kinds,
        escrow("vebtc", ["pools", "validators"]),
        escrow("vemezo", ["boost", "third-party"]),
      ]
    })
}

function gaugeApr(gauge: string): ScanGaugeAprPoint[] {
  const salt = Number.parseInt(gauge.slice(-4), 16) % 89
  return epochs
    .filter((epoch) => epoch >= firstEpoch + 13)
    .map((epoch, index) => ({
      epoch_start: epochStart(epoch),
      voter: fixtureGaugeVoter(gauge),
      weight: units("40"),
      total_usd: "1180.00",
      apr_percent: percent(3.5 - index * 0.08 + wobble(epoch, salt) * 0.3),
      unpriced_rewards: 0,
    }))
}

const week = 7 * 86_400

function lockDoc(
  escrow: ScanLockEscrow,
  daysBack: number,
): ScanLockDistribution {
  const readAt = fixtureNow - daysBack * 86_400
  const day = new Date(readAt * 1000).toISOString().slice(0, 10)
  const growth = 1 - daysBack / 400
  const btc = escrow === "vebtc"
  const amount = (value: number) => units((value * growth).toFixed(btc ? 6 : 0))
  const group = (count: number, value: number, power = value) => ({
    count: Math.round(count * growth),
    amount: amount(value),
    voting_power: amount(power),
  })
  // Unlock ends sit on epoch boundaries (Thursday 00:00 UTC).
  const nextEnd = epochStart(currentEpoch + 1)
  const unlocks = btc
    ? [
        { at: nextEnd, count: 7, amount: amount(5.38) },
        { at: nextEnd + week, count: 2, amount: amount(0.0015) },
        { at: nextEnd + 2 * week, count: 2, amount: amount(500.07) },
        { at: nextEnd + 3 * week, count: 5, amount: amount(1.12) },
      ]
    : Array.from({ length: 60 }, (_, index) => ({
        at: nextEnd + index * 3 * week,
        count: 3 + Math.round(wobble(index, 3) * 20),
        amount: amount(200_000 + wobble(index, 9) * 4_000_000),
      }))
  const timedTotal = unlocks.reduce(
    (all, entry) => all + BigInt(entry.amount),
    0n,
  )
  const permanent = btc ? group(456, 282.34, 1389.05) : group(169, 36_717_681)
  const expired = btc ? group(1601, 0.386, 0) : group(898, 121_060_588, 0)
  const timed = {
    count: unlocks.reduce((all, entry) => all + entry.count, 0),
    amount: timedTotal.toString(),
    voting_power: (timedTotal / 2n).toString(),
  }
  const live = {
    count: permanent.count + timed.count + expired.count,
    amount: (
      BigInt(permanent.amount) +
      timedTotal +
      BigInt(expired.amount)
    ).toString(),
    voting_power: (
      BigInt(permanent.voting_power) + BigInt(timed.voting_power)
    ).toString(),
  }
  const edges = btc
    ? ["0", units("0.01"), units("0.1"), units("1"), units("10")]
    : ["0", units("1000"), units("10000"), units("100000"), units("1000000")]
  const sizes = btc
    ? [
        [2009, 0.26],
        [39, 1.21],
        [17, 4.95],
        [5, 22.64],
        [3, 760.24],
      ]
    : [
        [1273, 201_695],
        [260, 897_212],
        [174, 6_293_597],
        [125, 41_600_395],
        [39, 234_775_554],
      ]
  const spans = btc
    ? [week, 2 * week, 3 * week, 4 * week]
    : [52 * week, 104 * week, 156 * week, 208 * week]
  const remaining = btc
    ? [
        [7, 5.38],
        [2, 0.0015],
        [2, 500.07],
        [5, 1.12],
      ]
    : [
        [173, 35_934_484],
        [19, 4_570_177],
        [93, 60_438_292],
        [519, 25_047_231],
      ]
  return {
    escrow,
    day,
    block: 13_201_553 - daysBack * 22_700,
    read_at: readAt,
    max_lock_seconds: btc ? 4 * week : 208 * week,
    ids_read: btc ? 6_180 : 2_947,
    supply: live.amount,
    live,
    permanent,
    timed,
    expired,
    largest: amount(btc ? 500.07 : 115_000_000),
    median: amount(btc ? 0.0000019 : 195),
    mean_remaining_seconds: btc ? 1_527_231 : 62_935_941,
    by_size: sizes.map(([count = 0, value = 0], index) => ({
      ...group(count, value),
      min: edges[index] ?? "0",
      max: edges[index + 1] ?? null,
    })),
    by_remaining: remaining.map(([count = 0, value = 0], index) => ({
      ...group(count, value, value / 2),
      min_seconds: index === 0 ? 0 : (spans[index - 1] ?? 0),
      max_seconds: spans[index] ?? 0,
    })),
    unlocks,
  }
}

function lockDistribution(escrow: string | null) {
  if (escrow !== "vebtc" && escrow !== "vemezo") return badRequest
  const latest = lockDoc(escrow, 0)
  return ok({
    data: {
      latest,
      ago30: lockDoc(escrow, 30),
      ago90: lockDoc(escrow, 90),
      history: [90, 60, 30, 0].map((back) => {
        const doc = lockDoc(escrow, back)
        return {
          day: doc.day,
          live: doc.live,
          permanent: doc.permanent,
          timed: doc.timed,
        }
      }),
    },
  })
}

/** The fixtures' governance routes. */
export const governanceFixtures: FixtureRoute[] = [
  {
    pattern: /^epoch-sources$/,
    answer: (_match, _query, scenario) => ok(sourceRows(scenario)),
  },
  {
    pattern: /^epoch-emissions\/([0-9]+)$/,
    answer: (match, query, scenario) => {
      const source = query.get("source")
      if (source === null) return badRequest
      const start = Number(match[1])
      const rows = sourceRows(scenario).data.filter(
        (row) => row.epoch_start === start && row.source === source,
      )
      return ok({
        data: rows.flatMap((row) =>
          row.emissions === null
            ? []
            : [
                {
                  gauge: `0x${"4a5b0e".padStart(40, "0")}`,
                  epoch_start: row.epoch_start,
                  source: row.source,
                  amount: row.emissions,
                  events: 1,
                  updated_at: fixtureNow,
                },
              ],
        ),
        meta: aggregateMeta(scenario),
      })
    },
  },
  {
    pattern: new RegExp(`^gauges/${address}/emissions$`),
    answer: (match, _query, scenario) =>
      ok({
        data: gaugeEmissions(match[1] ?? ""),
        meta: aggregateMeta(scenario),
      }),
  },
  {
    pattern: new RegExp(`^gauges/${address}/apr$`),
    answer: (match) => ok({ data: gaugeApr(match[1] ?? "") }),
  },
  {
    pattern: /^apr$/,
    answer: () => ok({ data: aprRows() }),
  },
  {
    pattern: /^lock-distribution$/,
    answer: (_match, query) => lockDistribution(query.get("escrow")),
  },
]
