import { createPublicClient, formatUnits, http, parseAbi } from "viem"
import { z } from "zod"

// Ground truth for the eval, read straight from the preview API routes and
// Mezo RPC. Nothing here imports Stuart's code: the eval must not grade
// Stuart against its own arithmetic.

export const API = "https://matchbox-api-v2-preview.mallard.workers.dev"
export const RPC = "https://mainnet.mezo.public.validationcloud.io"

// Mainnet contracts (Mezo docs and the chain registry).
const VEMEZO = "0xb90fdAd3DFD180458D62Cc6acedc983D78E20122"
const VEBTC = "0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279"
const BOOST_VOTER = "0x2Ba614a598Cffa5a19d683cDCA97bac3a49313d1"
const TROVE_MANAGER = "0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193"
const SORTED_TROVES = "0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f"
const PRICE_FEED = "0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88"

const ABI = parseAbi([
  "function supply() view returns (uint256)",
  "function totalVotingPower() view returns (uint256)",
  "function getBoost(uint256) view returns (uint256)",
  "function weights(address) view returns (uint256)",
  "function getTroveStatus(address) view returns (uint8)",
  "function getEntireDebtAndColl(address) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
  "function getFirst() view returns (address)",
  "function fetchPrice() view returns (uint256)",
])

const tokenAmountSchema = z.object({
  token: z.object({ symbol: z.string(), decimals: z.number() }),
  amount: z.string(),
  usd: z.string().nullable(),
})
const incentivesSchema = z.object({
  usd: z.string().nullable(),
  tokens: z.array(tokenAmountSchema),
})
const gaugeCardSchema = z.object({
  gauge: z.object({
    address: z.string(),
    voter: z.string(),
    name: z.string(),
    vebtcTokenId: z.string().nullable(),
  }),
  isAlive: z.boolean(),
  apy: z.string().nullable(),
  incentives: incentivesSchema,
  votes: z.string(),
  boost: z.string().nullable(),
})
export type Card = z.infer<typeof gaugeCardSchema>
const directorySchema = z.object({
  data: z.object({
    epoch: z.object({ number: z.number(), start: z.number(), end: z.number() }),
    gauges: z.array(gaugeCardSchema),
    total: z.number(),
    nextCursor: z.string().nullable(),
  }),
  meta: z.object({ block: z.number() }),
})
const summarySchema = z.object({
  data: z.object({
    epoch: z.object({ number: z.number(), start: z.number(), end: z.number() }),
    incentives: z.object({ usd: z.string() }),
    stats: z.object({
      vemezoLocked: z.string(),
      vemezoLockers: z.number(),
      vebtcLocked: z.string(),
    }),
  }),
})
const pricesSchema = z.object({
  data: z.object({
    btc: z.object({ usd: z.string() }),
    mezo: z.object({ usd: z.string() }),
  }),
})
const lockSchema = z.object({
  escrow: z.enum(["vemezo", "vebtc"]),
  tokenId: z.string(),
  locked: tokenAmountSchema,
  votingPower: z.string(),
  vote: z
    .object({
      status: z.string(),
      allocations: z
        .array(
          z.object({
            gauge: z.object({ name: z.string(), voter: z.string() }),
            basisPoints: z.number(),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
})
const overviewSchema = z.object({
  data: z.object({
    claimable: incentivesSchema,
    locks: z.array(lockSchema),
  }),
  meta: z.object({ source: z.string() }),
})

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return schema.parse(await response.json())
}

async function allCards(voter: string) {
  const cards: Card[] = []
  let cursor: string | null = null
  let epoch = { number: 0, start: 0, end: 0 }
  let block = 0
  do {
    const page: z.infer<typeof directorySchema> = await getJson(
      `/internal/pro/gauges?voter=${voter}&limit=100${cursor === null ? "" : `&cursor=${cursor}`}`,
      directorySchema,
    )
    cards.push(...page.data.gauges)
    cursor = page.data.nextCursor
    epoch = page.data.epoch
    block = page.meta.block
  } while (cursor !== null)
  return { cards, epoch, block }
}

export type WalletTruth = {
  address: string
  source: string
  locks: z.infer<typeof lockSchema>[]
  claimableUsd: number
  claimableTokens: Array<{ symbol: string; amount: number }>
  vemezoLocked: number
  vemezoPower: number
  vebtcLocked: number
  vebtcPower: number
  troveStatus: number
}

export type GroundTruth = {
  block: number
  epoch: { number: number; start: number; end: number }
  boost: Card[]
  pools: Card[]
  validators: Card[]
  summary: z.infer<typeof summarySchema>["data"]
  btcUsd: number
  mezoUsd: number
  chain: {
    vemezoSupply: number
    vebtcSupply: number
    vemezoVotingPower: number
    snfBoost: number
    snfWeight: number
  }
  wallets: Record<string, WalletTruth>
  trove: {
    owner: string
    collBtc: number
    debtMusd: number
    icrPercent: number
  } | null
}

const num = (value: string | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value)

function rpcClient() {
  return createPublicClient({ transport: http(RPC) })
}

async function walletTruth(
  address: string,
  client: ReturnType<typeof rpcClient>,
): Promise<WalletTruth> {
  const overview = await getJson(
    `/internal/pro/wallets/${address}/overview`,
    overviewSchema,
  )
  const locks = overview.data.locks
  const sum = (escrow: "vemezo" | "vebtc", key: "locked" | "power") =>
    locks
      .filter((lock) => lock.escrow === escrow)
      .reduce(
        (total, lock) =>
          total +
          (key === "locked" ? num(lock.locked.amount) : num(lock.votingPower)),
        0,
      )
  const troveStatus = await client.readContract({
    address: TROVE_MANAGER,
    abi: ABI,
    functionName: "getTroveStatus",
    args: [address as `0x${string}`],
  })
  return {
    address,
    source: overview.meta.source,
    locks,
    claimableUsd: num(overview.data.claimable.usd),
    claimableTokens: overview.data.claimable.tokens.map((token) => ({
      symbol: token.token.symbol,
      amount: num(token.amount),
    })),
    vemezoLocked: sum("vemezo", "locked"),
    vemezoPower: sum("vemezo", "power"),
    vebtcLocked: sum("vebtc", "locked"),
    vebtcPower: sum("vebtc", "power"),
    troveStatus,
  }
}

const SNF_GAUGE = "0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e"

export async function loadGroundTruth(
  wallets: readonly string[],
): Promise<GroundTruth> {
  const client = rpcClient()
  const [boost, pools, validators, summary, prices] = await Promise.all([
    allCards("boost"),
    allCards("pools"),
    allCards("validators"),
    getJson("/internal/pro/summary", summarySchema),
    getJson("/internal/pro/prices", pricesSchema),
  ])
  const read = <T>(
    address: `0x${string}`,
    functionName: string,
    args: readonly unknown[] = [],
  ) =>
    client.readContract({
      address,
      abi: ABI,
      functionName,
      args,
    } as never) as Promise<T>
  const [vemezoSupply, vebtcSupply, vemezoVp, snfBoost, snfWeight] =
    await Promise.all([
      read<bigint>(VEMEZO, "supply"),
      read<bigint>(VEBTC, "supply"),
      read<bigint>(VEMEZO, "totalVotingPower"),
      read<bigint>(BOOST_VOTER, "getBoost", [6033n]),
      read<bigint>(BOOST_VOTER, "weights", [SNF_GAUGE]),
    ])
  const walletEntries = await Promise.all(
    wallets.map(
      async (address) => [address, await walletTruth(address, client)] as const,
    ),
  )
  let trove: GroundTruth["trove"] = null
  try {
    const owner = await read<`0x${string}`>(SORTED_TROVES, "getFirst")
    const [entire, price] = await Promise.all([
      read<readonly bigint[]>(TROVE_MANAGER, "getEntireDebtAndColl", [owner]),
      read<bigint>(PRICE_FEED, "fetchPrice"),
    ])
    const [coll = 0n, principal = 0n, interest = 0n] = entire
    const debt = principal + interest
    trove = {
      owner: owner.toLowerCase(),
      collBtc: Number(formatUnits(coll, 18)),
      debtMusd: Number(formatUnits(debt, 18)),
      icrPercent:
        debt === 0n ? 0 : Number(formatUnits((coll * price * 100n) / debt, 18)),
    }
  } catch {
    trove = null
  }
  return {
    block: boost.block,
    epoch: boost.epoch,
    boost: boost.cards,
    pools: pools.cards,
    validators: validators.cards,
    summary: summary.data,
    btcUsd: num(prices.data.btc.usd),
    mezoUsd: num(prices.data.mezo.usd),
    chain: {
      vemezoSupply: Number(formatUnits(vemezoSupply, 18)),
      vebtcSupply: Number(formatUnits(vebtcSupply, 18)),
      vemezoVotingPower: Number(formatUnits(vemezoVp, 18)),
      snfBoost: Number(formatUnits(snfBoost, 18)),
      snfWeight: Number(formatUnits(snfWeight, 18)),
    },
    wallets: Object.fromEntries(walletEntries),
    trove,
  }
}

/** Funded, voted, live cards sorted by incentives per vote (APY). */
export function byApy(cards: readonly Card[]): Card[] {
  return cards
    .filter(
      (card) =>
        card.isAlive && num(card.incentives.usd) > 0 && num(card.votes) > 0,
    )
    .sort(
      (left, right) =>
        num(right.incentives.usd) / num(right.votes) -
        num(left.incentives.usd) / num(left.votes),
    )
}

export function byIncentives(cards: readonly Card[]): Card[] {
  return cards
    .filter((card) => card.isAlive && num(card.incentives.usd) > 0)
    .sort((left, right) => num(right.incentives.usd) - num(left.incentives.usd))
}

export function cardNamed(cards: readonly Card[], name: string): Card {
  const found = cards.find(
    (card) => card.gauge.name.trim().toLowerCase() === name.toLowerCase(),
  )
  if (found === undefined) throw new Error(`No card named ${name}`)
  return found
}

export { num }
