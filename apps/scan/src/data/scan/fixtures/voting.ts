import { crossChainPools, MORPHO_MARKETS } from "@matchbox/chain"
import type {
  GaugeCard,
  GaugeDetails,
  GaugeDirectory,
} from "@matchbox/contracts/read-models"
import {
  demoGaugeCards,
  demoGaugeDetails,
  demoGaugeDirectory,
  demoGaugeProfile,
  demoKindCards,
  demoMeta,
  demoPrices,
} from "@matchbox/contracts/read-models/fixtures"
import type { ScanLockItem } from "@matchbox/contracts/scan"
import {
  scanDimensionMatches,
  scanMetricDefinition,
  scanSeriesMaxDays,
} from "@matchbox/contracts/scan"
import { knownTokens } from "../tokens"
import {
  aggregateMeta,
  badRequest,
  btcToken,
  currentEpoch,
  epochStart,
  epochZero,
  type FixtureRoute,
  type FixtureScenario,
  fakeAddress,
  fakeHash,
  fixtureNow,
  mezoToken,
  musdcToken,
  musdToken,
  ok,
  pageAnswer,
  units,
  vebtc,
  vemezo,
} from "./shared"
import {
  validatorCards,
  validatorDetails,
  validatorHistory,
  validatorLockVotes,
  validatorRanked,
} from "./validators"
import {
  allActivity,
  chainOnlyLock,
  escrowAddress,
  findLock,
  gauges,
  liveLockOf,
  locks,
  lockVotes,
  otherVoter,
  wallet,
} from "./world"

/**
 * The voting and locks routes: Pro's gauge documents (`/gauges`,
 * `/gauges/{g}`, the shared demo directory), gauge voters, incentives and
 * history, epochs and their rankings, locks and their votes, activity by
 * gauge, lock, epoch and action, `/series` for every registered metric and
 * `/prices`. Epoch 47 is the current epoch, as in the demo data.
 */

const epochs = Array.from({ length: 8 }, (_, index) => currentEpoch - index)

/** The demo gauges of the other kinds (pools, validators, MEZO gauges). */
const kindGauges = {
  northfieldNodes: demoKindCards.northfieldNodes.gauge.address.toLowerCase(),
  btcMusdCl: demoKindCards.btcMusdCl.gauge.address.toLowerCase(),
  smusd: demoKindCards.smusd.gauge.address.toLowerCase(),
}

const sealedBefore = currentEpoch
const isSealed = (number: number) => number < sealedBefore

function epochItem(number: number, scenario: FixtureScenario) {
  const scale = BigInt(number - 30)
  return {
    epoch_start: epochStart(number),
    emission: units(String(2_000_000 - (number - 40) * 12_000)),
    rebase: units(String(80_000 + (number - 40) * 900)),
    gauge_rewards: units(String(1_400_000 - (number - 40) * 8_000)),
    total_supply: units(String(5_400_000_000 + number * 2_000_000)),
    vote_transactions: 180 + number * 3,
    voters: 120 + number * 2,
    vote_weight: {
      BOOST_VOTER: ((BigInt(units("282900000")) * scale) / 17n).toString(),
      POOLS_VOTER: ((BigInt(units("128.3")) * scale) / 17n).toString(),
      // Northfield Nodes and Harbor Stake (validators.ts).
      VALIDATORS_VOTER: ((BigInt(units("124")) * scale) / 17n).toString(),
    },
    gauges: 8,
    incentives: {
      [mezoToken]: units(String(18_000 + number * 120)),
      [musdToken]: units(String(2_400 + number * 10)),
    },
    fees: { [musdToken]: units(String(310 + number)) },
    top_gauge: {
      BOOST_VOTER: gauges.kilnLabs,
      POOLS_VOTER: kindGauges.btcMusdCl,
      VALIDATORS_VOTER: kindGauges.northfieldNodes,
    },
    updated_at: fixtureNow - 600,
    sealed: isSealed(number),
    complete: !(scenario === "filling" && number === currentEpoch),
  }
}

