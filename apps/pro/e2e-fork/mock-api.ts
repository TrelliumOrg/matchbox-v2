import { createServer, type Server } from "node:http"
import { VOTER_WRITE_ABI, VOTING_ESCROW_WRITE_ABI } from "@matchbox/chain"
import {
  type GaugeCard,
  type GaugeDirectory,
  type GaugeRef,
  gaugeDirectoryResponseSchema,
  type WalletLock,
  type WalletOverview,
  type WalletRewards,
  walletOverviewResponseSchema,
  walletRewardsResponseSchema,
} from "@matchbox/contracts/read-models"
import {
  demoGaugeCards,
  demoGaugeProfile,
  demoGauges,
  demoReadModels,
  demoTokens,
} from "@matchbox/contracts/read-models/fixtures"
import { type Address, formatUnits, getAddress, parseAbi } from "viem"
import { client, mainnet, tokens, unindexedWallet } from "./chain"

/**
 * Stands in for the API Worker's /internal/pro read models during the fork
 * tests, built from the fork's live state for the test wallet: its locks,
 * their votes and what their reward contracts say is earned. So a lock
 * created through Pro shows up on the next refetch, like production.
 * Responses go through the shared zod schemas, so Pro reads what the API
 * would send. The unindexed wallet answers 404.
 */

const listAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerToNFTokenIdList(address owner, uint256 index) view returns (uint256)",
  "function votes(uint256 tokenId, address gauge) view returns (uint256)",
  "function length() view returns (uint256)",
  "function gauges(uint256 index) view returns (address)",
])

const week = 7 * 86_400

type Picked = { address: Address; voter: GaugeRef["voter"]; name: string }

const names = ["Kiln Labs", "Northgate Capital", "Sats Collective"]

/** Live gauges from the fork: three boost gauges and one MEZO gauge. */
export async function pickGauges(): Promise<Picked[]> {
  const picked: Picked[] = []
  const take = async (
    voter: Address,
    kind: GaugeRef["voter"],
    count: number,
    label: (index: number) => string,
  ): Promise<void> => {
    const length = Number(
      await client.readContract({
        address: voter,
        abi: listAbi,
        functionName: "length",
      }),
    )
    let found = 0
    for (let index = length - 1; index >= 0 && found < count; index--) {
      const gauge = await client.readContract({
        address: voter,
        abi: listAbi,
        functionName: "gauges",
        args: [BigInt(index)],
      })
      const alive = await client.readContract({
        address: voter,
        abi: VOTER_WRITE_ABI,
        functionName: "isAlive",
        args: [gauge],
      })
      if (!alive) continue
      picked.push({ address: gauge, voter: kind, name: label(found) })
      found += 1
    }
  }
  await take(
    mainnet.boostVoter,
    "boost",
    3,
    (index) => names[index] ?? `Gauge ${index}`,
  )
  await take(mainnet.thirdPartyVoter, "third-party", 1, () => "MUSD Curve pool")
  return picked
}

function ref(gauge: Picked): GaugeRef {
  return {
    ...demoGauges.kilnLabs,
    address: gauge.address.toLowerCase(),
    voter: gauge.voter,
    name: gauge.name,
    vebtcTokenId: null,
  }
}

function card(gauge: Picked, index: number): GaugeCard {
  return {
    ...demoGaugeCards.kilnLabs,
    gauge: ref(gauge),
    tagline: gauge.voter === "boost" ? "Fork gauge" : "MEZO gauge",
    incentives: {
      usd: `${400 - index * 50}.00`,
      tokens: [
        {
          token: demoTokens.musd,
          amount: `${400 - index * 50}`,
          usd: `${400 - index * 50}.00`,
        },
      ],
    },
    votes: `${1_000_000 + index * 250_000}`,
    optimalVotes: gauge.voter === "boost" ? "3000000" : null,
    boost: gauge.voter === "boost" ? "3.0" : null,
    vebtcWeight: gauge.voter === "boost" ? "1.0000" : null,
  }
}

