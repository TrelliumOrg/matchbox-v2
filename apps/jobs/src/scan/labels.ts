import {
  BORROW_CONTRACTS,
  BORROW_STATIC_CONTRACTS,
  CONTRACTS,
  getTokenFromRegistry,
  MEZO_STATIC_CONTRACTS,
  MUSD_CONTRACTS,
} from "@matchbox/chain"
import type { NeonContractRow } from "./neon"
import type { JsonRow, UpsertSpec } from "./statements"

// Address labels: a curated seed (static contracts and tokens, named by
// hand) and names derived from matchbox.contracts (pools, gauges and their
// reward contracts). A curated row always wins over a derived one.

/** Bump to rewrite the seed on the next copy run. */
export const labelSeedVersion = "1"

type Seed = { address: string; name: string; kind: string; tags: string[] }

/** "BoostVoter" -> "Boost Voter", "LegacyBribeX" -> "Legacy Bribe X". */
export function spaced(template: string): string {
  return template.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim()
}

const templateNames: Record<string, string> = {
  VeMEZO: "veMEZO",
  VeBTC: "veBTC",
}

function staticName(template: string): string {
  return templateNames[template] ?? spaced(template)
}

/** Hand-named contracts and tokens beyond the indexer's registries. */
const extraSeeds: Seed[] = [
  {
    address: "0x7b7c000000000000000000000000000000000000",
    name: "BTC",
    kind: "token",
    tags: ["token", "native"],
  },
  {
    address: "0x7b7c000000000000000000000000000000000001",
    name: "MEZO",
    kind: "token",
    tags: ["token"],
  },
  {
    address: MUSD_CONTRACTS.mainnet.musd.toLowerCase(),
    name: "MUSD",
    kind: "token",
    tags: ["token", "stablecoin", "musd"],
  },
  {
    address: "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
    name: "mUSDC",
    kind: "token",
    tags: ["token", "stablecoin", "bridged"],
  },
  {
    address: "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e",
    name: "mUSDT",
    kind: "token",
    tags: ["token", "stablecoin", "bridged"],
  },
  {
    address: CONTRACTS.mainnet.validatorPool.toLowerCase(),
    name: "Validator Pool",
    kind: "precompile",
    tags: ["precompile", "validators"],
  },
  {
    address: "0x7b7c000000000000000000000000000000000012",
    name: "Assets Bridge Caller",
    kind: "precompile",
    tags: ["precompile", "bridge"],
  },
  {
    address: "0x7b7c000000000000000000000000000000000015",
    name: "BTC/USD Oracle",
    kind: "precompile",
    tags: ["precompile", "oracle"],
  },
  {
    address: CONTRACTS.mainnet.factoryRegistry.toLowerCase(),
    name: "Factory Registry",
    kind: "factoryRegistry",
    tags: ["earn"],
  },
  {
    address: CONTRACTS.mainnet.gaugeFactory.toLowerCase(),
    name: "Gauge Factory",
    kind: "gaugeFactory",
    tags: ["earn"],
  },
  {
    address: "0xb58477e074265bdc7f7ca6100ed0f7de264f74a2",
    name: "Chain Fee Distributor",
    kind: "rewardsDistributor",
    tags: ["earn", "vebtc"],
  },
  {
    address: "0x075108f275ed81c9cfc01065e6e50ceea81d6363",
    name: "MEZO Rebase Distributor",
    kind: "rewardsDistributor",
    tags: ["earn", "vemezo"],
  },
  ...(
    [
      ["sortedTroves", "MUSD Sorted Troves"],
      ["stabilityPool", "MUSD Stability Pool"],
      ["priceFeed", "MUSD Price Feed"],
      ["collSurplusPool", "MUSD Coll Surplus Pool"],
      ["pcv", "MUSD PCV"],
      ["savingsRate", "MUSD Savings Rate"],
    ] as const
  ).map(([key, name]) => ({
    address: MUSD_CONTRACTS.mainnet[key].toLowerCase(),
    name,
    kind: "musd",
    tags: ["musd", "borrow"],
  })),
  {
    address: BORROW_CONTRACTS.mainnet.morphoBtcMusdcVault.toLowerCase(),
    name: "Morpho BTC/mUSDC Vault",
    kind: "morphoVault",
    tags: ["borrow", "morpho"],
  },
]

