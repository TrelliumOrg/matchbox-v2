import { bridgedAssets, crossChainPools } from "@matchbox/chain"
import {
  demoGauges,
  demoPrices,
} from "@matchbox/contracts/read-models/fixtures"
import type {
  ScanAssetPrice,
  ScanBridgedAsset,
  ScanBridgeFlows,
  ScanCrossChainPool,
} from "@matchbox/contracts/scan"
import {
  type FixtureRoute,
  type FixtureScenario,
  fakeAddress,
  fixtureNow,
  ok,
  units,
} from "./shared"

/**
 * `/crosschain/*`: MUSD and MEZO on Mezo, Ethereum, Base and BNB Chain
 * (apps/api `scan/crosschain.ts`), with the figures the jobs Worker's dry
 * run read on 12 Nov 2026 (PR #22), moved to the fixtures' now. Scenarios:
 * `filling` answers as the API does over empty tables (the state in
 * production until the job runs: every figure null with its reason),
 * `delayed` has every reading older than the API's 10 minute line.
 */

const day = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)
const today = day(fixtureNow)
const daysAgo = (count: number) => day(fixtureNow - count * 86_400)

function readAt(scenario: FixtureScenario, secondsAgo: number): number {
  return scenario === "delayed"
    ? fixtureNow - 45 * 60 - secondsAgo
    : fixtureNow - secondsAgo
}

// -- prices -----------------------------------------------------------------

const musdVenues = [
  {
    venue: "aero-musd-usdc",
    label: "Aerodrome MUSD/USDC",
    chain: "base",
    pool: "0xb02fda984eddff593202ed2b5a6de043b9b62ea5",
    price_usd: "0.993524",
    depth_usd: "820412.55",
    method: "30-minute TWAP",
    ago: 70,
  },
  {
    venue: "curve-musd-2pool",
    label: "Curve MUSD/2pool",
    chain: "ethereum",
    pool: "0xb5571e76693ba60110b5811dd650ffefce1c955f",
    price_usd: "0.993611",
    depth_usd: "3340118.02",
    method: "get_dy x 2pool virtual price",
    ago: 64,
  },
  {
    venue: "tigris-musdc-musd",
    label: "Tigris mUSDC/MUSD",
    chain: "mezo",
    pool: "0xcc372b7e15535ab225fe17c1075831d38ef7ac1a",
    price_usd: "0.99412",
    depth_usd: "258077.9",
    method: "30-minute TWAP",
    ago: 66,
  },
] as const

function poolUrl(address: string): string {
  return (
    crossChainPools.find((pool) => pool.address === address)?.url ??
    "https://www.geckoterminal.com"
  )
}

function musdPrice(scenario: FixtureScenario): ScanAssetPrice {
  if (scenario === "filling") {
    return {
      asset: "musd",
      price_usd: null,
      basis: null,
      basis_label: null,
      read_at: null,
      stale: true,
      venues: [],
      spread_bps: null,
      diverged: false,
      unavailable: { price_usd: "No MUSD reading stored yet" },
    }
  }
  const stale = scenario === "delayed"
  return {
    asset: "musd",
    price_usd: "0.993611",
    basis: "venues",
    basis_label: "Liquidity-weighted median of 3 venues",
    read_at: readAt(scenario, 60),
    stale,
    venues: musdVenues.map(({ ago, ...venue }) => ({
      ...venue,
      url: poolUrl(venue.pool),
      read_at: readAt(scenario, ago),
      block: null,
      stale,
    })),
    spread_bps: 6,
    diverged: false,
    unavailable: {},
  }
}