function amount(value: bigint): string {
  return formatUnits(value, 18)
}

/** MUSD base units to dollars, cut to cents (MUSD is a dollar). */
function dollars(value: bigint): string {
  return formatUnits(value / 10n ** 16n, 2)
}

async function meta() {
  const block = await client.getBlock()
  return {
    network: "mezo" as const,
    source: "live" as const,
    block: Number(block.number),
    updatedAt: Number(block.timestamp),
  }
}

function epochOf(now: number) {
  const start = now - (now % week)
  return {
    number: 9 + Math.floor((start - 1_793_836_800) / week),
    start,
    end: start + week,
  }
}

type ForkLock = {
  escrow: "vebtc" | "vemezo"
  tokenId: bigint
  amount: bigint
  end: bigint
  isPermanent: boolean
  power: bigint
}

async function locksOf(owner: Address): Promise<ForkLock[]> {
  const result: ForkLock[] = []
  for (const escrow of ["vemezo", "vebtc"] as const) {
    const address = escrow === "vemezo" ? mainnet.veMEZO : mainnet.veBTC
    const count = await client.readContract({
      address,
      abi: listAbi,
      functionName: "balanceOf",
      args: [owner],
    })
    for (let index = 0n; index < count; index++) {
      const tokenId = await client.readContract({
        address,
        abi: listAbi,
        functionName: "ownerToNFTokenIdList",
        args: [owner, index],
      })
      const [locked, power] = await Promise.all([
        client.readContract({
          address,
          abi: VOTING_ESCROW_WRITE_ABI,
          functionName: "locked",
          args: [tokenId],
        }),
        client.readContract({
          address,
          abi: VOTING_ESCROW_WRITE_ABI,
          functionName: "votingPowerOfNFT",
          args: [tokenId],
        }),
      ])
      result.push({
        escrow,
        tokenId,
        amount: locked.amount < 0n ? 0n : locked.amount,
        end: locked.end,
        isPermanent: locked.isPermanent,
        power,
      })
    }
  }
  return result
}

const voterAddress = {
  boost: mainnet.boostVoter,
  "third-party": mainnet.thirdPartyVoter,
  validators: mainnet.validatorsVoter,
  pools: mainnet.poolsVoter,
} as const

async function votesOf(lock: ForkLock, gauges: Picked[]) {
  const mine = gauges.filter((gauge) =>
    lock.escrow === "vemezo"
      ? gauge.voter === "boost" || gauge.voter === "third-party"
      : gauge.voter === "validators",
  )
  const weights = await Promise.all(
    mine.map((gauge) =>
      client.readContract({
        address: voterAddress[gauge.voter],
        abi: listAbi,
        functionName: "votes",
        args: [lock.tokenId, gauge.address],
      }),
    ),
  )
  return mine
    .map((gauge, index) => ({ gauge, weight: weights[index] ?? 0n }))
    .filter((entry) => entry.weight > 0n)
}

/** What a lock earned on a gauge, in MUSD and MEZO (the fork's incentives). */
async function earnedOn(
  lock: ForkLock,
  gauge: Picked,
): Promise<{ musd: bigint; mezo: bigint }> {
  const bribe = await client.readContract({
    address: voterAddress[gauge.voter],
    abi: VOTER_WRITE_ABI,
    functionName: "gaugeToBribe",
    args: [gauge.address],
  })
  const [musd, mezo] = await Promise.all(
    [tokens.musd, tokens.mezo].map((token) =>
      client.readContract({
        address: bribe,
        abi: parseAbi([
          "function earned(address token, uint256 tokenId) view returns (uint256)",
        ]),
        functionName: "earned",
        args: [token, lock.tokenId],
      }),
    ),
  )
  return { musd: musd ?? 0n, mezo: mezo ?? 0n }
}

/** MEZO at the demo price, $0.18. */
const mezoCentsPerToken = 18n

