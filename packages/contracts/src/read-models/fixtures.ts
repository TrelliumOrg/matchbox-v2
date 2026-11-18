import type { ActivityRow } from "./activity"
import type { WalletBalances } from "./balances"
import type { GaugeCardMeta, GaugeDetails } from "./gauge-kinds"
import type { GaugeCard, GaugeDirectory, GaugeProfileReadModel } from "./gauges"
import type { ChainHead, Prices } from "./live"
import type {
  Allocation,
  EpochRef,
  GaugeRef,
  LockRef,
  ReadModelMeta,
  TokenAmount,
  TokenRef,
} from "./primitives"
import type {
  ProSummary,
  Protocol,
  ProtocolEpoch,
  ProtocolHistory,
} from "./protocol"
import type { WalletRewards } from "./rewards"
import type { WalletOverview } from "./wallet"
import type { WatchList } from "./watchlist"

// The shared demo data from the matchbox-v3 guideline and the Pro frames on
// Doop canvas hFp5UsQ4BA: Sun 8 Nov 2026 about 11:53 UTC, block 13,078,795,
// BTC $105,710, MEZO $0.184, wallet 0x7c21…9e0B. Every USD figure is the one
// the frames show. Gauge, wallet and transaction addresses are made up but
// keep the frames' shortened forms.
//
// Epochs use the live numbering from `@matchbox/domain`: Epoch 0 starts
// Thu 11 Dec 2025, so the demo week of Thu 5 Nov 2026 is Epoch 47, as the
// frames and the community numbering say.

/** Sun 8 Nov 2026 11:53:00 UTC. */
export const demoNow = 1_794_138_780

export const demoBlock = 13_078_795

const epoch47Start = 1_793_836_800
const week = 604_800

export function demoEpoch(number: number): EpochRef {
  const start = epoch47Start + (number - 47) * week
  return { number, start, end: start + week }
}

/** Mezo blocks are about 3.85s apart around the demo date. */
function blockAt(timestamp: number): number {
  return demoBlock - Math.round((demoNow - timestamp) / 3.847)
}

/** Deterministic lower-case hex of `length` digits. */
function hexFrom(seed: string, length: number): string {
  let state = 2_166_136_261
  for (const char of seed) {
    state = Math.imul(state ^ char.charCodeAt(0), 16_777_619) >>> 0
  }
  let out = ""
  while (out.length < length) {
    state = Math.imul(state ^ (state >>> 15), 2_246_822_507) >>> 0
    out += state.toString(16).padStart(8, "0")
  }
  return out.slice(0, length)
}

function address(prefix: string, suffix: string): string {
  const middle = 40 - prefix.length - suffix.length
  return `0x${prefix}${hexFrom(`${prefix}${suffix}`, middle)}${suffix}`
}

function txHash(seed: string, prefix = "", suffix = ""): string {
  const middle = 64 - prefix.length - suffix.length
  return `0x${prefix}${hexFrom(seed, middle)}${suffix}`
}

/** Unix seconds for a UTC wall-clock time in the demo's weeks. */
function at(isoUtc: string): number {
  return Date.parse(`${isoUtc}Z`) / 1000
}

// ---------------------------------------------------------------------------
// Tokens and prices
// ---------------------------------------------------------------------------

export const demoTokens = {
  btc: {
    address: "0x7b7c000000000000000000000000000000000000",
    symbol: "BTC",
    name: "Bitcoin",
    decimals: 18,
  },
  mezo: {
    address: "0x7b7c000000000000000000000000000000000001",
    symbol: "MEZO",
    name: "Mezo",
    decimals: 18,
  },
  musd: {
    address: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
    symbol: "MUSD",
    name: "Mezo USD",
    decimals: 18,
  },
  musdc: {
    address: "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
    symbol: "mUSDC",
    name: "Mezo Circle USDC",
    decimals: 6,
  },
} as const satisfies Record<string, TokenRef>

function btc(amount: string, usd: string): TokenAmount {
  return { token: demoTokens.btc, amount, usd }
}

function mezo(amount: string, usd: string): TokenAmount {
  return { token: demoTokens.mezo, amount, usd }
}

function musd(amount: string): TokenAmount {
  return { token: demoTokens.musd, amount, usd: amount }
}

export const demoPrices: Prices = {
  btc: {
    usd: "105710",
    change24h: "1.8",
    source: "mezo-oracle",
    updatedAt: demoNow,
  },
  mezo: {
    usd: "0.184",
    change24h: "-2.4",
    source: "aerodrome-cl",
    updatedAt: demoNow,
  },
}

export const demoChainHead: ChainHead = { block: demoBlock, timestamp: demoNow }

export const demoMeta: ReadModelMeta = {
  network: "mezo",
  source: "fixture",
  block: demoBlock,
  updatedAt: demoNow,
}

// ---------------------------------------------------------------------------
// Gauges
// ---------------------------------------------------------------------------