function mezoPrice(scenario: FixtureScenario): ScanAssetPrice {
  const unavailable: Record<string, string> = {
    venues:
      "MEZO trades mostly on exchanges: CoinGecko's aggregate is the price",
    spread_bps: "One source",
  }
  if (scenario === "filling") {
    return {
      asset: "mezo",
      price_usd: null,
      basis: null,
      basis_label: null,
      read_at: null,
      stale: true,
      venues: [],
      spread_bps: null,
      diverged: false,
      unavailable: {
        ...unavailable,
        price_usd: "No MEZO price in the last 10 minutes",
      },
    }
  }
  // The source the fixture world's shell price names (demoPrices), as the
  // API reads MEZO's price from the same KV entry.
  const coingecko = demoPrices.mezo?.source === "coingecko"
  return {
    asset: "mezo",
    price_usd: demoPrices.mezo?.usd ?? "0.184",
    basis: coingecko ? "coingecko" : "aerodrome-cl",
    basis_label: coingecko
      ? "CoinGecko"
      : "Aerodrome MEZO/MUSD on Base (thin fallback)",
    read_at: readAt(scenario, 120),
    stale: scenario === "delayed",
    venues: [],
    spread_bps: null,
    diverged: false,
    unavailable,
  }
}

export function pricesAnswer(scenario: FixtureScenario) {
  return {
    data: { musd: musdPrice(scenario), mezo: mezoPrice(scenario) },
    attribution: {
      coingecko: {
        text: "Price data by CoinGecko",
        url: "https://www.coingecko.com",
      },
    },
  }
}

const historyCloses = [
  ["0.99318", "0.993402", "0.99291", "0.99402"],
  ["0.99331", "0.993377", "0.99309", "0.99389"],
  ["0.99352", "0.993545", "0.99341", "0.99398"],
  ["0.993611", "0.993611", "0.993524", "0.99412"],
] as const

export function priceHistoryAnswer(scenario: FixtureScenario) {
  return {
    asset: "musd" as const,
    days:
      scenario === "filling"
        ? []
        : historyCloses.map(([headline, curve, aero, tigris], index) => ({
            day: daysAgo(historyCloses.length - 1 - index),
            price_usd: headline,
            venues: {
              "curve-musd-2pool": curve,
              "aero-musd-usdc": aero,
              "tigris-musdc-musd": tigris,
            },
          })),
  }
}

// -- supply -----------------------------------------------------------------

/** Each chain's total supply and the hub's lock, whole tokens. */
const supplies: Record<
  ScanBridgedAsset,
  Record<string, { total: string; locked?: string }>
> = {
  musd: {
    mezo: { total: "18986044.82", locked: "2841641.13" },
    ethereum: { total: "2619241.07" },
    base: { total: "214586.1" },
  },
  mezo: {
    mezo: { total: "1152651698.26", locked: "377146249.66" },
    ethereum: { total: "7764666.37" },
    base: { total: "369347487.3" },
    bsc: { total: "22230.65" },
  },
}

function assetSupply(asset: ScanBridgedAsset, scenario: FixtureScenario) {
  const deployments = bridgedAssets[asset].deployments
  if (scenario === "filling") {
    return {
      asset,
      decimals: 18,
      circulating: null,
      chains: [],
      history: [],
      unavailable: {
        ...Object.fromEntries(
          deployments.map((deployment) => [
            `chains.${deployment.chain}`,
            "No supply read yet",
          ]),
        ),
        circulating: "A chain's supply is missing",
      },
    }
  }
  const chains = deployments.map((deployment) => {
    const figures = supplies[asset][deployment.chain] ?? { total: "0" }
    const total = units(figures.total)
    const locked = figures.locked === undefined ? null : units(figures.locked)
    return {
      chain: deployment.chain,
      token: deployment.token,
      total_supply: total,
      locked,
      circulating:
        locked === null ? total : (BigInt(total) - BigInt(locked)).toString(),
      day: today,
      updated_at: readAt(scenario, 1_800),
    }
  })
  return {
    asset,
    decimals: 18,
    circulating: chains
      .reduce((sum, chain) => sum + BigInt(chain.circulating), 0n)
      .toString(),
    chains,
    history: [
      {
        day: today,
        chains: Object.fromEntries(
          chains.map((chain) => [chain.chain, chain.circulating]),
        ),
      },
    ],
    unavailable: {},
  }
}