/** Earned amounts as a reward ledger: tokens with their dollar values. */
function ledgerOf(earned: { musd: bigint; mezo: bigint }) {
  const cents =
    earned.musd / 10n ** 16n + (earned.mezo * mezoCentsPerToken) / 10n ** 18n
  const tokens = [
    ...(earned.musd > 0n
      ? [
          {
            token: demoTokens.musd,
            amount: amount(earned.musd),
            usd: dollars(earned.musd),
          },
        ]
      : []),
    ...(earned.mezo > 0n
      ? [
          {
            token: demoTokens.mezo,
            amount: amount(earned.mezo),
            usd: formatUnits((earned.mezo * mezoCentsPerToken) / 10n ** 18n, 2),
          },
        ]
      : []),
  ]
  return tokens.length === 0
    ? { usd: "0", tokens: [] }
    : { usd: formatUnits(cents, 2), tokens }
}

function plus(
  a: { musd: bigint; mezo: bigint },
  b: { musd: bigint; mezo: bigint },
) {
  return { musd: a.musd + b.musd, mezo: a.mezo + b.mezo }
}

async function walletModels(owner: Address, gauges: Picked[]) {
  const locks = await locksOf(owner)
  const head = await meta()
  const epoch = epochOf(head.updatedAt)
  const byLock: WalletRewards["byLock"] = []
  const walletLocks: WalletLock[] = []
  let claimable = { musd: 0n, mezo: 0n }
  for (const lock of locks) {
    const votes = await votesOf(lock, gauges)
    const total = votes.reduce((sum, entry) => sum + entry.weight, 0n)
    const lastVoted = await client.readContract({
      address:
        lock.escrow === "vemezo" ? mainnet.boostVoter : mainnet.validatorsVoter,
      abi: VOTER_WRITE_ABI,
      functionName: "lastVoted",
      args: [lock.tokenId],
    })
    const earned = await Promise.all(
      votes.map((entry) => earnedOn(lock, entry.gauge)),
    )
    const lockEarned = ledgerOf(earned.reduce(plus, { musd: 0n, mezo: 0n }))
    claimable = earned.reduce(plus, claimable)
    byLock.push({
      lock: { escrow: lock.escrow, tokenId: `${lock.tokenId}` },
      rewards: lockEarned,
      gauges: votes.map((entry, index) => ({
        gauge: ref(entry.gauge),
        ...ledgerOf(earned[index] ?? { musd: 0n, mezo: 0n }),
      })),
    })
    const expired = !lock.isPermanent && Number(lock.end) <= head.updatedAt
    const symbol = lock.escrow === "vemezo" ? demoTokens.mezo : demoTokens.btc
    walletLocks.push({
      escrow: lock.escrow,
      tokenId: `${lock.tokenId}`,
      tab: expired ? "expired" : lock.escrow,
      locked: { token: symbol, amount: amount(lock.amount), usd: null },
      votingPower: amount(lock.power),
      unlocksAt: lock.isPermanent ? null : Number(lock.end),
      isPermanent: lock.isPermanent,
      isWithdrawable: expired,
      vote:
        Number(lastVoted) >= epoch.start && total > 0n
          ? {
              status: "voted",
              epoch,
              votes: amount(total),
              allocations: votes.map((entry) => ({
                gauge: ref(entry.gauge),
                basisPoints: Number((entry.weight * 10_000n) / total),
              })),
              votedAt: Number(lastVoted),
              // The fork has one voter per test; the reader falls back.
              byVoter: [],
            }
          : { status: "not-voted", epoch },
      claimable: lockEarned,
      projected: null,
      boost: null,
      createdAt: null,
    })
  }
  const ledger = ledgerOf(claimable)
  const overview: WalletOverview =
    walletOverviewResponseSchema.shape.data.parse({
      address: owner.toLowerCase(),
      claimableEpoch: {
        ...epoch,
        number: epoch.number - 1,
        start: epoch.start - week,
        end: epoch.start,
      },
      claimable: ledger,
      locks: walletLocks,
      recentActivity: [],
    })
  const rewards: WalletRewards = walletRewardsResponseSchema.shape.data.parse({
    address: owner.toLowerCase(),
    epoch: {
      number: epoch.number - 1,
      start: epoch.start - week,
      end: epoch.start,
    },
    readyToClaim: ledger,
    byLock,
    earned: { usd: "0", fromEpoch: null, toEpoch: null },
    history: [],
  })
  return { overview, rewards, meta: head }
}