type Ranked = {
  gauge: string
  weight: string
  voters: number
  incentive: string
  source?: string
  pool?: string
}

const rankedGauges: Ranked[] = [
  {
    gauge: gauges.kilnLabs,
    weight: "5880000",
    voters: 41,
    incentive: "6413.04",
  },
  { gauge: gauges.northgate, weight: "3410000", voters: 28, incentive: "2500" },
  {
    gauge: gauges.hearthCapital,
    weight: "2950000",
    voters: 22,
    incentive: "1800",
  },
  {
    gauge: gauges.satsCollective,
    weight: "1620000",
    voters: 17,
    incentive: "950",
  },
  {
    gauge: kindGauges.btcMusdCl,
    weight: "88.1",
    voters: 284,
    incentive: "910",
    source: "POOLS_VOTER",
    pool: demoGaugeDetails.btcMusdCl.pool.toLowerCase(),
  },
  {
    gauge: kindGauges.smusd,
    weight: "40.2",
    voters: 41,
    incentive: "0",
    source: "POOLS_VOTER",
    pool: demoGaugeDetails.smusd.pool.toLowerCase(),
  },
  {
    gauge: kindGauges.northfieldNodes,
    weight: "96.4",
    voters: 12,
    incentive: "3478.26",
    source: "VALIDATORS_VOTER",
  },
  validatorRanked,
]

const voterOfSource = {
  BOOST_VOTER: "boost",
  POOLS_VOTER: "pools",
  VALIDATORS_VOTER: "validators",
} as const

/** The voter a fixture gauge is on; gauges not ranked here are validators'. */
export function fixtureGaugeVoter(
  gauge: string,
): (typeof voterOfSource)[keyof typeof voterOfSource] {
  const row = rankedGauges.find(
    (candidate) => candidate.gauge.toLowerCase() === gauge.toLowerCase(),
  )
  if (row === undefined) return "validators"
  const source = (row.source ?? "BOOST_VOTER") as keyof typeof voterOfSource
  return voterOfSource[source] ?? "validators"
}

/** Indexes into rankedGauges for one voter source, rank 1 first. */
function rankedFor(source: string): number[] {
  return rankedGauges
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => (row.source ?? "BOOST_VOTER") === source)
    .map(({ index }) => index)
}

function gaugeEpochItem(number: number, index: number) {
  const row = rankedGauges[index] ?? rankedGauges[0]
  const drift = BigInt(100 - (currentEpoch - number) * 4)
  const source = row?.source ?? "BOOST_VOTER"
  return {
    epoch_start: epochStart(number),
    gauge: row?.gauge ?? gauges.kilnLabs,
    source,
    pool: row?.pool ?? null,
    vote_weight: (
      (BigInt(units(row?.weight ?? "0")) * drift) /
      100n
    ).toString(),
    voters: row?.voters ?? 0,
    incentives: { [mezoToken]: units(row?.incentive ?? "0") },
    fees: {},
    rank: rankedFor(source).indexOf(index) + 1,
    killed: 0 as const,
    updated_at: fixtureNow - 600,
  }
}

let depositSeq = 0
function deposit(
  number: number,
  gauge: string,
  amount: string,
  token = mezoToken,
  source = "BOOST_VOTER",
) {
  depositSeq += 1
  return {
    tx_hash: fakeHash(`d${depositSeq.toString(16)}`),
    log_index: 0,
    block_number: 12_800_000 + depositSeq * 2_000,
    timestamp: epochStart(number) + 900 + depositSeq,
    epoch_start: epochStart(number),
    tx_from: otherVoter,
    reward_contract: gauge,
    reward_type: "Bribe" as const,
    voter_source: source,
    gauge,
    pool: null,
    token,
    amount: units(amount),
    depositor: otherVoter,
  }
}

const validatorIndexes = rankedFor("VALIDATORS_VOTER")