export function supplyAnswer(scenario: FixtureScenario) {
  return {
    data: {
      musd: assetSupply("musd", scenario),
      mezo: assetSupply("mezo", scenario),
    },
  }
}

// -- pools ------------------------------------------------------------------

type PoolFigures = Pick<
  ScanCrossChainPool,
  "tvl_usd" | "volume_24h_usd" | "volume_7d_usd" | "apr_7d" | "gauge"
> & {
  apr: Omit<ScanCrossChainPool["apr"], "total">
  sources: Record<string, string>
  unavailable: Record<string, string>
}

const noGauge = "No Matchbox gauge funds this pool"
const gaugeNotApr =
  "The MEZO a Matchbox gauge sends is not converted to an APR yet"
const aeroApr = "Aerodrome's new gauges revert on rewardRate; APR not available"

/** The dry run's figures per pool id; a pool not listed has none. */
const poolFigures: Record<string, PoolFigures> = {
  "ethereum-curve-musd-2pool": {
    tvl_usd: "3355432.18",
    volume_24h_usd: "65338.4",
    volume_7d_usd: null,
    apr_7d: null,
    apr: { fees: "0.27", rewards: "8.16", merkl: null, gauge: null },
    sources: {
      tvl_usd: "geckoterminal",
      volume_24h_usd: "curve",
      apr_fees: "defillama",
      apr_rewards: "defillama",
    },
    unavailable: {
      apr_merkl: "No live Merkl campaign",
      apr_gauge: gaugeNotApr,
      volume_7d_usd: "Fewer than 7 days stored",
      apr_7d: "Fewer than 7 days stored",
    },
    gauge: {
      address: fakeAddress("c9a1"),
      name: "Curve MUSD 2pool",
      matched_by: "metadata",
    },
  },
  "base-aerodrome-musd-usdc": {
    tvl_usd: "819244.6",
    volume_24h_usd: "51445.12",
    volume_7d_usd: null,
    apr_7d: null,
    apr: { fees: null, rewards: null, merkl: null, gauge: null },
    sources: { tvl_usd: "geckoterminal", volume_24h_usd: "geckoterminal" },
    unavailable: {
      apr_fees: aeroApr,
      apr_rewards: aeroApr,
      apr_merkl: "No live Merkl campaign",
      apr_gauge: gaugeNotApr,
    },
    gauge: {
      address: fakeAddress("c9a2"),
      name: "Aerodrome USDC/MUSD",
      matched_by: "metadata",
    },
  },
  "mezo-tigris-musdc-musd-cl": {
    tvl_usd: "214917.3",
    volume_24h_usd: "38074.9",
    volume_7d_usd: "251340.2",
    apr_7d: "3.4",
    apr: { fees: "3.23", rewards: "1.12", merkl: null, gauge: null },
    sources: {
      tvl_usd: "geckoterminal",
      volume_24h_usd: "geckoterminal",
      apr_fees: "estimate: 24h volume x fee / TVL",
      apr_rewards: "matchbox gauges (MEZO emissions to stakers)",
    },
    unavailable: {
      apr_merkl: "No live Merkl campaign",
      apr_gauge: noGauge,
    },
    gauge: {
      address: fakeAddress("c9a3"),
      name: "mUSDC/MUSD 0.05%",
      matched_by: "pool",
    },
  },
  "ethereum-uniswap-v4-usdc-musd": {
    tvl_usd: "56133.7",
    volume_24h_usd: "3944.2",
    volume_7d_usd: null,
    apr_7d: null,
    apr: { fees: "0.12", rewards: null, merkl: "72.66", gauge: null },
    sources: {
      tvl_usd: "geckoterminal",
      volume_24h_usd: "geckoterminal",
      apr_fees: "defillama",
      apr_merkl: "merkl (veMEZO)",
    },
    unavailable: {
      apr_rewards: "No venue rewards reported",
      apr_gauge: gaugeNotApr,
    },
    gauge: {
      address: fakeAddress("c9a4"),
      name: "Uniswap v4 USDC/MUSD",
      matched_by: "metadata",
    },
  },
  "mezo-tigris-musd-btc-cl": {
    tvl_usd: "34664.1",
    volume_24h_usd: "9062.5",
    volume_7d_usd: null,
    apr_7d: null,
    apr: { fees: "28.6", rewards: null, merkl: null, gauge: null },
    sources: {
      tvl_usd: "geckoterminal",
      volume_24h_usd: "geckoterminal",
      apr_fees: "estimate: 24h volume x fee / TVL",
    },
    unavailable: {
      apr_rewards: "No pool gauge emissions found",
      apr_merkl: "No live Merkl campaign",
      apr_gauge: noGauge,
    },
    gauge: null,
  },
  "mezo-tigris-musd-btc-classic": {
    tvl_usd: "70594.4",
    volume_24h_usd: "1041.3",
    volume_7d_usd: null,
    apr_7d: null,
    apr: { fees: null, rewards: null, merkl: null, gauge: null },
    sources: { tvl_usd: "geckoterminal", volume_24h_usd: "geckoterminal" },
    unavailable: {
      apr_fees: "Fee rate not tracked for this pool",
      apr_rewards: "No pool gauge emissions found",
      apr_merkl: "No live Merkl campaign",
      apr_gauge: noGauge,
    },
    gauge: null,
  },
  "mezo-savings-smusd": {
    tvl_usd: "1190220.5",
    volume_24h_usd: null,
    volume_7d_usd: null,
    apr_7d: null,
    apr: { fees: "14.54", rewards: null, merkl: null, gauge: null },
    sources: { tvl_usd: "defillama", apr_fees: "defillama (savings rate)" },
    unavailable: {
      volume_24h_usd: "A savings vault has no swap volume",
      apr_rewards: "No venue rewards reported",
      apr_merkl: "No live Merkl campaign",
      apr_gauge: noGauge,
    },
    gauge: null,
  },
  "base-aerodrome-mezo-musd": {
    tvl_usd: "4312.4",
    volume_24h_usd: "20350.1",
    volume_7d_usd: null,
    apr_7d: null,
    apr: { fees: null, rewards: null, merkl: null, gauge: null },
    sources: { tvl_usd: "geckoterminal", volume_24h_usd: "geckoterminal" },
    unavailable: {
      apr_fees: aeroApr,
      apr_rewards: aeroApr,
      apr_merkl: "No live Merkl campaign",
      apr_gauge: gaugeNotApr,
    },
    gauge: {
      address: fakeAddress("c9a5"),
      name: "Aerodrome MEZO/MUSD",
      matched_by: "metadata",
    },
  },
  "mezo-tigris-mezo-btc-cl": {
    tvl_usd: "2397.6",
    volume_24h_usd: "8810.2",
    volume_7d_usd: null,
    apr_7d: null,
    apr: { fees: "370.15", rewards: null, merkl: null, gauge: null },
    sources: {
      tvl_usd: "geckoterminal",
      volume_24h_usd: "geckoterminal",
      apr_fees: "estimate: 24h volume x fee / TVL",
    },
    unavailable: {
      apr_rewards: "No pool gauge emissions found",
      apr_merkl: "No live Merkl campaign",
      apr_gauge: noGauge,
    },
    gauge: null,
  },
  "base-aerodrome-mezo-musd-legacy": {
    tvl_usd: "1880.3",
    volume_24h_usd: "120.4",
    volume_7d_usd: null,
    apr_7d: null,
    apr: { fees: null, rewards: null, merkl: null, gauge: null },
    sources: { tvl_usd: "geckoterminal", volume_24h_usd: "geckoterminal" },
    unavailable: {
      apr_fees: aeroApr,
      apr_rewards: aeroApr,
      apr_merkl: "No live Merkl campaign",
      apr_gauge: gaugeNotApr,
    },
    gauge: {
      address: fakeAddress("c9a6"),
      name: "Aerodrome MEZO/MUSD CL200",
      matched_by: "curated",
    },
  },
}