function boostGauge(
  name: string,
  vebtcTokenId: string,
  initials: string,
  color: string,
): GaugeRef {
  return {
    address: address(hexFrom(name, 4), hexFrom(`${name}-end`, 4)),
    voter: "boost",
    kind: "vebtc",
    name,
    vebtcTokenId,
    picture: { type: "initials", text: initials },
    poolType: null,
    color,
    tickSpacing: null,
    coin: null,
  }
}

export const demoGauges = {
  kilnLabs: boostGauge("Kiln Labs", "7", "KL", "#3E7CB1"),
  northgate: boostGauge("Northgate Capital", "31", "NC", "#6A4C93"),
  satsCollective: boostGauge("Sats Collective", "112", "SC", "#2A9D8F"),
  tinderFund: boostGauge("Tinder Fund", "33", "TF", "#E76F51"),
  vebtc604: boostGauge("veBTC #604", "604", "44", "#8D6E63"),
  vebtc388: boostGauge("veBTC #388", "388", "A8", "#5C7AEA"),
  hearthCapital: boostGauge("Hearth Capital", "18", "HC", "#B5651D"),
  emberTreasury: boostGauge("Ember Treasury", "61", "ET", "#C44536"),
  northfieldNodes: {
    address: address("2f5d", "46a1"),
    voter: "validators",
    kind: "validator",
    name: "Northfield Nodes",
    vebtcTokenId: null,
    picture: { type: "initials", text: "NN" },
    poolType: null,
    color: "#1F7A4D",
    tickSpacing: null,
    coin: null,
  },
  btcMusd: {
    address: address("b7c0", "d00d"),
    voter: "pools",
    kind: "pool",
    name: "BTC/MUSD",
    vebtcTokenId: null,
    picture: { type: "pair", tokens: [demoTokens.btc, demoTokens.musd] },
    poolType: "volatile",
    color: "#F7931A",
    tickSpacing: null,
    coin: null,
  },
  musdcMusd: {
    address: address("04c1", "5d5d"),
    voter: "pools",
    kind: "pool",
    name: "mUSDC/MUSD",
    vebtcTokenId: null,
    picture: { type: "pair", tokens: [demoTokens.musdc, demoTokens.musd] },
    poolType: "stable",
    color: "#2775CA",
    tickSpacing: null,
    coin: null,
  },
  btcMusdCl: {
    address: address("21d7", "209e"),
    voter: "pools",
    kind: "pool",
    name: "BTC/MUSD",
    vebtcTokenId: null,
    picture: { type: "pair", tokens: [demoTokens.btc, demoTokens.musd] },
    poolType: "cl",
    color: "#F7931A",
    tickSpacing: 200,
    coin: null,
  },
  smusd: {
    address: address("6778", "a401"),
    voter: "pools",
    kind: "pool",
    name: "sMUSD",
    vebtcTokenId: null,
    picture: { type: "initials", text: "SM" },
    poolType: null,
    color: "#1F5EFF",
    tickSpacing: null,
    coin: {
      address: address("b4d4", "51cc"),
      symbol: "sMUSD",
      name: "MUSD Savings Rate",
      decimals: 18,
    },
  },
  aerodromeMezoMusd: {
    address: address("4440", "f4b6"),
    voter: "third-party",
    kind: "mezo",
    name: "Aerodrome MEZO/MUSD CL200",
    vebtcTokenId: null,
    picture: { type: "initials", text: "AM" },
    poolType: null,
    color: "#D23A61",
    tickSpacing: null,
    coin: null,
  },
} satisfies Record<string, GaugeRef>

/** Full metadata for one gauge of each kind (and a CL pool and a vault). */
export const demoGaugeDetails = {
  kilnLabs: {
    kind: "vebtc",
    tokenId: "7",
    owner: address("91fe", "22a0"),
    beneficiary: address("91fe", "22a0"),
    lock: { state: "auto-max", unlocksAt: null, amount: "3.1047" },
    vebtcWeight: "3.1047",
    boost: "4.4",
    optimalVotes: "6970000",
    locked: btc("3.1047", "328180.51"),
  },
  northfieldNodes: {
    kind: "validator",
    operator: address("0f1e", "77aa"),
    status: "active",
    moniker: "Northfield Nodes",
    beneficiary: address("0f1e", "77ab"),
    votingPower: null,
    commission: null,
  },
  btcMusdCl: {
    kind: "pool",
    poolKind: "cl",
    pool: address("9cbc", "5022"),
    tvlUsd: "412800.00",
    emissionApr: "38.40",
    tokens: [demoTokens.btc, demoTokens.musd],
    tickSpacing: 200,
    feePercent: "0.3",
    reserves: [btc("2.1", "222000.00"), musd("190800.00")],
    stakedPercent: "99.01",
    savingsApr: null,
  },
  smusd: {
    kind: "pool",
    poolKind: "vault",
    pool: address("b4d4", "51cc"),
    tvlUsd: "1286763.90",
    emissionApr: "11.20",
    tokens: [demoTokens.musd],
    tickSpacing: null,
    feePercent: null,
    reserves: [musd("1286763.90")],
    stakedPercent: "8.89",
    savingsApr: "4.50",
  },
  aerodromeMezoMusd: {
    kind: "mezo",
    chain: "Base",
    protocol: "Aerodrome",
    wormholeChainId: 30,
    destination: "MEZO/MUSD CL200",
    recipient: address("f070", "32d2"),
    allocator: address("ea26", "a911"),
    bridge: "Wormhole NTT",
    metadata: "remote-gauge-aerodrome-mezo-musd-cl200-ef458a32",
    source: "chain",
    url: null,
  },
} satisfies Record<string, GaugeDetails>