const deposits = [
  ...epochs.flatMap((number) => [
    deposit(number, gauges.kilnLabs, "6413.04"),
    deposit(number, gauges.northgate, "2500"),
    deposit(number, gauges.northgate, "342", musdToken),
  ]),
  // The deposits behind each validator gauge's epoch incentives.
  ...epochs.flatMap((number) =>
    validatorIndexes.flatMap((index) => {
      const row = rankedGauges[index]
      return row === undefined || row.incentive === "0"
        ? []
        : [
            deposit(
              number,
              row.gauge,
              row.incentive,
              mezoToken,
              "VALIDATORS_VOTER",
            ),
          ]
    }),
  ),
]

/** The veBTC votes behind each validator gauge's epoch rows. */
const gaugeVotes = [
  ...lockVotes,
  ...epochs.flatMap((number) =>
    validatorIndexes.flatMap((index, rank) =>
      validatorLockVotes(gaugeEpochItem(number, index), 900 + rank * 20),
    ),
  ),
]

/** Validator gauges' profile history, from the same epoch rows. */
function historyFor(gauge: string, card: GaugeCard) {
  const index = validatorIndexes.find(
    (each) => rankedGauges[each]?.gauge === gauge,
  )
  if (index === undefined) return null
  return validatorHistory(
    epochs.map((number) => gaugeEpochItem(number, index)),
    card,
  )
}

/**
 * Production holds about 780 gauges, nearly all veBTC lock gauges with
 * few votes and no incentives: rendered whole they made /gauges a 2.8 MB
 * page. The directory carries as many, after the demo gauges and below
 * their votes, so paging and the HTML budget are tested at that size.
 */
export const crowdSize = 760

const crowd: GaugeCard[] = Array.from({ length: crowdSize }, (_, index) => {
  const template = demoGaugeCards.vebtc388
  const id = String(7000 + index)
  return {
    ...template,
    gauge: {
      ...template.gauge,
      address: fakeAddress(`c0${(index + 1).toString(16).padStart(4, "0")}`),
      name: `veBTC #${id}`,
      vebtcTokenId: id,
      picture: { type: "initials", text: "VB" },
    },
    tagline: null,
    apy: null,
    incentives: { usd: "0", tokens: [] },
    votes: String(9000 - index * 11),
    optimalVotes: null,
    boost: null,
    vebtcWeight: "0.0100",
  }
})

/**
 * Pro's directory with one demo gauge of every other kind added, the
 * validators pages' two validators (validators.ts), and the crowd.
 */
const kindCards: GaugeCard[] = [
  ...Object.values(demoKindCards),
  ...Object.values(validatorCards),
]
const directory: GaugeDirectory = {
  ...demoGaugeDirectory,
  gauges: [...demoGaugeDirectory.gauges, ...kindCards, ...crowd],
  total: demoGaugeDirectory.gauges.length + kindCards.length + crowdSize,
  kinds: {
    vebtc: demoGaugeDirectory.gauges.length + crowdSize,
    validator: kindCards.filter((card) => card.gauge.kind === "validator")
      .length,
    pool: kindCards.filter((card) => card.gauge.kind === "pool").length,
    mezo: kindCards.filter((card) => card.gauge.kind === "mezo").length,
  },
}

const kindDetails: Record<string, GaugeDetails> = {
  [kindGauges.northfieldNodes]: demoGaugeDetails.northfieldNodes,
  [kindGauges.btcMusdCl]: demoGaugeDetails.btcMusdCl,
  [kindGauges.smusd]: demoGaugeDetails.smusd,
  [demoKindCards.aerodromeMezoMusd.gauge.address.toLowerCase()]:
    demoGaugeDetails.aerodromeMezoMusd,
  [validatorCards.harborStake.gauge.address]: validatorDetails.harborStake,
  [validatorCards.tallow.gauge.address]: validatorDetails.tallow,
}

