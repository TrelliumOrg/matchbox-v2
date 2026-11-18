// MUSD and MEZO beyond Mezo: chains, the Wormhole NTT managers that bridge
// them, and the pools Matchscan tracks. Every address was read on chain on
// 12 Nov 2026 (`getMode()`, `token()`, `token0()`/`token1()`, `coins()`),
// never inferred from a symbol: 0x423f…(9 decimals) on Ethereum is an
// impostor "MEZO", and DefiLlama's and Merkl's "MUSD" also match MetaMask
// USD (0xaca9…) and mStable mUSD (0xe2f2…). Filter every source by address.

export type CrossChain = "mezo" | "ethereum" | "base" | "bsc"

export type CrossChainInfo = {
  name: string
  chainId: number
  /** Wormhole's chain id (Wormholescan's emitterChain / destinationChain). */
  wormholeChainId: number
  /** GeckoTerminal's network id; null where it does not list the chain. */
  geckoterminalNetwork: string | null
  explorer: string
}

export const crossChains: Readonly<Record<CrossChain, CrossChainInfo>> = {
  mezo: {
    name: "Mezo",
    chainId: 31_612,
    wormholeChainId: 50,
    geckoterminalNetwork: "mezo",
    explorer: "https://explorer.mezo.org",
  },
  ethereum: {
    name: "Ethereum",
    chainId: 1,
    wormholeChainId: 2,
    geckoterminalNetwork: "eth",
    explorer: "https://etherscan.io",
  },
  base: {
    name: "Base",
    chainId: 8_453,
    wormholeChainId: 30,
    geckoterminalNetwork: "base",
    explorer: "https://basescan.org",
  },
  bsc: {
    name: "BNB Chain",
    chainId: 56,
    wormholeChainId: 4,
    geckoterminalNetwork: "bsc",
    explorer: "https://bscscan.com",
  },
}

/** The chain with this Wormhole chain id, or null. */
export function chainOfWormholeId(id: number): CrossChain | null {
  for (const [chain, info] of Object.entries(crossChains)) {
    if (info.wormholeChainId === id) return chain as CrossChain
  }
  return null
}

export type BridgedAsset = "musd" | "mezo"

/**
 * NTT mode: Mezo's managers lock (`getMode()` 0) and every other chain's
 * burn and mint (1). Circulating on Mezo is totalSupply minus the Mezo
 * manager's balance; elsewhere it is totalSupply.
 */
export type NttMode = "locking" | "burning"

export type BridgedDeployment = {
  chain: CrossChain
  token: `0x${string}`
  decimals: number
  nttManager: `0x${string}`
  mode: NttMode
}

export const bridgedAssets: Readonly<
  Record<
    BridgedAsset,
    { symbol: string; coingeckoId: string; deployments: BridgedDeployment[] }
  >
> = {
  musd: {
    symbol: "MUSD",
    coingeckoId: "mezo-usd",
    deployments: [
      {
        chain: "mezo",
        token: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
        decimals: 18,
        nttManager: "0x7efb386675d75280d39aae42964a6776de0ee0bd",
        mode: "locking",
      },
      {
        chain: "ethereum",
        token: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
        decimals: 18,
        nttManager: "0x5293158bf7a81ed05418da497a80f7e6dbf4477e",
        mode: "burning",
      },
      {
        chain: "base",
        token: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
        decimals: 18,
        nttManager: "0x3eb418bdbe95b4b9cf465ecfbd8424685acd1bc1",
        mode: "burning",
      },
    ],
  },
  mezo: {
    symbol: "MEZO",
    coingeckoId: "mezo",
    deployments: [
      {
        chain: "mezo",
        token: "0x7b7c000000000000000000000000000000000001",
        decimals: 18,
        nttManager: "0x5e668d912f69db0762cd0fe00647da9fa6b29591",
        mode: "locking",
      },
      {
        chain: "ethereum",
        token: "0x8e4cbbcc33db6c0a18561fde1f6ba35906d4848b",
        decimals: 18,
        nttManager: "0x13916d0dab357dcbaa1600b594d62c641840686a",
        mode: "burning",
      },
      {
        chain: "base",
        token: "0x8e4cbbcc33db6c0a18561fde1f6ba35906d4848b",
        decimals: 18,
        nttManager: "0x0c46f496c410465975a427e34a976fc15a2ede4f",
        mode: "burning",
      },
      {
        chain: "bsc",
        token: "0x8e4cbbcc33db6c0a18561fde1f6ba35906d4848b",
        decimals: 18,
        nttManager: "0x09959798b95d00a3183d20fac298e4594e599eab",
        mode: "burning",
      },
    ],
  },
}

// ---------------------------------------------------------------------------
// MUSD price venues