/** The card form of `details` (the API derives it the same way). */
function compact(details: GaugeDetails): GaugeCardMeta {
  switch (details.kind) {
    case "vebtc":
      return {
        kind: "vebtc",
        tokenId: details.tokenId,
        owner: details.owner,
        beneficiary: details.beneficiary,
        lock: details.lock,
      }
    case "validator":
      return {
        kind: "validator",
        operator: details.operator,
        status: details.status,
      }
    case "pool":
      return {
        kind: "pool",
        poolKind: details.poolKind,
        pool: details.pool,
        tvlUsd: details.tvlUsd,
        emissionApr: details.emissionApr,
      }
    case "mezo":
      return {
        kind: "mezo",
        chain: details.chain,
        protocol: details.protocol,
      }
  }
}

/** Compact metadata for any demo veBTC gauge. */
function vebtcMeta(gauge: GaugeRef): GaugeCardMeta {
  return {
    kind: "vebtc",
    tokenId: gauge.vebtcTokenId,
    owner: address(hexFrom(`${gauge.name}-owner`, 4), "0001"),
    beneficiary: address(hexFrom(`${gauge.name}-owner`, 4), "0001"),
    lock: { state: "active", unlocksAt: demoNow + 180 * 86_400, amount: "1.2" },
  }
}

function split(gauge: GaugeRef, basisPoints: number): Allocation {
  return { gauge, basisPoints }
}

function card(
  gauge: GaugeRef,
  fields: Omit<GaugeCard, "gauge" | "isAlive" | "meta" | "votesUnit">,
): GaugeCard {
  return {
    gauge,
    isAlive: true,
    votesUnit: "veMEZO",
    meta:
      gauge.name === "Kiln Labs"
        ? compact(demoGaugeDetails.kilnLabs)
        : vebtcMeta(gauge),
    ...fields,
  }
}

/** One card per non-veBTC kind, with metadata. */
export const demoKindCards = {
  northfieldNodes: {
    gauge: demoGauges.northfieldNodes,
    votesUnit: "veBTC",
    tagline: null,
    isAlive: true,
    apy: "4.10",
    incentives: { usd: "640.00", tokens: [mezo("3478.26", "640.00")] },
    vebtcWeight: null,
    votes: "96.4",
    optimalVotes: null,
    boost: null,
    meta: compact(demoGaugeDetails.northfieldNodes),
  },
  btcMusdCl: {
    gauge: demoGauges.btcMusdCl,
    votesUnit: "veBTC",
    tagline: null,
    isAlive: true,
    apy: "12.80",
    incentives: { usd: "910.00", tokens: [musd("910.00")] },
    vebtcWeight: null,
    votes: "88.1",
    optimalVotes: null,
    boost: null,
    meta: compact(demoGaugeDetails.btcMusdCl),
  },
  smusd: {
    gauge: demoGauges.smusd,
    votesUnit: "veBTC",
    tagline: null,
    isAlive: true,
    apy: null,
    incentives: { usd: "0", tokens: [] },
    vebtcWeight: null,
    votes: "40.2",
    optimalVotes: null,
    boost: null,
    meta: compact(demoGaugeDetails.smusd),
  },
  aerodromeMezoMusd: {
    gauge: demoGauges.aerodromeMezoMusd,
    votesUnit: "veMEZO",
    tagline: null,
    isAlive: true,
    apy: null,
    incentives: { usd: "0", tokens: [] },
    vebtcWeight: null,
    votes: "12.5",
    optimalVotes: null,
    boost: null,
    meta: compact(demoGaugeDetails.aerodromeMezoMusd),
  },
} satisfies Record<string, GaugeCard>

const noIncentives = { usd: "0", tokens: [] }