function profileFor(gauge: string) {
  const card = directory.gauges.find(
    (each) => each.gauge.address.toLowerCase() === gauge,
  )
  if (card === undefined) return null
  if (gauge === gauges.kilnLabs) return demoGaugeProfile
  const history = historyFor(gauge, card)
  return {
    ...demoGaugeProfile,
    card,
    description: null,
    tags: [],
    links: [],
    owner: card.meta?.kind === "vebtc" ? card.meta.owner : null,
    locked: null,
    apyChange: null,
    history: history ?? [],
    // Kiln Labs' own histories do not belong to a validator gauge.
    ...(history === null ? {} : { votesHistory: [], incentivesHistory: [] }),
    details: kindDetails[gauge] ?? null,
  }
}

// -- series ---------------------------------------------------------------

const day = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)
const dayToSeconds = (text: string) =>
  Math.floor(Date.parse(`${text}T00:00:00Z`) / 1000)
const today = day(fixtureNow)
const firstDay = day(epochZero)
const backfillEnd = "2026-10-31"

/** A small deterministic number from a string. */
function seed(text: string): number {
  let value = 7
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) % 9973
  return value
}

/**
 * A market series' token: BTC (the collateral) for collateral series, else
 * the market's loan token (mUSDC for BTC / mUSDC, MUSD for BTC / MUSD).
 */
function marketToken(metric: string, market: string): string | null {
  const known = [
    MORPHO_MARKETS.mainnet.btcMusdc,
    MORPHO_MARKETS.mainnet.btcMusd,
  ]
  // A market the API has no row for resolves no token.
  if (!known.includes(market as (typeof known)[number])) return null
  if (metric.includes("collateral")) return btcToken
  return market === MORPHO_MARKETS.mainnet.btcMusdc ? musdcToken : musdToken
}

/**
 * Series the jobs side has never written while the aggregates fill, as the
 * live API answers one: no points, and no first, last or end day.
 */
const uncomputedWhileFilling = new Set(["chain.active_addresses"])

/** A pool's fee tier from the cross-chain catalog, 30 bps when unset. */
function poolFeeBps(pool: string): number {
  return (
    crossChainPools.find((each) => each.address.toLowerCase() === pool)
      ?.feeBps ?? 30
  )
}

/**
 * A series' meta as the API sends it: the copy's last ok run and whether
 * it lags (the delayed scenario: failing runs or a halted table).
 */
function seriesMeta(scenario: FixtureScenario, complete: boolean) {
  return { ...aggregateMeta(scenario, complete), stale: scenario === "delayed" }
}