/** Curve MUSD/2pool on Ethereum (metapool: coin 0 MUSD, coin 1 the 2pool LP). */
export const curveMusd2pool = {
  pool: "0xb5571e76693ba60110b5811dd650ffefce1c955f",
  /** Curve's USDC/USDT 2pool, whose LP token is coin 1. */
  basePool: "0x4f493b7de8aac7d55f71853688b1f7c8f0243c85",
} as const

/** Aerodrome Slipstream MUSD/USDC on Base: token0 USDC (6), token1 MUSD. */
export const aeroMusdUsdc = {
  pool: "0xb02fda984eddff593202ed2b5a6de043b9b62ea5",
  usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  musd: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
} as const

/** Tigris concentrated mUSDC/MUSD on Mezo: token0 mUSDC (6), token1 MUSD. */
export const tigrisMusdcMusd = {
  pool: "0xcc372b7e15535ab225fe17c1075831d38ef7ac1a",
  musdc: "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
  musd: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
} as const

/** Concentrated-liquidity pool views shared by Slipstream and Tigris. */
export const clPoolAbi = [
  {
    type: "function",
    name: "observe",
    stateMutability: "view",
    inputs: [{ name: "secondsAgos", type: "uint32[]" }],
    outputs: [
      { name: "tickCumulatives", type: "int56[]" },
      { name: "secondsPerLiquidityCumulativeX128s", type: "uint160[]" },
    ],
  },
] as const