/**
 * `partial`, as production on 12 Nov 2026: GeckoTerminal answers the jobs
 * Worker 429 for Mezo's pools, so the Tigris pools have no `pool_daily`
 * row, except one whose row has GeckoTerminal's figures missing. The API
 * still lists every catalog pool, and adds a Tigris pool's MEZO emission
 * rate and gauge from Pro's gauge documents, row or not. The savings
 * vault's liquidity comes from DefiLlama and stays.
 */
const partialRow = "mezo-tigris-musd-btc-cl"
const partialEmission = "mezo-tigris-musdc-musd-cl"

function partialFigures(id: string): PoolFigures | undefined {
  if (id === partialRow) {
    return {
      tvl_usd: null,
      volume_24h_usd: null,
      volume_7d_usd: null,
      apr_7d: null,
      apr: { fees: null, rewards: null, merkl: null, gauge: null },
      sources: {},
      unavailable: {
        tvl_usd: "No source lists this pool's TVL",
        volume_24h_usd: "Volume source unavailable this run",
        apr_fees: "No volume or TVL to estimate from",
        apr_rewards: "No pool gauge emissions found",
        apr_merkl: "No live Merkl campaign",
        apr_gauge: noGauge,
      },
      gauge: null,
    }
  }
  return undefined
}