function seriesAnswer(query: URLSearchParams, scenario: FixtureScenario) {
  const metric = query.get("metric") ?? ""
  const dimension = query.get("dimension") ?? ""
  const from = query.get("from")
  const to = query.get("to")
  const definition = scanMetricDefinition(metric)
  if (
    definition === null ||
    from === null ||
    to === null ||
    !scanDimensionMatches(definition.dimension, dimension)
  ) {
    return badRequest
  }
  const start = dayToSeconds(from)
  const end = dayToSeconds(to)
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    end < start ||
    (end - start) / 86_400 > scanSeriesMaxDays
  ) {
    return badRequest
  }
  if (scenario === "filling" && uncomputedWhileFilling.has(metric)) {
    return ok({
      data: {
        metric,
        dimension,
        from,
        to,
        unit: definition.unit,
        decimals: definition.decimals,
        kind: definition.kind,
        signed: definition.signed,
        points: [],
        firstDay: null,
        lastDay: null,
        endsOn: null,
      },
      meta: seriesMeta(scenario, false),
    })
  }
  const lastDay = definition.liveWriter ? today : backfillEnd
  // The dimension's token, as the API resolves it for "token" decimals:
  // a market's loan token (its collateral for collateral metrics), else the
  // address in the dimension; none for a total across tokens.
  const tokenAddress =
    definition.decimals !== "token"
      ? null
      : definition.dimension === "market"
        ? dimension === ""
          ? null
          : marketToken(metric, dimension)
        : (dimension.split(":")[
            definition.dimension === "pool-token" ? 1 : 0
          ] ??
            null) ||
          null
  const resolved =
    tokenAddress === null ? null : (knownTokens[tokenAddress] ?? null)
  const decimals =
    definition.decimals === "token"
      ? (resolved?.decimals ?? 18)
      : (definition.decimals ?? 0)
  const base = BigInt(10) ** BigInt(Math.max(0, decimals))
  // A pool's fees are its swap volume at its fee tier, so the two agree.
  const source = metric === "dex.fees" ? "dex.volume_in" : metric
  const magnitude = BigInt(40 + (seed(source + dimension) % 900))
  const poolFee =
    metric === "dex.fees"
      ? BigInt(poolFeeBps(dimension.split(":")[0] ?? ""))
      : null
  // A pool's BTC side, a market's and the troves' BTC collateral in
  // BTC-sized amounts (the rest are dollars or MEZO).
  const btcSide =
    ((definition.dimension === "pool-token" ||
      definition.dimension === "market") &&
      tokenAddress === "0x7b7c000000000000000000000000000000000000") ||
    metric === "musd.trove_coll"
  const points: { day: string; value: string; partial: boolean }[] = []
  for (
    let at = Math.max(start, dayToSeconds(firstDay));
    at <= Math.min(end, dayToSeconds(lastDay));
    at += 86_400
  ) {
    const index = BigInt(Math.floor((at - epochZero) / 86_400))
    const wave = BigInt(seed(`${source}${index}`) % 60)
    // The daily head reads: a read about 1,700s into each day (a little
    // later every few days), about 3.8s a block between reads.
    const readAt = BigInt(at + 1_700 + Number(wave) * 30)
    if (
      metric === "chain.block_height_time" ||
      metric === "chain.block_height"
    ) {
      const value =
        metric === "chain.block_height_time"
          ? readAt
          : 12_000_000n + ((readAt - BigInt(epochZero)) * 10n) / 38n
      const text = day(at)
      points.push({
        day: text,
        value: value.toString(),
        partial: text === today,
      })
      continue
    }
    // No repayment yet today: a copy-step flow has no row for a day with
    // nothing to count.
    if (metric === "musd.repaid" && day(at) === today) continue
    let value =
      definition.kind === "level"
        ? magnitude * 100n + index * (magnitude / 4n + 1n) + wave
        : magnitude + wave
    if (definition.signed && seed(`${metric}${index}s`) % 3 === 0)
      value = -value
    const text = day(at)
    let units = value * base
    if (btcSide) units /= 10_000n
    // BTC chain fees to veBTC are a few thousandths of a BTC a day; the
    // MEZO rebase to veMEZO tens of thousands of MEZO.
    if (metric === "fees.chain_vebtc") units /= 100_000n
    if (metric === "emissions.rebase_distributed") units *= 100n
    if (poolFee !== null) units = (units * poolFee) / 10_000n
    points.push({
      day: text,
      value: units.toString(),
      partial: text === today && definition.liveWriter,
    })
  }
  return ok({
    data: {
      metric,
      dimension,
      from,
      to,
      unit: definition.unit,
      decimals: definition.decimals,
      kind: definition.kind,
      signed: definition.signed,
      points,
      firstDay,
      lastDay,
      endsOn: definition.liveWriter ? null : backfillEnd,
      ...(definition.decimals === "token"
        ? {
            resolvedDecimals: resolved?.decimals ?? null,
            token:
              tokenAddress === null
                ? null
                : { address: tokenAddress, symbol: resolved?.symbol ?? null },
          }
        : {}),
    },
    meta: seriesMeta(
      scenario,
      points.every((point) => !point.partial),
    ),
  })
}