/**
 * Mezo IDs, as the API's resolver answers them (`/internal/scan/mezo-ids`):
 * beef.mezo is the Send recipient; moved.mezo answers that wallet to a
 * display read but another (`movedWallet`) to a fresh read, as an ID
 * pointed elsewhere between typing and review would.
 */
export const sendRecipient = getAddress(
  "0x000000000000000000000000000000000000bEEF",
)
export const movedWallet = getAddress(
  "0x000000000000000000000000000000000000cAFE",
)

function mezoIdAnswer(id: string, fresh: boolean): unknown {
  const wallet =
    id === "beef.mezo"
      ? sendRecipient
      : id === "moved.mezo"
        ? fresh
          ? movedWallet
          : sendRecipient
        : null
  return wallet === null
    ? { data: { status: "not-found" } }
    : {
        data: {
          status: "found",
          mezo_id: id,
          wallets: [wallet.toLowerCase()],
        },
      }
}

export async function startMockApi(port: number): Promise<Server> {
  const gauges = await pickGauges()
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost")
      const parts = url.pathname.split("/").filter(Boolean)
      const send = (status: number, body: unknown): void => {
        response.writeHead(status, { "content-type": "application/json" })
        response.end(JSON.stringify(body))
      }
      if (
        parts[0] === "internal" &&
        parts[1] === "scan" &&
        parts[2] === "mezo-ids" &&
        parts[3] !== undefined
      ) {
        const fresh = url.searchParams.get("fresh") === "1"
        return send(200, mezoIdAnswer(decodeURIComponent(parts[3]), fresh))
      }
      if (parts[0] !== "internal" || parts[1] !== "pro") return send(404, {})
      const [resource, id, view] = parts.slice(2)
      const head = await meta()
      switch (resource) {
        case "head":
          return send(200, {
            data: { block: head.block, timestamp: head.updatedAt },
          })
        case "prices":
          return send(200, { data: demoReadModels.prices })
        case "protocol":
          return send(200, { data: demoReadModels.protocol, meta: head })
        // The shell's market strip (every page's root loader).
        case "summary":
          return send(200, { data: demoReadModels.summary, meta: head })
        case "gauges": {
          const cards = gauges.map(card)
          if (id === undefined) {
            const directory: GaugeDirectory =
              gaugeDirectoryResponseSchema.shape.data.parse({
                epoch: epochOf(head.updatedAt),
                gauges: cards,
                totalVotes: "6970000",
                total: cards.length,
                nextCursor: null,
              })
            return send(200, { data: directory, meta: head })
          }
          const found = cards.find(
            (entry) => entry.gauge.address === id.toLowerCase(),
          )
          if (found === undefined) return send(404, {})
          return send(200, {
            data: { ...demoGaugeProfile, card: found },
            meta: head,
          })
        }
        case "wallets": {
          if (id === undefined) return send(404, {})
          const owner = getAddress(id)
          if (owner === unindexedWallet) return send(404, {})
          // Every owner's locks vote on the picked gauges: the Safe specs
          // move voted locks to Safes and claim there.
          const models = await walletModels(owner, gauges)
          if (view === "overview")
            return send(200, { data: models.overview, meta: models.meta })
          if (view === "rewards")
            return send(200, { data: models.rewards, meta: models.meta })
          if (view === "activity") {
            return send(200, {
              data: {
                address: owner.toLowerCase(),
                rows: [],
                nextCursor: null,
              },
              meta: models.meta,
            })
          }
          return send(404, {})
        }
        default:
          return send(404, {})
      }
    })().catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: String(error) }))
    })
  })
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  )
  return server
}

export type { Picked }