export const curveMetapoolAbi = [
  {
    type: "function",
    name: "get_dy",
    stateMutability: "view",
    inputs: [
      { name: "i", type: "int128" },
      { name: "j", type: "int128" },
      { name: "dx", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balances",
    stateMutability: "view",
    inputs: [{ name: "i", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "get_virtual_price",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const

export const nttManagerAbi = [
  {
    type: "function",
    name: "getMode",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const

// ---------------------------------------------------------------------------
// Pools across chains

export type CrossChainVenue =
  | "tigris"
  | "curve"
  | "uniswap-v4"
  | "aerodrome"
  | "mezo-savings"

export type CrossChainPool = {
  /** Stable key: `{chain}-{venue}-{pair}`. */
  id: string
  chain: CrossChain
  venue: CrossChainVenue
  /** Display pair, token symbols in pool order ("mUSDC/MUSD"). */
  pair: string
  /** "CL 0.05%", "stable", "classic"; null when the venue has one kind. */
  kind: string | null
  /** Pool contract, or Uniswap v4 pool id (32 bytes). */
  address: string
  /** Swap fee in basis points; null when not fixed (Curve, vaults). */
  feeBps: number | null
  /** The venue's pool page, else GeckoTerminal's. */
  url: string
  /** DefiLlama yields pool id, where DefiLlama tracks it. */
  defillamaPool: string | null
  /** Merkl opportunity identifier (address or pool id) on this chain. */
  merklIdentifier: string | null
  /** Liquidity left; gauges ended. Kept so the move shows. */
  legacy: boolean
}

// Tigris and Aerodrome have no per-pool page we could verify, so their
// rows link to GeckoTerminal's pool page; Curve, Uniswap and Mezo's savings
// link to the venue itself.
const tigrisUrl = (address: string) =>
  `https://www.geckoterminal.com/mezo/pools/${address}`
const aeroUrl = (address: string) =>
  `https://www.geckoterminal.com/base/pools/${address}`

export const crossChainPools: readonly CrossChainPool[] = [
  // Mezo: Tigris
  {
    id: "mezo-tigris-musdc-musd-cl",
    chain: "mezo",
    venue: "tigris",
    pair: "mUSDC/MUSD",
    kind: "CL 0.05%",
    address: tigrisMusdcMusd.pool,
    feeBps: 5,
    url: tigrisUrl(tigrisMusdcMusd.pool),
    defillamaPool: null,
    merklIdentifier: null,
    legacy: false,
  },
  {
    id: "mezo-tigris-musdc-musd-stable",
    chain: "mezo",
    venue: "tigris",
    pair: "mUSDC/MUSD",
    kind: "stable",
    address: "0xed812aec0fecc8fd882ac3eccc43f3aa80a6c356",
    feeBps: null,
    url: tigrisUrl("0xed812aec0fecc8fd882ac3eccc43f3aa80a6c356"),
    defillamaPool: null,
    merklIdentifier: null,
    legacy: false,
  },
  {
    id: "mezo-tigris-musdt-musd-stable",
    chain: "mezo",
    venue: "tigris",
    pair: "mUSDT/MUSD",
    kind: "stable",
    address: "0x10906a9e9215939561597b4c8e4b98f93c02031a",
    feeBps: null,
    url: tigrisUrl("0x10906a9e9215939561597b4c8e4b98f93c02031a"),
    defillamaPool: null,
    merklIdentifier: null,
    legacy: false,
  },
  {
    id: "mezo-tigris-musd-btc-cl",
    chain: "mezo",
    venue: "tigris",
    pair: "MUSD/BTC",
    kind: "CL 0.3%",
    address: "0x9cbc1537d255768b431488305b1c7efc2ac95022",
    feeBps: 30,
    url: tigrisUrl("0x9cbc1537d255768b431488305b1c7efc2ac95022"),
    defillamaPool: null,
    merklIdentifier: null,
    legacy: false,
  },
  {
    id: "mezo-tigris-musd-btc-classic",
    chain: "mezo",
    venue: "tigris",
    pair: "MUSD/BTC",
    kind: "classic",
    address: "0x52e604c44417233b6ccedddc0d640a405caacefb",
    feeBps: null,
    url: tigrisUrl("0x52e604c44417233b6ccedddc0d640a405caacefb"),
    defillamaPool: null,
    merklIdentifier: null,
    legacy: false,
  },
  {
    id: "mezo-tigris-mezo-musd-cl",
    chain: "mezo",
    venue: "tigris",
    pair: "MEZO/MUSD",
    kind: "CL",
    address: "0x1d6e8d24c133535f2d00676f66a0e824f84765ff",
    feeBps: null,
    url: tigrisUrl("0x1d6e8d24c133535f2d00676f66a0e824f84765ff"),
    defillamaPool: null,
    merklIdentifier: null,
    legacy: false,
  },
  {
    id: "mezo-tigris-mezo-btc-cl",
    chain: "mezo",
    venue: "tigris",
    pair: "MEZO/BTC",
    kind: "CL 1%",
    address: "0x907d055978943c69cffd5ed969f5603af104acc5",
    feeBps: 100,
    url: tigrisUrl("0x907d055978943c69cffd5ed969f5603af104acc5"),
    defillamaPool: null,
    merklIdentifier: null,
    legacy: false,
  },
  // Mezo: savings
  {
    id: "mezo-savings-smusd",
    chain: "mezo",
    venue: "mezo-savings",
    pair: "sMUSD",
    kind: null,
    address: "0xb4d498029af77680cd1ef828b967f010d06c51cc",
    feeBps: null,
    url: "https://mezo.org/earn",
    defillamaPool: "515e257a-3a9c-418b-93fc-acabf4021905",
    merklIdentifier: null,
    legacy: false,
  },
  // Ethereum
  {
    id: "ethereum-curve-musd-2pool",
    chain: "ethereum",
    venue: "curve",
    pair: "MUSD/2pool",
    kind: null,
    address: curveMusd2pool.pool,
    feeBps: null,
    url: `https://www.curve.finance/dex/ethereum/pools/${curveMusd2pool.pool}`,
    defillamaPool: "c27e64f8-21d5-47a5-be7a-7d6382eb43a8",
    merklIdentifier: curveMusd2pool.pool,
    legacy: false,
  },
  {
    id: "ethereum-uniswap-v4-usdc-musd",
    chain: "ethereum",
    venue: "uniswap-v4",
    pair: "USDC/MUSD",
    kind: "0.01%",
    address:
      "0xa9bf5691768ef950a99efd74d722961ff2df3fec08d77ec784432c619bd283a0",
    feeBps: 1,
    url: "https://app.uniswap.org/explore/pools/ethereum/0xa9bf5691768ef950a99efd74d722961ff2df3fec08d77ec784432c619bd283a0",
    defillamaPool: "8b0dcb2f-9dda-4451-8f5d-1c3dfe1e2a4e",
    merklIdentifier:
      "0xa9bf5691768ef950a99efd74d722961ff2df3fec08d77ec784432c619bd283a0",
    legacy: false,
  },
  {
    id: "ethereum-uniswap-v4-tbtc-musd",
    chain: "ethereum",
    venue: "uniswap-v4",
    pair: "tBTC/MUSD",
    kind: "0.05%",
    address:
      "0x0dd11e1def156d20c60de1e7b4f7f4268c411ee9349b5593766579b26ce98183",
    feeBps: 5,
    url: "https://app.uniswap.org/explore/pools/ethereum/0x0dd11e1def156d20c60de1e7b4f7f4268c411ee9349b5593766579b26ce98183",
    defillamaPool: null,
    merklIdentifier: null,
    legacy: false,
  },
  {
    id: "ethereum-uniswap-v4-musd-eth",
    chain: "ethereum",
    venue: "uniswap-v4",
    pair: "MUSD/ETH",
    kind: "0.05%",
    address:
      "0x8cc1660e3ea814687e88dfce87e35a8d0745a89f5b7fa0f12d37dc5b420d71db",
    feeBps: 5,
    url: "https://app.uniswap.org/explore/pools/ethereum/0x8cc1660e3ea814687e88dfce87e35a8d0745a89f5b7fa0f12d37dc5b420d71db",
    defillamaPool: null,
    merklIdentifier: null,
    legacy: false,
  },
  // Base
  {
    id: "base-aerodrome-musd-usdc",
    chain: "base",
    venue: "aerodrome",
    pair: "USDC/MUSD",
    kind: "CL 0.05%",
    address: aeroMusdUsdc.pool,
    feeBps: 5,
    url: aeroUrl(aeroMusdUsdc.pool),
    defillamaPool: null,
    merklIdentifier: null,
    legacy: false,
  },
  {
    id: "base-aerodrome-mezo-musd",
    chain: "base",
    venue: "aerodrome",
    pair: "MEZO/MUSD",
    kind: "CL",
    address: "0x7507518c567c185632e95ca80114ce9a660b6943",
    feeBps: null,
    url: aeroUrl("0x7507518c567c185632e95ca80114ce9a660b6943"),
    defillamaPool: null,
    merklIdentifier: null,
    legacy: false,
  },
  {
    id: "base-aerodrome-musd-usdc-legacy",
    chain: "base",
    venue: "aerodrome",
    pair: "MUSD/USDC",
    kind: "CL (legacy)",
    address: "0xff56d037d948fad1027a1ac82ae610e4b694c641",
    feeBps: null,
    url: aeroUrl("0xff56d037d948fad1027a1ac82ae610e4b694c641"),
    defillamaPool: null,
    merklIdentifier: null,
    legacy: true,
  },
  {
    id: "base-aerodrome-mezo-musd-legacy",
    chain: "base",
    venue: "aerodrome",
    pair: "MEZO/MUSD",
    kind: "CL200 (legacy)",
    address: "0xef458a3263d2a8c7f3ed9e949ae2f9b345d08b1f",
    feeBps: null,
    url: aeroUrl("0xef458a3263d2a8c7f3ed9e949ae2f9b345d08b1f"),
    defillamaPool: null,
    merklIdentifier: null,
    legacy: true,
  },
]

/**
 * What each Tigris pool on Mezo is, read on chain on 13 Nov 2026
 * (`stable()` on basic pools, `tickSpacing()` on concentrated ones), so
 * Matchscan titles them with the pool type label Pro and Matchscan share
 * for pool gauges (`@matchbox/domain/pool-type`): "MUSD/BTC CL200",
 * "MUSD/BTC Volatile". Keyed by `CrossChainPool.id`.
 */
export const tigrisPoolTypes: Readonly<
  Record<
    string,
    { poolType: "volatile" | "stable" | "cl"; tickSpacing: number | null }
  >
> = {
  "mezo-tigris-musdc-musd-cl": { poolType: "cl", tickSpacing: 10 },
  "mezo-tigris-musdc-musd-stable": { poolType: "stable", tickSpacing: null },
  "mezo-tigris-musdt-musd-stable": { poolType: "stable", tickSpacing: null },
  "mezo-tigris-musd-btc-cl": { poolType: "cl", tickSpacing: 200 },
  "mezo-tigris-musd-btc-classic": { poolType: "volatile", tickSpacing: null },
  "mezo-tigris-mezo-musd-cl": { poolType: "cl", tickSpacing: 200 },
  "mezo-tigris-mezo-btc-cl": { poolType: "cl", tickSpacing: 2000 },
}

/**
 * The tracked pool a ThirdPartyVoter gauge funds, from its creation
 * metadata ("remote-gauge-curve-musd-2pool-b5571e76"): the trailing eight
 * hex digits are the start of the pool's address (or v4 pool id).
 */
export function poolOfGaugeMetadata(
  metadata: string | null,
): CrossChainPool | null {
  const suffix = /-([0-9a-f]{8})$/.exec(metadata ?? "")?.[1]
  if (suffix === undefined) return null
  const matches = crossChainPools.filter((pool) =>
    pool.address.toLowerCase().startsWith(`0x${suffix}`),
  )
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/** MUSD's price venues: the deep pools a minute quote is read from. */
export const musdPriceVenues = {
  "curve-musd-2pool": {
    chain: "ethereum",
    label: "Curve MUSD/2pool",
    pool: curveMusd2pool.pool,
    poolId: "ethereum-curve-musd-2pool",
  },
  "aero-musd-usdc": {
    chain: "base",
    label: "Aerodrome MUSD/USDC",
    pool: aeroMusdUsdc.pool,
    poolId: "base-aerodrome-musd-usdc",
  },
  "tigris-musdc-musd": {
    chain: "mezo",
    label: "Tigris mUSDC/MUSD",
    pool: tigrisMusdcMusd.pool,
    poolId: "mezo-tigris-musdc-musd-cl",
  },
} as const satisfies Record<
  string,
  { chain: CrossChain; label: string; pool: string; poolId: string }
>

export type MusdVenueId = keyof typeof musdPriceVenues