function priceAnswer(
  token: string,
  query: URLSearchParams,
  scenario: FixtureScenario,
) {
  const from = query.get("from")
  const to = query.get("to")
  if (from === null || to === null) return badRequest
  // While the aggregates fill, as live when the daily prices began: today
  // is the only day there is.
  const first = scenario === "filling" ? today : firstDay
  const points: { day: string; price: string; partial: boolean }[] = []
  for (
    let at = Math.max(dayToSeconds(from), dayToSeconds(first));
    at <= Math.min(dayToSeconds(to), fixtureNow);
    at += 86_400
  ) {
    const index = Math.floor((at - epochZero) / 86_400)
    // Today's price is the shell's (the demo prices), so the header and
    // the pages agree; earlier days move around it.
    const latest = token === "btc" ? demoPrices.btc : demoPrices.mezo
    const price =
      day(at) === today && latest !== null
        ? latest.usd
        : token === "btc"
          ? `${98_000 + ((index * 137) % 9_000)}.00`
          : `0.${170 + (index % 19)}`
    points.push({ day: day(at), price, partial: day(at) === today })
  }
  return ok({
    data: { token, from, to, points, firstDay: first, lastDay: today },
  })
}

// -- routes ---------------------------------------------------------------

const address = "(0x[0-9a-f]{40})"
const escrowPattern = "(vebtc|vemezo|0x[0-9a-f]{40})"
const startPattern = "([0-9]+)"

function epochOf(text: string | undefined): number | null {
  const start = Number(text)
  if (!Number.isInteger(start) || (start - epochZero) % 604_800 !== 0)
    return null
  const number = (start - epochZero) / 604_800
  return number < 0 || number > currentEpoch ? null : number
}

/**
 * A veMEZO lock whose id is also a veBTC lock's (#604): ids overlap. And
 * a veBTC lock past its unlock date, never withdrawn (#77): the unlock
 * order lists it first.
 */
const extraLocks: ScanLockItem[] = [
  {
    escrow: vebtc,
    token_id: "77",
    owner: otherVoter,
    amount: units("0.2"),
    unlock_at: epochStart(46),
    created_at: epochStart(40) + 6_000,
    last_extended_at: null,
    withdrawn_at: null,
    is_permanent: false,
    is_withdrawn: false,
    is_merged: false,
    merged_into_token_id: null,
    merged_at: null,
    boost: null,
    activity_count: 0,
    updated_at: fixtureNow - 600,
  },
  {
    escrow: vemezo,
    token_id: "604",
    owner: otherVoter,
    amount: units("5200"),
    unlock_at: 1_830_211_200,
    created_at: epochStart(39) + 4_000,
    last_extended_at: null,
    withdrawn_at: null,
    is_permanent: false,
    is_withdrawn: false,
    is_merged: false,
    merged_into_token_id: null,
    merged_at: null,
    boost: null,
    activity_count: 0,
    updated_at: fixtureNow - 600,
  },
]

/** order=unlock: timed locks, then permanent ones, then no unlock time. */
function unlockRank(lock: ScanLockItem): number {
  if (lock.is_permanent) return 1
  return lock.unlock_at === null ? 2 : 0
}

function lockMatches(escrow: string | undefined, id: string | undefined) {
  if (escrow === undefined || id === undefined) return null
  const found = findLock(escrow, id)
  if (found !== null) return found
  const address =
    escrow === "vebtc" ? vebtc : escrow === "vemezo" ? vemezo : escrow
  return (
    [...extraLocks, chainOnlyLock].find(
      (each) => each.escrow === address && each.token_id === id,
    ) ?? null
  )
}