function poolAnswer(
  pool: (typeof crossChainPools)[number],
  scenario: FixtureScenario,
): ScanCrossChainPool {
  const offMezo = scenario === "partial" && pool.venue === "tigris"
  const figures =
    scenario === "filling"
      ? undefined
      : offMezo
        ? partialFigures(pool.id)
        : poolFigures[pool.id]
  const emission = offMezo && pool.id === partialEmission
  const base = {
    id: pool.id,
    chain: pool.chain,
    venue: pool.venue,
    pair: pool.pair,
    kind: pool.kind,
    pool: pool.address,
    url: pool.url,
    legacy: pool.legacy,
  }
  if (figures === undefined) {
    return {
      ...base,
      day: null,
      tvl_usd: null,
      volume_24h_usd: null,
      volume_7d_usd: null,
      apr: emission
        ? {
            fees: null,
            rewards: "1.12",
            merkl: null,
            gauge: null,
            total: "1.12",
          }
        : { fees: null, rewards: null, merkl: null, gauge: null, total: null },
      apr_7d: null,
      sources: emission
        ? { apr_rewards: "matchbox gauges (MEZO emissions to stakers)" }
        : {},
      gauge: emission
        ? {
            address: fakeAddress("c9a3"),
            name: "mUSDC/MUSD 0.05%",
            matched_by: "pool",
          }
        : null,
      unavailable: {
        // As the API: a linked gauge has no reason, a Tigris pool with no
        // emissions from Pro's documents says so.
        ...(emission ? {} : { apr_gauge: noGauge }),
        ...(offMezo && !emission
          ? { apr_rewards: "No pool gauge emissions found" }
          : {}),
        volume_7d_usd: "Fewer than 7 days stored",
        apr_7d: "Fewer than 7 days stored",
        day: "No snapshot stored yet",
      },
    }
  }
  const parts = [
    figures.apr.fees,
    figures.apr.rewards,
    figures.apr.merkl,
    figures.apr.gauge,
  ].filter((part): part is string => part !== null)
  return {
    ...base,
    day: today,
    tvl_usd: figures.tvl_usd,
    volume_24h_usd: figures.volume_24h_usd,
    volume_7d_usd: figures.volume_7d_usd,
    apr: { ...figures.apr, total: parts.length === 0 ? null : sum(parts) },
    apr_7d: figures.apr_7d,
    sources: figures.sources,
    gauge: figures.gauge,
    unavailable: figures.unavailable,
  }
}