/** The seed: every static contract the indexers know, plus the extras. */
export function labelSeed(): Seed[] {
  const seeds = new Map<string, Seed>()
  for (const contract of MEZO_STATIC_CONTRACTS) {
    seeds.set(contract.address.toLowerCase(), {
      address: contract.address.toLowerCase(),
      name: staticName(contract.template),
      kind: contract.kind,
      tags: [contract.kind],
    })
  }
  for (const contract of BORROW_STATIC_CONTRACTS) {
    seeds.set(contract.address.toLowerCase(), {
      address: contract.address.toLowerCase(),
      name: spaced(contract.template),
      kind: contract.kind,
      tags: ["borrow", contract.kind],
    })
  }
  for (const seed of extraSeeds) seeds.set(seed.address, seed)
  return [...seeds.values()].sort((a, b) => a.address.localeCompare(b.address))
}

export const labelSpec: UpsertSpec = {
  table: "labels",
  columns: [
    "address",
    "name",
    "name_lower",
    "kind",
    "tags",
    "source",
    "pool",
    "gauge",
    "updated_at",
  ],
  key: ["address"],
  update: [
    "name",
    "name_lower",
    "kind",
    "tags",
    "source",
    "pool",
    "gauge",
    "updated_at",
  ],
}

/** Derived rows never replace a curated one. */
export const derivedLabelSpec: UpsertSpec = {
  ...labelSpec,
  guard: "labels.source <> 'curated'",
}

export function seedLabelRows(nowSeconds: number): JsonRow[] {
  return labelSeed().map((seed) => ({
    address: seed.address,
    name: seed.name,
    name_lower: seed.name.toLowerCase(),
    kind: seed.kind,
    tags: JSON.stringify(seed.tags),
    source: "curated",
    pool: null,
    gauge: null,
    updated_at: nowSeconds,
  }))
}

function symbolOf(address: string | null): string | null {
  if (address === null) return null
  return getTokenFromRegistry(address.toLowerCase())?.symbol ?? null
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** "vAMM BTC/MUSD", "sAMM mUSDC/MUSD", or "Pool 0x1234…abcd". */
export function poolName(row: NeonContractRow): string {
  const pool = (row.pool ?? row.address).toLowerCase()
  const symbol0 = symbolOf(row.token0)
  const symbol1 = symbolOf(row.token1)
  if (symbol0 === null || symbol1 === null) return `Pool ${short(pool)}`
  const prefix = row.pool_type === "stable" ? "sAMM" : "vAMM"
  return `${prefix} ${symbol0}/${symbol1}`
}

const derivedPrefix: Record<string, string> = {
  gauge: "Gauge",
  bribeVotingReward: "Incentives",
  feeVotingReward: "Fees",
  voterBribeReward: "Voter Incentives",
}

export function derivedLabelRows(
  rows: readonly NeonContractRow[],
  nowSeconds: number,
): JsonRow[] {
  return rows.map((row) => {
    const address = row.address.toLowerCase()
    const hasPool = row.pool !== null || row.kind === "pool"
    const pool = hasPool ? poolName(row) : null
    const prefix = derivedPrefix[row.kind]
    const name =
      row.kind === "pool" && pool !== null
        ? pool
        : prefix !== undefined
          ? pool === null
            ? `${prefix} ${short(row.gauge ?? address)}`
            : `${prefix} ${pool}`
          : staticName(row.template)
    return {
      address,
      name,
      name_lower: name.toLowerCase(),
      kind: row.kind,
      tags: JSON.stringify([...new Set([row.kind, row.template])]),
      source: "contracts",
      pool: row.pool === null ? null : row.pool.toLowerCase(),
      gauge: row.gauge === null ? null : row.gauge.toLowerCase(),
      updated_at: nowSeconds,
    }
  })
}