export const votingFixtures: FixtureRoute[] = [
  {
    pattern: /^gauges$/,
    answer: () => ok({ data: directory, meta: demoMeta }),
  },
  {
    pattern: new RegExp(`^gauges/${address}$`),
    answer: (match) => {
      const profile = profileFor(match[1] ?? "")
      return profile === null ? null : ok({ data: profile, meta: demoMeta })
    },
  },
  {
    pattern: new RegExp(`^gauges/${address}/voters$`),
    answer: (match, query) => {
      const epoch = Number(query.get("epoch") ?? epochStart(currentEpoch))
      const rest = new URLSearchParams(query)
      rest.delete("epoch")
      return pageAnswer(
        gaugeVotes
          .filter(
            (vote) => vote.gauge === match[1] && vote.epoch_start === epoch,
          )
          .sort((a, b) => (BigInt(b.weight) > BigInt(a.weight) ? 1 : -1)),
        rest,
      )
    },
  },
  {
    pattern: new RegExp(`^gauges/${address}/incentives$`),
    answer: (match, query) =>
      pageAnswer(
        deposits.filter((each) => each.gauge === match[1]),
        query,
      ),
  },
  {
    pattern: new RegExp(`^gauges/${address}/epochs$`),
    answer: (match, query, scenario) => {
      const index = rankedGauges.findIndex((row) => row.gauge === match[1])
      const rows =
        index < 0
          ? []
          : epochs.map((number) => ({
              ...gaugeEpochItem(number, index),
              complete: !(scenario === "filling" && number === currentEpoch),
            }))
      return pageAnswer(rows, query, { meta: aggregateMeta(scenario) })
    },
  },
  {
    pattern: new RegExp(`^depositors/${address}/incentives$`),
    answer: (match, query) =>
      pageAnswer(
        deposits.filter((each) => each.depositor === match[1]),
        query,
      ),
  },
  {
    pattern: /^epochs$/,
    answer: (_match, query, scenario) =>
      pageAnswer(
        epochs.map((number) => epochItem(number, scenario)),
        query,
        { meta: aggregateMeta(scenario) },
      ),
  },
  {
    pattern: new RegExp(`^epochs/${startPattern}$`),
    answer: (match, _query, scenario) => {
      const number = epochOf(match[1])
      if (number === null) return null
      if (scenario === "filling" && number === currentEpoch) {
        return ok({
          data: null,
          meta: { ...aggregateMeta(scenario), computed: false },
        })
      }
      if (!epochs.includes(number)) {
        return ok({
          data: null,
          meta: { ...aggregateMeta(scenario, false), computed: false },
        })
      }
      const epochDeposits = deposits.filter(
        (each) => each.epoch_start === epochStart(number),
      )
      return ok({
        data: {
          epoch: epochItem(number, scenario),
          topGauges: Object.fromEntries(
            ["BOOST_VOTER", "POOLS_VOTER", "VALIDATORS_VOTER"].map((source) => [
              source,
              rankedFor(source).map((index) => gaugeEpochItem(number, index)),
            ]),
          ),
          incentives: { data: epochDeposits, nextCursor: null },
        },
        meta: { ...aggregateMeta(scenario), computed: true },
      })
    },
  },
  {
    pattern: new RegExp(`^epochs/${startPattern}/gauges$`),
    answer: (match, query, scenario) => {
      const number = epochOf(match[1])
      if (number === null) return null
      const source = query.get("source") ?? "BOOST_VOTER"
      const rest = new URLSearchParams(query)
      rest.delete("source")
      // A new epoch before the aggregates run (live each Thursday): no
      // rows yet, and the meta says the aggregates are not complete.
      const uncomputed = scenario === "filling" && number === currentEpoch
      const rows =
        epochs.includes(number) && !uncomputed
          ? rankedFor(source).map((index) => gaugeEpochItem(number, index))
          : []
      return pageAnswer(rows, rest, { meta: aggregateMeta(scenario) })
    },
  },
  {
    pattern: new RegExp(`^epochs/${startPattern}/incentives$`),
    answer: (match, query) => {
      const number = epochOf(match[1])
      if (number === null) return null
      return pageAnswer(
        deposits.filter((each) => each.epoch_start === epochStart(number)),
        query,
      )
    },
  },
  {
    pattern: /^locks$/,
    answer: (_match, query) => {
      const escrow = query.get("escrow")
      const order = query.get("order") ?? "amount"
      if (escrow !== "vebtc" && escrow !== "vemezo") return badRequest
      const rest = new URLSearchParams(query)
      rest.delete("escrow")
      rest.delete("order")
      const live = (lock: ScanLockItem) => !lock.is_withdrawn && !lock.is_merged
      const rows = [...locks, ...extraLocks]
        .filter((lock) => lock.escrow === escrowAddress[escrow])
        .filter((lock) => order === "created" || live(lock))
      const sorted =
        order === "created"
          ? // Newest first, then locks with no creation time.
            rows.sort(
              (a, b) =>
                (a.created_at === null ? 1 : 0) -
                  (b.created_at === null ? 1 : 0) ||
                (b.created_at ?? 0) - (a.created_at ?? 0),
            )
          : order === "unlock"
            ? // Timed locks soonest first, then permanent, then no unlock.
              rows.sort(
                (a, b) =>
                  unlockRank(a) - unlockRank(b) ||
                  (a.unlock_at ?? 0) - (b.unlock_at ?? 0),
              )
            : rows.sort((a, b) =>
                BigInt(b.amount) > BigInt(a.amount) ? 1 : -1,
              )
      // One stored row of the veMEZO creation list failed its schema, so
      // the page says a row is not shown (meta.skipped).
      const skipped = escrow === "vemezo" && order === "created" ? 1 : 0
      return pageAnswer(sorted, rest, {}, skipped)
    },
  },
  {
    pattern: new RegExp(`^locks/${escrowPattern}/([0-9]+)$`),
    answer: (match) => {
      const found = lockMatches(match[1], match[2])
      // As the API answers: the row with the chain's figures, and whether
      // the store has the lock yet.
      return found === null
        ? null
        : ok({
            data: found,
            indexed: found !== chainOnlyLock,
            live: liveLockOf(found),
          })
    },
  },
  {
    pattern: new RegExp(`^locks/${escrowPattern}/([0-9]+)/votes$`),
    answer: (match, query) => {
      const found = lockMatches(match[1], match[2])
      if (found === null) return null
      return pageAnswer(
        lockVotes
          .filter(
            (vote) =>
              vote.escrow === found.escrow && vote.token_id === found.token_id,
          )
          .sort((a, b) => b.epoch_start - a.epoch_start),
        query,
      )
    },
  },
  {
    pattern: new RegExp(`^activity/gauge/${address}$`),
    answer: (match, query) =>
      pageAnswer(
        allActivity.filter((row) => row.gauge === match[1]),
        query,
      ),
  },
  {
    pattern: new RegExp(`^activity/lock/${escrowPattern}/([0-9]+)$`),
    answer: (match, query) => {
      const escrow =
        match[1] === "vebtc" ? vebtc : match[1] === "vemezo" ? vemezo : match[1]
      return pageAnswer(
        allActivity.filter(
          (row) => row.lock_escrow === escrow && row.token_id === match[2],
        ),
        query,
      )
    },
  },
  {
    pattern: new RegExp(`^activity/epoch/${startPattern}$`),
    answer: (match, query) =>
      epochOf(match[1]) === null
        ? null
        : pageAnswer(
            allActivity.filter((row) => row.epoch_start === Number(match[1])),
            query,
          ),
  },
  {
    pattern: /^activity\/action\/([a-z_]+)$/,
    answer: (match, query) =>
      pageAnswer(
        allActivity.filter((row) => row.action_type.toLowerCase() === match[1]),
        query,
      ),
  },
  {
    pattern: /^series$/,
    answer: (_match, query, scenario) => seriesAnswer(query, scenario),
  },
  {
    pattern: /^prices\/(btc|mezo)$/,
    answer: (match, query, scenario) =>
      priceAnswer(match[1] ?? "btc", query, scenario),
  },
]

/** For tests: the wallet that owns the fixture locks. */
export const fixtureVoter = wallet
