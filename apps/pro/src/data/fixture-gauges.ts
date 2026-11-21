import type {
  GaugeCard,
  GaugeDirectory,
  GaugeRef,
  TokenRef,
} from "@matchbox/contracts/read-models"
import {
  demoGaugeDirectory,
  demoGauges,
  demoKindCards,
  demoTokens,
} from "@matchbox/contracts/read-models/fixtures"

/**
 * The demo directory grown past one page of veBTC gauges, with mainnet's
 * pool gauges that share a pair (13 Nov 2026: BTC/MUSD has a volatile pool
 * and two concentrated pools, mUSDC/MUSD a stable and two concentrated),
 * so `PRO_DATA=fixtures` pages and shows them apart. Kept small: the list
 * is inlined in Vote's HTML, which the route budget measures. The demo
 * cards come first, unchanged; the rest are made up from a seed and never
 * shown outside fixtures mode.
 */

const extraTokens = {
  msolvbtc: token("a10a", "mSolvBTC", "Mezo SolvBTC"),
  // In the token registry, but not a token the API prices.
  usdc: {
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
  // Not in the registry: a token anyone could post, named like a real one.
  fakebtc: token("fa4e", "FAKEBTC", "Fake Bitcoin"),
} satisfies Record<string, TokenRef>

function token(prefix: string, symbol: string, name: string): TokenRef {
  return {
    address: `0x${prefix}${"0".repeat(32)}${prefix}`,
    symbol,
    name,
    decimals: 18,
  }
}

function seededAddress(seed: number): string {
  const hex = (seed * 2_654_435_761).toString(16).padStart(8, "0").slice(-8)
  return `0x${hex}${"5".repeat(24)}${hex}`
}

/** Mainnet's pool gauges past the two the demo already has. */
const pools: readonly {
  tokens: [TokenRef, TokenRef]
  poolType: "volatile" | "stable" | "cl"
  tickSpacing: number | null
}[] = [
  {
    tokens: [demoTokens.btc, demoTokens.musd],
    poolType: "volatile",
    tickSpacing: null,
  },
  {
    tokens: [demoTokens.btc, demoTokens.musd],
    poolType: "cl",
    tickSpacing: 2000,
  },
  {
    tokens: [demoTokens.musdc, demoTokens.musd],
    poolType: "stable",
    tickSpacing: null,
  },
  {
    tokens: [demoTokens.musdc, demoTokens.musd],
    poolType: "cl",
    tickSpacing: 10,
  },
  {
    tokens: [demoTokens.musdc, demoTokens.musd],
    poolType: "cl",
    tickSpacing: 1,
  },
  {
    tokens: [demoTokens.musdc, demoTokens.btc],
    poolType: "volatile",
    tickSpacing: null,
  },
  {
    tokens: [demoTokens.musdc, demoTokens.btc],
    poolType: "cl",
    tickSpacing: 200,
  },
  {
    tokens: [demoTokens.mezo, demoTokens.musd],
    poolType: "cl",
    tickSpacing: 200,
  },
  {
    tokens: [demoTokens.btc, demoTokens.mezo],
    poolType: "cl",
    tickSpacing: 2000,
  },
  {
    tokens: [extraTokens.msolvbtc, demoTokens.musd],
    poolType: "volatile",
    tickSpacing: null,
  },
]

const boostNames = [
  "Forge Partners",
  "Lantern Labs",
  "Copperline",
  "Brightwater DAO",
  "Kettle Fund",
  "Slate Ventures",
  "Harbor Node",
  "Ridgeway",
  "Saltmarsh",
  "Oakmint",
  "Pinecrest",
  "Granite Row",
  "Foxglove",
  "Tallow Works",
  "Ironbark",
  "Quarry Capital",
  "Wickfield",
  "Bellows",
  "Stonefruit",
  "Cinder Club",
  "Marigold",
  "Driftwood",
]

const validatorNames = ["Boar", "Kepler Stake", "Mossrock"]

function amount(seed: number, scale: number): string {
  return ((((seed * 7919) % 997) + 13) * scale).toFixed(2)
}

function poolCard(entry: (typeof pools)[number], index: number): GaugeCard {
  const [first, second] = entry.tokens
  const seed = 400 + index
  const funded = index % 4 !== 3
  const gauge: GaugeRef = {
    address: seededAddress(seed),
    voter: "pools",
    kind: "pool",
    name: `${first.symbol}/${second.symbol}`,
    vebtcTokenId: null,
    picture: { type: "pair", tokens: [first, second] },
    poolType: entry.poolType,
    color: "#F7931A",
    tickSpacing: entry.tickSpacing,
    coin: null,
  }
  const usd = amount(seed, 0.3)
  return {
    gauge,
    tagline: null,
    isAlive: true,
    apy: funded ? amount(seed, 0.04) : null,
    incentives: funded
      ? {
          usd,
          tokens: [
            {
              token: demoTokens.musd,
              amount: usd,
              usd,
            },
          ],
        }
      : { usd: "0", tokens: [] },
    vebtcWeight: null,
    votes: amount(seed, 0.2),
    votesUnit: "veBTC",
    optimalVotes: null,
    boost: null,
    meta: {
      kind: "pool",
      poolKind:
        entry.poolType === "cl"
          ? "cl"
          : entry.poolType === "stable"
            ? "samm"
            : "vamm",
      pool: seededAddress(seed + 9000),
      tvlUsd: null,
      emissionApr: null,
    },
  }
}

function boostCard(name: string, index: number): GaugeCard {
  const seed = 100 + index
  const funded = index % 3 !== 2
  const usd = amount(seed, 0.25)
  const votes = amount(seed, 900)
  return {
    gauge: {
      address: seededAddress(seed),
      voter: "boost",
      kind: "vebtc",
      name,
      vebtcTokenId: String(700 + index),
      picture: {
        type: "initials",
        text: name
          .split(" ")
          .map((word) => word.charAt(0))
          .join("")
          .slice(0, 2)
          .toUpperCase(),
      },
      poolType: null,
      color: "#5C7AEA",
      tickSpacing: null,
      coin: null,
    },
    tagline: null,
    isAlive: true,
    apy: funded ? amount(seed, 0.05) : null,
    incentives: funded
      ? { usd, tokens: [{ token: demoTokens.musd, amount: usd, usd }] }
      : { usd: "0", tokens: [] },
    vebtcWeight: amount(seed, 0.002),
    votes,
    votesUnit: "veMEZO",
    optimalVotes: amount(seed, 1400),
    boost: "1.8",
    meta: {
      kind: "vebtc",
      tokenId: String(700 + index),
      owner: seededAddress(seed + 5000),
      beneficiary: seededAddress(seed + 5000),
      lock: { state: "active", unlocksAt: null, amount: "0.5" },
    },
  }
}

function validatorCard(name: string, index: number): GaugeCard {
  const seed = 300 + index
  const usd = amount(seed, 0.3)
  return {
    gauge: {
      address: seededAddress(seed),
      voter: "validators",
      kind: "validator",
      name,
      vebtcTokenId: null,
      picture: { type: "initials", text: name.slice(0, 2).toUpperCase() },
      poolType: null,
      color: "#1F7A4D",
      tickSpacing: null,
      coin: null,
    },
    tagline: null,
    isAlive: true,
    apy: amount(seed, 0.03),
    incentives: { usd, tokens: [{ token: demoTokens.musd, amount: usd, usd }] },
    vebtcWeight: null,
    votes: amount(seed, 0.3),
    votesUnit: "veBTC",
    optimalVotes: null,
    boost: null,
    meta: {
      kind: "validator",
      operator: seededAddress(seed + 7000),
      status: "active",
    },
  }
}

/**
 * Two pool gauges as mainnet had them on 19 Nov 2026 (P6): $0.28 over
 * a few dollars of votes, which the API rates 3,648.26% APY, and dust
 * worth less than a cent, rated 13.00%. Pro counts the first as funded
 * with no APY, and the second as not funded.
 */
function smallPoolCard(
  name: string,
  index: number,
  pool: { poolType: "stable" | "cl"; tickSpacing: number | null },
  figures: {
    usd: string
    apy: string | null
    votes: string
    tokens?: GaugeCard["incentives"]["tokens"]
  },
): GaugeCard {
  const card = poolCard(
    {
      tokens: [extraTokens.msolvbtc, demoTokens.musd],
      poolType: pool.poolType,
      tickSpacing: pool.tickSpacing,
    },
    index,
  )
  return {
    ...card,
    gauge: { ...card.gauge, name },
    apy: figures.apy,
    incentives: {
      usd: figures.usd,
      tokens: figures.tokens ?? [
        { token: demoTokens.musd, amount: figures.usd, usd: figures.usd },
      ],
    },
    votes: figures.votes,
  }
}

/**
 * Gauges whose incentives Pro cannot price, by the rule Stuart shares
 * (`@matchbox/domain/funding`): a registry token the API leaves without
 * a USD value funds a gauge by an unknown amount, and an unregistered
 * token never funds one. The API sums only the priced tokens.
 */
export const unpricedPoolGauges = {
  /** Only a registry token without a USD value: funded, "Unpriced". */
  unpriced: smallPoolCard(
    "mUSDT/MUSD",
    92,
    { poolType: "cl", tickSpacing: 50 },
    {
      usd: "0.00",
      apy: null,
      votes: "0.8",
      tokens: [{ token: extraTokens.usdc, amount: "250", usd: null }],
    },
  ),
  /** $1.15 priced and one registry token without a USD value. */
  mixed: smallPoolCard(
    "MUSD/mUSDT",
    93,
    { poolType: "stable", tickSpacing: null },
    {
      usd: "1.15",
      apy: "0.52",
      votes: "2.5",
      tokens: [
        { token: demoTokens.musd, amount: "1.15", usd: "1.15" },
        { token: extraTokens.usdc, amount: "40", usd: null },
      ],
    },
  ),
  /** Only an unregistered token: held, never funding. */
  unregistered: smallPoolCard(
    "FAKEBTC/MUSD",
    94,
    { poolType: "stable", tickSpacing: null },
    {
      usd: "0.00",
      apy: null,
      votes: "0.3",
      tokens: [{ token: extraTokens.fakebtc, amount: "21", usd: null }],
    },
  ),
} as const

/**
 * A veBTC gauge holding 2 cents of MUSD beside a token named "BTC" at an
 * address outside the registry, which the read model values at $500,000,
 * and the API counts in its total and its APY. The API leaves such tokens
 * out today; Pro must not count one if it ever comes through. Unit tests
 * only: not in the directory fixtures mode serves.
 */
export function spoofedPriceGauge(): GaugeCard {
  const card = boostCard("Spoofed Price", 95)
  const spoofed = token("b7c0", "BTC", "Bitcoin")
  return {
    ...card,
    apy: "130000.00",
    incentives: {
      usd: "500000.02",
      tokens: [
        { token: demoTokens.musd, amount: "0.02", usd: "0.02" },
        { token: spoofed, amount: "5", usd: "500000.00" },
      ],
    },
    votes: "20000",
  }
}

/** Addresses of the two small pool gauges, lower case. */
export const smallPoolGauges = {
  tiny: smallPoolCard(
    "MUSD/mSolvBTC",
    90,
    { poolType: "cl", tickSpacing: 200 },
    { usd: "0.28", apy: "3648.26", votes: "0.000004" },
  ),
  dust: smallPoolCard(
    "mSolvBTC/MUSD",
    91,
    { poolType: "stable", tickSpacing: null },
    { usd: "0.004", apy: "13.00", votes: "0.5" },
  ),
} as const

const gauges: GaugeCard[] = [
  ...demoGaugeDirectory.gauges,
  ...Object.values(demoKindCards),
  ...boostNames.map(boostCard),
  ...validatorNames.map(validatorCard),
  ...pools.map(poolCard),
  smallPoolGauges.tiny,
  smallPoolGauges.dust,
  ...Object.values(unpricedPoolGauges),
]

/**
 * A profile picture for two gauges, one veBTC and one validator. On
 * mainnet most large gauges have one, and a picture takes a different
 * path from initials: on 13 Nov 2026 every gauge profile with a picture
 * failed to hydrate on the live site and no fixture gauge had one, so no
 * test could see it. A data URL, so nothing is fetched and it is a valid
 * absolute URL like the real ones: the smallest GIF there is (one
 * pixel), because the whole directory is inlined in Vote's HTML and the
 * budget measure, which runs on fixtures, counts it.
 */
const fixturePicture =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="

/**
 * The veBTC gauge with a picture is the one with the least incentives, so
 * it sorts onto the list's last page and not into Vote's first page: the
 * budget measure runs on fixtures and counts the data inlined in Vote's
 * HTML, and it should measure shipped code, not a fixture's picture.
 */
const lastVebtc = gauges
  .filter((card) => card.gauge.kind === "vebtc")
  .reduce((least, card) =>
    Number(card.incentives.usd) <= Number(least.incentives.usd) ? card : least,
  )

/** Lower case addresses of the fixture gauges that have a picture. */
export const picturedFixtureGauges: readonly string[] = [
  lastVebtc.gauge.address.toLowerCase(),
  demoGauges.northfieldNodes.address.toLowerCase(),
]

const pictured: GaugeCard[] = gauges.map((card) =>
  picturedFixtureGauges.includes(card.gauge.address.toLowerCase())
    ? {
        ...card,
        // The chain's weights have eighteen decimals; the demo's have four.
        // One gauge carries a real one, so what is built from a weight is
        // tested on the real shape (the Calculate link put all eighteen in
        // the URL on the live site, 13 Nov 2026).
        ...(card.gauge.kind === "vebtc"
          ? { vebtcWeight: "0.167908630464777048" }
          : {}),
        gauge: {
          ...card.gauge,
          picture: { type: "image", url: fixturePicture },
        },
      }
    : card,
)

/** The directory fixtures mode serves: the demo's gauges and mainnet's mix. */
export const fixtureGaugeDirectory: GaugeDirectory = {
  ...demoGaugeDirectory,
  gauges: pictured,
  total: gauges.length,
  kinds: {
    vebtc: gauges.filter((card) => card.gauge.kind === "vebtc").length,
    validator: gauges.filter((card) => card.gauge.kind === "validator").length,
    pool: gauges.filter((card) => card.gauge.kind === "pool").length,
    mezo: gauges.filter((card) => card.gauge.kind === "mezo").length,
  },
}

/**
 * The directory as mainnet had it in Epoch 49 (P3, 19 Nov 2026): only
 * pool gauges funded, every other type at no incentives.
 */
export function poolsOnlyGaugeDirectory(): GaugeDirectory {
  return {
    ...fixtureGaugeDirectory,
    gauges: fixtureGaugeDirectory.gauges.map((card) =>
      card.gauge.kind === "pool"
        ? card
        : { ...card, apy: null, incentives: { usd: "0", tokens: [] } },
    ),
  }
}

/**
 * Mainnet's count on 13 Nov 2026: 782 gauges, 723 of them veBTC. The live
 * Vote page inlines every one (413 kB that day), while the directory above
 * has about 45, so a size measured on it says little about Vote.
 */
export const liveSizedGaugeCount = 782

let liveSized: GaugeDirectory | null = null

/** `length` hex digits that differ from one seed to the next. */
function mixed(seed: number, length: number): string {
  let out = ""
  let state = (seed + 1) * 2_654_435_761
  while (out.length < length) {
    state = (state * 1_103_515_245 + 12_345) % 4_294_967_296
    out += state.toString(16).padStart(8, "0")
  }
  return out.slice(0, length)
}

const words = [
  "builders",
  "liquidity",
  "validators",
  "community",
  "treasury",
  "research",
  "grants",
  "bitcoin",
  "yield",
  "stable",
  "long term",
  "ecosystem",
  "node",
  "operators",
  "funding",
  "rewards",
  "holders",
  "growth",
  "infrastructure",
  "collective",
  "since genesis",
  "on Mezo",
  "for MUSD",
  "weekly",
  "aligned",
]

/** A tagline of six to ten words, different for each seed. */
function sentence(seed: number): string {
  const digits = mixed(seed, 20)
  return Array.from(
    { length: 6 + (seed % 5) },
    (_, at) =>
      words[
        Number.parseInt(digits.slice(at * 2, at * 2 + 2), 16) % words.length
      ],
  ).join(" ")
}

/**
 * The directory at mainnet's size, for measuring what Vote inlines
 * (`scripts/measure.mjs`): the fixture directory plus veBTC gauges up to
 * `liveSizedGaugeCount`, each a record the size of a real one (eighteen
 * decimal amounts, as the chain gives them). The added gauges have no
 * incentives, so they sort after the others and Vote's first page is the
 * same. Built on first use, so pages that never ask pay nothing.
 */
export function liveSizedGaugeDirectory(): GaugeDirectory {
  if (liveSized !== null) return liveSized
  const base = fixtureGaugeDirectory.gauges
  const extra = Array.from(
    { length: Math.max(0, liveSizedGaugeCount - base.length) },
    (_, index): GaugeCard => {
      const card = boostCard(`veBTC #${5000 + index}`, 1000 + index)
      const decimals = String(index).padStart(18, "0")
      return {
        ...card,
        // As varied as real records, or the list compresses far better
        // than mainnet's and the figure flatters Vote: with every record
        // alike it measured 35 kB where the live page's data was 48 kB.
        gauge: {
          ...card.gauge,
          color: `#${mixed(index, 6).toUpperCase()}`,
          ...(index % 3 === 0
            ? {
                picture: {
                  type: "image",
                  url: `https://fixtures.invalid/storage/v1/object/public/gauge-avatars/${mixed(index + 7, 32)}.png`,
                },
              }
            : {}),
        },
        tagline: index % 2 === 0 ? sentence(index) : null,
        apy: null,
        incentives: { usd: "0", tokens: [] },
        votes: `${(index * 7919) % 99_991}.${decimals}`,
        vebtcWeight: `0.${String(index * 104_729).padStart(18, "0")}`,
        optimalVotes: `${(index * 104_729) % 9_999_991}.${decimals}`,
      }
    },
  )
  const all = [...base, ...extra]
  liveSized = {
    ...fixtureGaugeDirectory,
    gauges: all,
    total: all.length,
    kinds: {
      ...fixtureGaugeDirectory.kinds,
      vebtc: all.filter((card) => card.gauge.kind === "vebtc").length,
    },
  }
  return liveSized
}