/** Two-place percent strings added exactly (the fixtures' totals). */
function sum(parts: readonly string[]): string {
  const hundredths = parts.reduce((total, part) => {
    const [whole = "0", fraction = ""] = part.split(".")
    return total + BigInt(`${whole}${fraction.padEnd(2, "0").slice(0, 2)}`)
  }, 0n)
  const text = hundredths.toString().padStart(3, "0")
  return `${text.slice(0, -2)}.${text.slice(-2)}`
}

/**
 * The Tigris MUSD/BTC CL pool is funded by the demo BTC/MUSD CL gauge, so
 * its page reads that gauge's epochs and profile from the voting fixtures.
 */
const linkedGauges: Record<string, NonNullable<ScanCrossChainPool["gauge"]>> = {
  "mezo-tigris-musd-btc-cl": {
    address: demoGauges.btcMusdCl.address.toLowerCase(),
    name: "BTC/MUSD CL200",
    matched_by: "pool",
  },
}

export function poolsAnswer(scenario: FixtureScenario) {
  return {
    data: crossChainPools.map((pool) => {
      const answer = poolAnswer(pool, scenario)
      const gauge = linkedGauges[pool.id]
      return gauge === undefined || answer.gauge !== null
        ? answer
        : { ...answer, gauge }
    }),
  }
}

// -- bridge -----------------------------------------------------------------

const routeTotals = [
  ["mezo", "ethereum", 6_676, "934420.18"],
  ["ethereum", "mezo", 3_207, "329659.61"],
  ["mezo", "base", 1_204, "241090.4"],
  ["base", "mezo", 388, "26514.9"],
] as const

export function bridgeAnswer(
  asset: ScanBridgedAsset,
  scenario: FixtureScenario,
): ScanBridgeFlows {
  if (asset === "mezo") {
    return {
      asset,
      routes: [],
      daily: [],
      as_of: null,
      unavailable: {
        routes: "Wormholescan's NTT endpoints do not support MEZO",
        daily: "Wormholescan's NTT endpoints do not support MEZO",
      },
    }
  }
  if (scenario === "filling") {
    return {
      asset,
      routes: [],
      daily: [],
      as_of: null,
      unavailable: { routes: "No bridge snapshot stored yet" },
    }
  }
  return {
    asset,
    routes: routeTotals.map(([from, to, transfers, usd], index) => ({
      from,
      to,
      transfers_total: transfers,
      notional_usd_total: usd,
      daily:
        index < 2
          ? [
              {
                day: daysAgo(1),
                transfers: 14 - index * 6,
                notional_usd: "18240.5",
              },
              {
                day: today,
                transfers: 9 - index * 4,
                notional_usd: "11034.25",
              },
            ]
          : [],
    })),
    daily: [
      { day: daysAgo(1), transfers: 22, notional_usd: "31277.1" },
      { day: today, transfers: 15, notional_usd: "19050.75" },
    ],
    as_of: readAt(scenario, 1_200),
    unavailable: {},
  }
}

export const crossChainFixtures: FixtureRoute[] = [
  {
    pattern: /^crosschain\/prices$/,
    answer: (_match, _query, scenario) => ok(pricesAnswer(scenario)),
  },
  {
    pattern: /^crosschain\/prices\/history$/,
    answer: (_match, _query, scenario) => ok(priceHistoryAnswer(scenario)),
  },
  {
    pattern: /^crosschain\/supply$/,
    answer: (_match, _query, scenario) => ok(supplyAnswer(scenario)),
  },
  {
    pattern: /^crosschain\/pools$/,
    answer: (_match, _query, scenario) => ok(poolsAnswer(scenario)),
  },
  {
    pattern: /^crosschain\/bridge-flows$/,
    answer: (_match, query, scenario) =>
      ok(
        bridgeAnswer(query.get("asset") === "mezo" ? "mezo" : "musd", scenario),
      ),
  },
]