export const demoGaugeCards = {
  kilnLabs: card(demoGauges.kilnLabs, {
    tagline: "Validator ops on Mezo since genesis",
    apy: "2.56",
    incentives: { usd: "1180.00", tokens: [mezo("6413.04", "1180.00")] },
    vebtcWeight: "3.1047",
    votes: "5880000",
    optimalVotes: "6970000",
    boost: "4.4",
  }),
  vebtc604: card(demoGauges.vebtc604, {
    tagline: "0x449b…3d1E",
    apy: "3.05",
    incentives: { usd: "519.42", tokens: [mezo("2822.93", "519.42")] },
    vebtcWeight: "1.2400",
    votes: "2180000",
    optimalVotes: "3280000",
    boost: "3.7",
  }),
  northgate: card(demoGauges.northgate, {
    tagline: "Institutional veBTC desk",
    apy: "2.61",
    incentives: {
      usd: "802.00",
      tokens: [mezo("2500.00", "460.00"), musd("342.00")],
    },
    vebtcWeight: "1.7420",
    votes: "3410000",
    optimalVotes: "4100000",
    boost: "4.3",
  }),
  satsCollective: card(demoGauges.satsCollective, {
    tagline: "Pooled small locks",
    apy: "3.30",
    incentives: {
      usd: "388.00",
      tokens: [btc("0.001", "105.71"), mezo("1534.18", "282.29")],
    },
    vebtcWeight: "0.6630",
    votes: "1270000",
    optimalVotes: "1620000",
    boost: "4.1",
  }),
  tinderFund: card(demoGauges.tinderFund, {
    tagline: "Community veBTC pool",
    apy: "1.61",
    incentives: {
      usd: "264.10",
      tokens: [mezo("1000.00", "184.00"), musd("80.10")],
    },
    vebtcWeight: "1.2730",
    votes: "2100000",
    optimalVotes: "2880000",
    boost: "3.9",
  }),
  vebtc388: card(demoGauges.vebtc388, {
    tagline: "0xA8C1…c8f4",
    apy: "1.10",
    incentives: { usd: "32.00", tokens: [btc("0.0003027", "32.00")] },
    vebtcWeight: "0.6120",
    votes: "419930",
    optimalVotes: "923400",
    boost: "2.8",
  }),
  hearthCapital: card(demoGauges.hearthCapital, {
    tagline: "Max-lock veBTC",
    apy: null,
    incentives: noIncentives,
    vebtcWeight: "3.0950",
    votes: "6400000",
    optimalVotes: "6950000",
    boost: "4.7",
  }),
  emberTreasury: card(demoGauges.emberTreasury, {
    tagline: "DAO treasury lock",
    apy: null,
    incentives: noIncentives,
    vebtcWeight: "0.5840",
    votes: "1310000",
    optimalVotes: "1310000",
    boost: "5",
  }),
} satisfies Record<string, GaugeCard>

export const demoGaugeDirectory: GaugeDirectory = {
  epoch: demoEpoch(47),
  gauges: [
    demoGaugeCards.hearthCapital,
    demoGaugeCards.kilnLabs,
    demoGaugeCards.northgate,
    demoGaugeCards.vebtc604,
    demoGaugeCards.tinderFund,
    demoGaugeCards.emberTreasury,
    demoGaugeCards.satsCollective,
    demoGaugeCards.vebtc388,
  ],
  totalVotes: "282900000",
  total: 8,
  kinds: { vebtc: 8, validator: 0, pool: 0, mezo: 0 },
  nextCursor: null,
}

export const demoGaugeProfile: GaugeProfileReadModel = {
  card: demoGaugeCards.kilnLabs,
  description: "Validator and infrastructure team on Mezo since genesis.",
  tags: ["Validator", "Infrastructure"],
  links: [
    { kind: "website", url: "https://kiln-labs.example" },
    { kind: "x", url: "https://x.example/kilnlabs" },
    { kind: "discord", url: "https://discord.example/kilnlabs" },
  ],
  owner: address("91fe", "22a0"),
  locked: btc("3.1047", "328197.84"),
  votingStrategy: "BTC and MUSD pools",
  incentiveStrategy: "Weekly, in MEZO",
  apyChange: "0.31",
  votesHistory: [
    { epoch: demoEpoch(41), votes: "4200000" },
    { epoch: demoEpoch(42), votes: "4550000" },
    { epoch: demoEpoch(43), votes: "4860000" },
    { epoch: demoEpoch(44), votes: "5120000" },
    { epoch: demoEpoch(45), votes: "5360000" },
    { epoch: demoEpoch(46), votes: "5600000" },
    { epoch: demoEpoch(47), votes: "5880000" },
  ],
  incentivesHistory: [
    {
      epoch: demoEpoch(47),
      status: "upcoming",
      paysAt: demoEpoch(47).end,
      incentives: { usd: "1180.00", tokens: [mezo("6413.04", "1180.00")] },
    },
    {
      epoch: demoEpoch(46),
      status: "paid",
      paysAt: demoEpoch(46).end,
      incentives: { usd: "1120.00", tokens: [mezo("6086.96", "1120.00")] },
    },
    {
      epoch: demoEpoch(45),
      status: "paid",
      paysAt: demoEpoch(45).end,
      incentives: { usd: "1050.00", tokens: [mezo("5706.52", "1050.00")] },
    },
  ],
  history: [
    {
      epoch: demoEpoch(46),
      votes: "5600000",
      incentives: { usd: "1052.00", tokens: [mezo("5717.39", "1052.00")] },
    },
    {
      epoch: demoEpoch(47),
      votes: "5880000",
      incentives: { usd: "1180.00", tokens: [mezo("6413.04", "1180.00")] },
    },
  ],
  details: demoGaugeDetails.kilnLabs,
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export const demoWallet = address("7c21", "9e0b")

const lock4120: LockRef = { escrow: "vebtc", tokenId: "4120" }
const lock2207: LockRef = { escrow: "vemezo", tokenId: "2207" }

const vote2207Allocations = [
  split(demoGauges.kilnLabs, 7000),
  split(demoGauges.vebtc604, 3000),
]

function claimRow(
  epoch: number,
  time: string,
  usd: string,
  tokens: TokenAmount[],
  hash: string,
): ActivityRow {
  const timestamp = at(time)
  return {
    type: "claim",
    id: `${hash}-12`,
    txHash: hash,
    block: blockAt(timestamp),
    timestamp,
    status: "confirmed",
    actor: demoWallet,
    epoch: demoEpoch(epoch),
    rewards: { usd, tokens },
    locks: [lock4120, lock2207],
    gauges: [
      demoGauges.northfieldNodes,
      demoGauges.kilnLabs,
      demoGauges.vebtc604,
    ],
  }
}

const claimEpoch7Hash = txHash("claim-45", "2b8d", "07f3")

const claimEpoch7Tokens = [
  btc("0.000148", "15.60"),
  mezo("2652.17", "488.00"),
  musd("151.00"),
]
const claimEpoch6Tokens = [
  btc("0.000135", "14.30"),
  mezo("2554.35", "470.00"),
  musd("146.00"),
]
const claimEpoch5Tokens = [
  btc("0.000114", "12.10"),
  mezo("2456.52", "452.00"),
  musd("140.00"),
]
const claimEpoch4Tokens = [
  btc("0.000089", "9.40"),
  mezo("2326.09", "428.00"),
  musd("131.00"),
]

const vote2207Epoch9: ActivityRow = {
  type: "vote",
  id: `${txHash("vote-2207-47")}-3`,
  txHash: txHash("vote-2207-47"),
  block: blockAt(at("2026-11-05T09:40:00")),
  timestamp: at("2026-11-05T09:40:00"),
  status: "confirmed",
  actor: demoWallet,
  lock: lock2207,
  epoch: demoEpoch(47),
  votes: "41260",
  allocations: vote2207Allocations,
}

const add2207: ActivityRow = {
  type: "lock-add",
  id: `${txHash("add-2207")}-1`,
  txHash: txHash("add-2207"),
  block: blockAt(at("2026-11-02T10:31:00")),
  timestamp: at("2026-11-02T10:31:00"),
  status: "confirmed",
  actor: demoWallet,
  lock: lock2207,
  amount: mezo("6000.00", "1104.00"),
  unlocksAt: at("2030-01-09T00:00:00"),
}

const claimEpoch7 = {
  ...claimRow(
    45,
    "2026-10-30T09:12:08",
    "654.60",
    claimEpoch7Tokens,
    claimEpoch7Hash,
  ),
  block: 12_874_163,
}

/** Wallet activity, newest first, as on the Activity frame. */
export const demoActivityRows: ActivityRow[] = [
  {
    type: "vote",
    id: `${txHash("vote-4120-47")}-0`,
    txHash: txHash("vote-4120-47"),
    block: null,
    timestamp: at("2026-11-08T11:52:00"),
    status: "pending",
    actor: demoWallet,
    lock: lock4120,
    epoch: demoEpoch(47),
    votes: "0.6110",
    allocations: [split(demoGauges.northfieldNodes, 10_000)],
  },
  vote2207Epoch9,
  add2207,
  {
    type: "incentive",
    id: `${txHash("incentive-sats")}-0`,
    txHash: txHash("incentive-sats"),
    block: blockAt(at("2026-11-01T11:47:00")),
    timestamp: at("2026-11-01T11:47:00"),
    status: "reverted",
    actor: demoWallet,
    gauge: demoGauges.satsCollective,
    epoch: demoEpoch(46),
    amount: mezo("1200.00", "220.80"),
  },
  claimEpoch7,
  {
    type: "vote",
    id: `${txHash("vote-2207-46")}-3`,
    txHash: txHash("vote-2207-46"),
    block: blockAt(at("2026-10-29T20:24:00")),
    timestamp: at("2026-10-29T20:24:00"),
    status: "confirmed",
    actor: demoWallet,
    lock: lock2207,
    epoch: demoEpoch(46),
    votes: "36100",
    allocations: vote2207Allocations,
  },
  {
    type: "vote",
    id: `${txHash("vote-4120-46")}-2`,
    txHash: txHash("vote-4120-46"),
    block: blockAt(at("2026-10-29T20:22:00")),
    timestamp: at("2026-10-29T20:22:00"),
    status: "confirmed",
    actor: demoWallet,
    lock: lock4120,
    epoch: demoEpoch(46),
    votes: "0.6110",
    allocations: [split(demoGauges.northfieldNodes, 10_000)],
  },
  claimRow(
    44,
    "2026-10-22T08:57:00",
    "630.30",
    claimEpoch6Tokens,
    txHash("claim-44"),
  ),
  claimRow(
    43,
    "2026-10-16T13:06:00",
    "604.10",
    claimEpoch5Tokens,
    txHash("claim-43"),
  ),
]

export const demoWalletOverview: WalletOverview = {
  address: demoWallet,
  claimableEpoch: demoEpoch(46),
  claimable: {
    usd: "212.48",
    tokens: [btc("0.000412", "43.55"), mezo("812.40", "149.48"), musd("19.45")],
  },
  locks: [
    {
      ...lock4120,
      tab: "vebtc",
      locked: btc("0.8000", "84568.00"),
      votingPower: "0.6110",
      unlocksAt: at("2028-03-02T00:00:00"),
      isPermanent: false,
      isWithdrawable: false,
      vote: {
        status: "voted",
        epoch: demoEpoch(47),
        votes: "0.6110",
        allocations: [split(demoGauges.northfieldNodes, 10_000)],
        votedAt: at("2026-10-29T20:22:00"),
        byVoter: [
          {
            voter: "validators",
            votes: "0.6110",
            allocations: [split(demoGauges.northfieldNodes, 10_000)],
            votedAt: at("2026-10-29T20:22:00"),
          },
        ],
      },
      claimable: {
        usd: "203.78",
        tokens: [
          btc("0.000412", "43.55"),
          mezo("765.10", "140.78"),
          musd("19.45"),
        ],
      },
      projected: {
        usd: "198.40",
        tokens: [
          btc("0.0004", "42.28"),
          mezo("742.00", "136.53"),
          musd("19.59"),
        ],
      },
      boost: null,
      createdAt: at("2026-03-05T14:20:00"),
    },
    {
      ...lock2207,
      tab: "vemezo",
      locked: mezo("48000.00", "8832.00"),
      votingPower: "41260",
      unlocksAt: at("2030-01-09T00:00:00"),
      isPermanent: false,
      isWithdrawable: false,
      vote: {
        status: "voted",
        epoch: demoEpoch(47),
        votes: "41260",
        allocations: vote2207Allocations,
        votedAt: at("2026-11-05T09:40:00"),
        byVoter: [
          {
            voter: "boost",
            votes: "41260",
            allocations: vote2207Allocations,
            votedAt: at("2026-11-05T09:40:00"),
          },
        ],
      },
      claimable: { usd: "8.70", tokens: [mezo("47.30", "8.70")] },
      projected: { usd: "8.75", tokens: [mezo("47.53", "8.75")] },
      boost: null,
      createdAt: at("2026-06-11T09:02:00"),
    },
  ],
  projected: {
    usd: "207.14",
    tokens: [btc("0.0004", "42.28"), mezo("789.53", "145.27"), musd("19.59")],
  },
  suggestion: {
    type: "boost",
    gauge: demoGauges.kilnLabs,
    lock: lock2207,
    boost: "4.4",
    votes: "5880000",
    optimalVotes: "6970000",
    missingVotes: "1090000",
  },
  recentActivity: [vote2207Epoch9, claimEpoch7, add2207],
}

export const demoWalletRewards: WalletRewards = {
  address: demoWallet,
  epoch: demoEpoch(46),
  readyToClaim: demoWalletOverview.claimable,
  byLock: [
    {
      lock: lock4120,
      rewards: {
        usd: "203.78",
        tokens: [
          btc("0.000412", "43.55"),
          mezo("765.10", "140.78"),
          musd("19.45"),
        ],
      },
      gauges: [
        {
          gauge: demoGauges.northfieldNodes,
          usd: "203.78",
          tokens: [
            btc("0.000412", "43.55"),
            mezo("765.10", "140.78"),
            musd("19.45"),
          ],
        },
      ],
    },
    {
      lock: lock2207,
      rewards: { usd: "8.70", tokens: [mezo("47.30", "8.70")] },
      gauges: [
        {
          gauge: demoGauges.kilnLabs,
          usd: "5.92",
          tokens: [mezo("32.17", "5.92")],
        },
        {
          gauge: demoGauges.vebtc604,
          usd: "2.78",
          tokens: [mezo("15.13", "2.78")],
        },
      ],
    },
  ],
  earned: { usd: "3912.40", fromEpoch: 40, toEpoch: 46 },
  history: [
    {
      epoch: demoEpoch(45),
      claimedAt: at("2026-10-30T09:12:08"),
      rewards: { usd: "654.60", tokens: claimEpoch7Tokens },
      txHash: claimEpoch7Hash,
      block: 12_874_163,
    },
    {
      epoch: demoEpoch(44),
      claimedAt: at("2026-10-22T08:57:00"),
      rewards: { usd: "630.30", tokens: claimEpoch6Tokens },
      txHash: txHash("claim-44"),
      block: blockAt(at("2026-10-22T08:57:00")),
    },
    {
      epoch: demoEpoch(43),
      claimedAt: at("2026-10-16T13:06:00"),
      rewards: { usd: "604.10", tokens: claimEpoch5Tokens },
      txHash: txHash("claim-43"),
      block: blockAt(at("2026-10-16T13:06:00")),
    },
    {
      epoch: demoEpoch(42),
      claimedAt: at("2026-10-08T10:15:00"),
      rewards: { usd: "568.40", tokens: claimEpoch4Tokens },
      txHash: txHash("claim-42"),
      block: blockAt(at("2026-10-08T10:15:00")),
    },
  ],
}

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

function feedRow<Row extends ActivityRow>(row: Row): Row {
  return row
}

function minutesAgo(minutes: number): number {
  return demoNow - minutes * 60
}

const fourYearsFromEpoch9 = epoch47Start + 208 * week

const demoFeed: ActivityRow[] = [
  feedRow({
    type: "lock-create",
    id: `${txHash("feed-lock-4127")}-0`,
    txHash: txHash("feed-lock-4127"),
    block: blockAt(minutesAgo(2)),
    timestamp: minutesAgo(2),
    status: "confirmed",
    actor: address("3e9a", "b412"),
    lock: { escrow: "vemezo", tokenId: "4127" },
    amount: mezo("12000.00", "2208.00"),
    unlocksAt: fourYearsFromEpoch9,
  }),
  feedRow({
    type: "vote",
    id: `${txHash("feed-vote-1842")}-1`,
    txHash: txHash("feed-vote-1842"),
    block: blockAt(minutesAgo(14)),
    timestamp: minutesAgo(14),
    status: "confirmed",
    actor: address("449b", "3d1e"),
    lock: { escrow: "vemezo", tokenId: "1842" },
    epoch: demoEpoch(47),
    votes: "18360",
    allocations: [
      split(demoGauges.kilnLabs, 5000),
      split(demoGauges.satsCollective, 5000),
    ],
  }),
  feedRow({
    type: "incentive",
    id: `${txHash("feed-incentive-kiln")}-4`,
    txHash: txHash("feed-incentive-kiln"),
    block: blockAt(minutesAgo(26)),
    timestamp: minutesAgo(26),
    status: "confirmed",
    actor: address("91fe", "22a0"),
    gauge: demoGauges.kilnLabs,
    epoch: demoEpoch(47),
    amount: mezo("6413.04", "1180.00"),
  }),
  feedRow({
    type: "boost",
    id: `${txHash("feed-boost-33")}-2`,
    txHash: txHash("feed-boost-33"),
    block: blockAt(minutesAgo(41)),
    timestamp: minutesAgo(41),
    status: "confirmed",
    actor: address("33f0", "a7c2"),
    gauge: demoGauges.tinderFund,
    lock: { escrow: "vebtc", tokenId: "33" },
    previousBoost: "3.6",
    boost: "3.9",
  }),
  feedRow({
    type: "lock-extend",
    id: `${txHash("feed-extend-3318")}-0`,
    txHash: txHash("feed-extend-3318"),
    block: blockAt(minutesAgo(60)),
    timestamp: minutesAgo(60),
    status: "confirmed",
    actor: address("8d21", "06fb"),
    lock: { escrow: "vemezo", tokenId: "3318" },
    previousUnlocksAt: epoch47Start + 120 * week,
    unlocksAt: fourYearsFromEpoch9,
  }),
  feedRow({
    type: "claim",
    id: `${txHash("feed-claim-5d0e")}-7`,
    txHash: txHash("feed-claim-5d0e"),
    block: blockAt(minutesAgo(120)),
    timestamp: minutesAgo(120),
    status: "confirmed",
    actor: address("5d0e", "a417"),
    epoch: demoEpoch(46),
    rewards: {
      usd: "318.06",
      tokens: [
        btc("0.0005", "52.86"),
        mezo("1000.00", "184.00"),
        musd("81.20"),
      ],
    },
    locks: [{ escrow: "vemezo", tokenId: "2954" }],
    gauges: [
      demoGauges.kilnLabs,
      demoGauges.northgate,
      demoGauges.satsCollective,
    ],
  }),
  feedRow({
    type: "boost-refresh",
    id: `${txHash("feed-poke")}-0`,
    txHash: txHash("feed-poke"),
    block: blockAt(minutesAgo(180)),
    timestamp: minutesAgo(180),
    status: "confirmed",
    actor: address("7166", "c0de"),
    actorName: "Tigris maintainer",
    positions: 48,
  }),
]

function epochIncentives(
  number: number,
  totalUsd: string,
  vebtcUsd: string,
  validatorsUsd: string,
  poolsUsd: string,
) {
  return {
    epoch: demoEpoch(number),
    totalUsd,
    vebtcUsd,
    validatorsUsd,
    poolsUsd,
  }
}

export const demoProtocol: Protocol = {
  epoch: demoEpoch(47),
  incentives: { usd: "14820.00", previousUsd: "13950.00", changeUsd: "870.00" },
  stats: {
    vemezoLocked: "282900000",
    vemezoLockers: 1356,
    vebtcLocked: "1404.32",
    vebtcLockedUsd: "148450667.20",
    vebtcVoteWeight: "1099.72",
    vebtcVotes: 38,
    medianApy: "2.61",
  },
  incentivesByEpoch: [
    epochIncentives(38, "1210.00", "484.00", "181.50", "544.50"),
    epochIncentives(39, "3458.00", "1383.20", "518.70", "1556.10"),
    epochIncentives(40, "5269.00", "2107.60", "790.35", "2371.05"),
    epochIncentives(41, "6916.00", "2766.40", "1037.40", "3112.20"),
    epochIncentives(42, "8233.00", "3293.20", "1234.95", "3704.85"),
    epochIncentives(43, "9880.00", "3952.00", "1482.00", "4446.00"),
    epochIncentives(44, "11197.00", "4478.80", "1679.55", "5038.65"),
    epochIncentives(45, "12680.00", "5072.00", "1902.00", "5706.00"),
    epochIncentives(46, "13950.00", "5580.00", "2090.00", "6280.00"),
    epochIncentives(47, "14820.00", "5940.00", "2190.00", "6690.00"),
  ],
  funded: {
    count: 12,
    gauges: [
      {
        gauge: demoGauges.btcMusd,
        incentives: {
          usd: "4210.00",
          tokens: [mezo("12500.00", "2300.00"), musd("1910.00")],
        },
        deposits: 6,
      },
      {
        gauge: demoGauges.musdcMusd,
        incentives: { usd: "2480.00", tokens: [musd("2480.00")] },
        deposits: 4,
      },
      {
        gauge: demoGauges.kilnLabs,
        incentives: demoGaugeCards.kilnLabs.incentives,
        deposits: 3,
      },
      {
        gauge: demoGauges.northgate,
        incentives: demoGaugeCards.northgate.incentives,
        deposits: 3,
      },
      {
        gauge: demoGauges.vebtc604,
        incentives: demoGaugeCards.vebtc604.incentives,
        deposits: 2,
      },
    ],
  },
  feed: { total: 1284, rows: demoFeed },
}

/** Funded gauges and deposits per epoch for the history fixture. */
const fundedPerEpoch = [4, 6, 7, 8, 9, 10, 10, 11, 12, 12]

export const demoProtocolHistory: ProtocolHistory = {
  epochs: demoProtocol.incentivesByEpoch.map((bar, index) => ({
    ...bar,
    fundedGauges: fundedPerEpoch[index] ?? 0,
    deposits: (fundedPerEpoch[index] ?? 0) * 2,
  })),
}

const currentBar = demoProtocol.incentivesByEpoch.at(-1)

export const demoProtocolEpoch: ProtocolEpoch = {
  epoch: demoProtocol.epoch,
  incentives: demoProtocol.incentives,
  byVoter: currentBar ?? {
    epoch: demoProtocol.epoch,
    totalUsd: "0.00",
    vebtcUsd: "0.00",
    validatorsUsd: "0.00",
    poolsUsd: "0.00",
  },
  funded: demoProtocol.funded,
  deposits: 24,
  stats: demoProtocol.stats,
}

export const demoSummary: ProSummary = {
  epoch: demoProtocol.epoch,
  incentives: demoProtocol.incentives,
  stats: demoProtocol.stats,
  topGauges: [
    demoGaugeCards.satsCollective,
    demoGaugeCards.vebtc604,
    demoGaugeCards.northgate,
    demoGaugeCards.kilnLabs,
    demoGaugeCards.tinderFund,
  ],
  gaugeCount: 8,
  fundedCount: 12,
  totalVotes: demoGaugeDirectory.totalVotes,
}

export const demoWalletBalances: WalletBalances = {
  address: demoWallet,
  btc: btc("0.0412", "4355.25"),
  mezo: mezo("12500.00", "2300.00"),
  musd: musd("1840.00"),
  tokens: [],
}

export const demoWatchList: WatchList = {
  owner: demoWallet,
  items: [
    {
      kind: "gauge",
      address: demoGauges.kilnLabs.address,
      addedAt: at("2026-11-06T10:00:00"),
    },
    {
      kind: "wallet",
      address: address("449b", "3d1e"),
      addedAt: at("2026-11-02T08:00:00"),
    },
  ],
}

/** Every fixture, keyed like the `/internal/pro` routes. */
export const demoReadModels = {
  overview: demoWalletOverview,
  rewards: demoWalletRewards,
  activity: { address: demoWallet, rows: demoActivityRows, nextCursor: null },
  protocol: demoProtocol,
  gauges: demoGaugeDirectory,
  gaugeProfile: demoGaugeProfile,
  prices: demoPrices,
  head: demoChainHead,
  balances: demoWalletBalances,
  watchlist: demoWatchList,
  protocolHistory: demoProtocolHistory,
  protocolEpoch: demoProtocolEpoch,
  summary: demoSummary,
} as const
