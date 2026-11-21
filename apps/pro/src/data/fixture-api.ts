import {
  type ActivityCategory,
  type ActivityRow,
  type Allocation,
  activityCategorySchema,
  activityTypesIn,
  type GaugeDetails,
  type GaugeDirectory,
  type GaugeProfileReadModel,
  type ProSummary,
  type Protocol,
  type ProtocolEpoch,
  type ReadModelMeta,
  type WalletActivity,
  type WalletOverview,
  type WalletRewards,
  walletOverviewSchema,
} from "@matchbox/contracts/read-models"
import {
  demoChainHead,
  demoEpoch,
  demoGaugeDetails,
  demoGaugeProfile,
  demoGauges,
  demoMeta,
  demoReadModels,
  demoTokens,
  demoWallet,
} from "@matchbox/contracts/read-models/fixtures"
import { epochStartOf } from "@matchbox/domain"
import { canonicalMezoId } from "@matchbox/domain/mezo-id"
import {
  fixtureGaugeDirectory,
  liveSizedGaugeDirectory,
  poolsOnlyGaugeDirectory,
  smallPoolGauges,
  unpricedPoolGauges,
} from "./fixture-gauges"
import {
  historyActivity,
  historyRewards,
  isHistoryWallet,
} from "./fixture-history"

/**
 * Answers the API Worker's `/internal/pro/*` paths from the shared demo
 * fixtures (`@matchbox/contracts/read-models/fixtures`), in the same
 * `{ data, meta }` envelopes and status codes, so `PRO_DATA=fixtures`
 * exercises the same schemas and adapters as production. The demo wallet
 * has the Epoch 47 data; any other address is an empty wallet.
 */

export type FixtureResponse = { status: 200; body: unknown } | { status: 404 }

/** The demo epoch numbering, now the chain's (Epoch 47 starts Thu 5 Nov 2026). */
export const fixtureEpochReference = {
  number: 47,
  start: demoEpoch(47).start,
}

let anchorMs: number | null = null

/**
 * The demo overview with its votes moved into the live epoch. The screens
 * compare a vote's time with the real clock to decide "Voted this epoch",
 * so a vote pinned to the demo week stopped counting when Epoch 48 began
 * (12 Nov 2026) and the demo lost its voted lock. A vote cast in the demo's
 * current epoch keeps its place in the week, but never lands in the future;
 * votes from earlier epochs stay where they are.
 */
export function liveOverview(
  overview: WalletOverview,
  nowMs: number,
): WalletOverview {
  const now = Math.floor(nowMs / 1000)
  const liveStart = epochStartOf(now)
  const demoStart = fixtureEpochReference.start
  if (liveStart <= demoStart) return overview
  return {
    ...overview,
    locks: overview.locks.map((lock) => {
      const vote = lock.vote
      if (vote.status !== "voted" || vote.votedAt < demoStart) return lock
      const moved = (at: number): number =>
        at < demoStart ? at : Math.min(liveStart + (at - demoStart), now)
      // Each voter's own time moves too: Vote reads "voted this epoch"
      // per voter, and a vote left in the demo week no longer counted
      // (the smoke test's "Save for Epoch 48" failed, 12 Nov 2026).
      return {
        ...lock,
        vote: {
          ...vote,
          votedAt: moved(vote.votedAt),
          byVoter: vote.byVoter.map((each) => ({
            ...each,
            votedAt: moved(each.votedAt),
          })),
        },
      }
    }),
  }
}

function envelope(
  data: unknown,
  meta: ReadModelMeta = demoMeta,
): FixtureResponse {
  return { status: 200, body: { data, meta } }
}

/** A wallet with nothing indexed: no locks, nothing to claim. */
export function emptyOverview(address: string): WalletOverview {
  // Parsed so fields the schema defaults (projected, suggestion) fill in.
  return walletOverviewSchema.parse({
    address,
    claimableEpoch: null,
    claimable: { usd: "0", tokens: [] },
    locks: [],
    recentActivity: [],
  })
}

/**
 * A wallet with two veMEZO locks, neither voted this epoch: Vote's ballot
 * for two locks, with Review and sign (the demo wallet's one veMEZO lock
 * voted, so it saves instead).
 */
export const twoLockWallet = `0x2b0c${"0".repeat(32)}0002`

function twoLockOverview(): WalletOverview {
  const demo = demoReadModels.overview
  const vemezo = demo.locks.find((lock) => lock.escrow === "vemezo")
  if (vemezo === undefined) throw new Error("the demo has a veMEZO lock")
  const fresh = {
    ...vemezo,
    vote: { status: "not-voted", epoch: vemezo.vote.epoch },
    claimable: { usd: "0", tokens: [] },
    projected: null,
  } as const
  return walletOverviewSchema.parse({
    ...emptyOverview(twoLockWallet),
    locks: [
      { ...fresh, tokenId: "1485" },
      { ...fresh, tokenId: "2631", votingPower: "6374" },
    ],
  })
}

/**
 * A wallet like the live one with veBTC lock #6033 (19 Nov 2026): its
 * veBTC lock has a boost gauge in the directory, so the card draws the
 * boost band, and it voted this epoch across every validator and pool
 * gauge. The demo wallet's veBTC lock has no boost, which is how a
 * CSP violation and a hydration error on the band reached production
 * unseen, and how a strip of 30 gauge pictures overflowed its card.
 */
export const boostedWallet = `0x6033${"0".repeat(32)}0003`

/** The boost gauge's token id in the fixture directory (Forge Partners). */
export const boostedLockId = "700"

function boostedVote(): {
  votes: string
  allocations: Allocation[]
  byVoter: { voter: "validators" | "pools"; allocations: Allocation[] }[]
} {
  const voted = fixtureGaugeDirectory.gauges.filter(
    (card) =>
      card.isAlive &&
      (card.gauge.voter === "validators" || card.gauge.voter === "pools"),
  )
  const byVoter = (["validators", "pools"] as const).map((voter) => {
    const gauges = voted.filter((card) => card.gauge.voter === voter)
    const each = Math.floor(10_000 / gauges.length)
    return {
      voter,
      allocations: gauges.map((card, index) => ({
        gauge: card.gauge,
        basisPoints: index === 0 ? 10_000 - each * (gauges.length - 1) : each,
      })),
    }
  })
  return {
    votes: "2.4000",
    // Shares of both voters together: each voter's half.
    allocations: byVoter.flatMap((entry) =>
      entry.allocations.map((allocation) => ({
        gauge: allocation.gauge,
        basisPoints: Math.floor(allocation.basisPoints / 2),
      })),
    ),
    byVoter,
  }
}

/** When the boosted lock voted: in the demo's epoch, moved to the live one. */
const boostedVotedAt = fixtureEpochReference.start + 26 * 3600

function boostedOverview(nowMs: number): WalletOverview {
  const vote = boostedVote()
  return liveOverview(
    walletOverviewSchema.parse({
      ...emptyOverview(boostedWallet),
      recentActivity: boostedActivityRows(),
      locks: [
        {
          escrow: "vebtc",
          tokenId: boostedLockId,
          tab: "vebtc",
          locked: { token: demoTokens.btc, amount: "1.2000", usd: "126852.00" },
          votingPower: "1.2000",
          unlocksAt: null,
          isPermanent: true,
          isWithdrawable: false,
          vote: {
            status: "voted",
            epoch: demoEpoch(fixtureEpochReference.number),
            votes: vote.votes,
            allocations: vote.allocations,
            votedAt: boostedVotedAt,
            byVoter: vote.byVoter.map((entry) => ({
              ...entry,
              votes: "1.2000",
              votedAt: boostedVotedAt,
            })),
          },
          claimable: { usd: "0", tokens: [] },
          projected: null,
          boost: "1.8",
          createdAt: fixtureEpochReference.start - 90 * 86_400,
        },
      ],
    }),
    nowMs,
  )
}

/** The boosted wallet's activity: its vote across every gauge. */
function boostedActivityRows(): ActivityRow[] {
  const vote = boostedVote()
  return [
    {
      type: "vote",
      id: `0x${"60".repeat(32)}-0`,
      txHash: `0x${"60".repeat(32)}`,
      block: demoChainHead.block - 100,
      timestamp: boostedVotedAt,
      status: "confirmed",
      actor: boostedWallet,
      lock: { escrow: "vebtc", tokenId: boostedLockId },
      epoch: demoEpoch(fixtureEpochReference.number),
      votes: vote.votes,
      allocations: vote.allocations,
    },
  ]
}

export function emptyRewards(address: string): WalletRewards {
  return {
    address,
    epoch: null,
    readyToClaim: { usd: "0", tokens: [] },
    byLock: [],
    earned: { usd: "0", fromEpoch: null, toEpoch: null },
    history: [],
  }
}

/** Tokens beyond BTC, MEZO and MUSD, as the balances route lists them. */
const otherTokensFixture = [
  {
    token: {
      address: `0x${"5c".repeat(20)}`,
      symbol: "sMUSD",
      name: "Savings MUSD",
      decimals: 18,
    },
    amount: "620.00",
    usd: "634.88",
  },
  {
    token: {
      address: `0x${"6d".repeat(20)}`,
      symbol: "mUSDC",
      name: "Mezo USDC",
      decimals: 6,
    },
    amount: "150.00",
    usd: "150.00",
  },
]

/**
 * Everyone's activity as the API stores it: the protocol document's rows,
 * then the same rows again as older ones, so "Load more" has pages to read.
 */
const protocolActivityRows: ActivityRow[] = Array.from(
  { length: 5 },
  (_, copy) =>
    demoReadModels.protocol.feed.rows.map((row) =>
      copy === 0
        ? row
        : {
            ...row,
            id: `${row.id}-older-${copy}`,
            timestamp: row.timestamp - copy * 21_600,
          },
    ),
).flat()

function protocolActivity(
  category: ActivityCategory | null,
  cursor: string | null,
  limit: number,
): { rows: ActivityRow[]; nextCursor: string | null } {
  const types = category === null ? null : new Set(activityTypesIn(category))
  const rows = protocolActivityRows.filter(
    (row) => types === null || types.has(row.type),
  )
  const start =
    cursor === null ? 0 : rows.findIndex((row) => row.id === cursor) + 1
  const page = rows.slice(start, start + limit)
  const last = page.at(-1)
  return {
    rows: page,
    nextCursor:
      start + limit < rows.length && last !== undefined ? last.id : null,
  }
}

/**
 * Paged like the API: `cursor` is the id of the last row of the page
 * before, `limit` rows a page (25 unless asked), `nextCursor` while more
 * remain.
 */
function activity(
  address: string,
  category: ActivityCategory | null,
  cursor: string | null,
  limit: number,
): WalletActivity {
  const own = isDemo(address)
    ? demoReadModels.activity.rows
    : address.toLowerCase() === boostedWallet
      ? boostedActivityRows()
      : null
  if (own === null) return { address, rows: [], nextCursor: null }
  const types = category === null ? null : new Set(activityTypesIn(category))
  const rows = own.filter((row) => types === null || types.has(row.type))
  const start =
    cursor === null ? 0 : rows.findIndex((row) => row.id === cursor) + 1
  const page = rows.slice(start, start + limit)
  const last = page.at(-1)
  return {
    address,
    rows: page,
    nextCursor:
      start + limit < rows.length && last !== undefined ? last.id : null,
  }
}

/** The demo gauges that have full details, by address. */
const detailsByAddress = new Map<string, GaugeDetails>(
  Object.entries(demoGaugeDetails).flatMap(([name, details]) => {
    const gauge = Object.entries(demoGauges).find(([key]) => key === name)?.[1]
    return gauge === undefined ? [] : [[gauge.address.toLowerCase(), details]]
  }),
)

/** Every gauge has a profile; the cards without one get an empty profile. */
function profile(address: string): GaugeProfileReadModel | null {
  const id = address.toLowerCase()
  const details = detailsByAddress.get(id) ?? null
  if (demoGaugeProfile.card.gauge.address === id) {
    return { ...demoGaugeProfile, details }
  }
  const card = fixtureGaugeDirectory.gauges.find(
    (entry) => entry.gauge.address === id,
  )
  if (card === undefined) return null
  return {
    card,
    description: null,
    tags: [],
    links: [],
    owner: null,
    locked: null,
    votingStrategy: null,
    incentiveStrategy: null,
    // The small pool gauges' APY rose, as the API says of mainnet's: Pro
    // shows neither the APY nor its change.
    apyChange: Object.values(smallPoolGauges).includes(card) ? "12.57" : null,
    votesHistory: [],
    incentivesHistory: [],
    details,
  }
}

/**
 * The summary for the directory fixtures mode serves: its gauges, and the
 * funded ones by the API's rule (any incentive token), dust included.
 */
const fixtureSummary: ProSummary = {
  ...demoReadModels.summary,
  gaugeCount: fixtureGaugeDirectory.gauges.length,
  fundedCount: fixtureGaugeDirectory.gauges.filter(
    (card) => card.isAlive && card.incentives.tokens.length > 0,
  ).length,
}

/**
 * Protocol's funded list with mainnet's small rows after the demo's (P6):
 * $0.28, which Pro counts as funded, and dust below a cent, which it
 * leaves out of the list and the count. Then the unpriced and mixed
 * gauges, which Pro lists, and the unregistered one, which it leaves out.
 */
const protocolExtras = [
  smallPoolGauges.tiny,
  unpricedPoolGauges.mixed,
  unpricedPoolGauges.unpriced,
  smallPoolGauges.dust,
  unpricedPoolGauges.unregistered,
]

const fixtureProtocol: Protocol = {
  ...demoReadModels.protocol,
  funded: {
    count: demoReadModels.protocol.funded.count + protocolExtras.length,
    gauges: [
      ...demoReadModels.protocol.funded.gauges,
      ...protocolExtras.map((card) => ({
        gauge: card.gauge,
        incentives: card.incentives,
        deposits: 1,
      })),
    ],
  },
}

/** A past epoch's snapshot, from its bar of the demo chart. */
function protocolEpoch(number: number): ProtocolEpoch | null {
  const bars = demoReadModels.protocol.incentivesByEpoch
  const index = bars.findIndex((bar) => bar.epoch.number === number)
  const bar = bars[index]
  if (bar === undefined) return null
  const previous = bars[index - 1]
  return {
    epoch: bar.epoch,
    incentives: {
      usd: bar.totalUsd,
      previousUsd: previous?.totalUsd ?? null,
      changeUsd: null,
    },
    byVoter: bar,
    funded: fixtureProtocol.funded,
    deposits: 0,
    stats: null,
  }
}

function isDemo(address: string): boolean {
  return address.toLowerCase() === demoWallet
}

/** The demo wallet is pyke.mezo; other addresses have no Mezo ID. */
export const demoMezoId = "pyke.mezo"

/** The Mezo ID the fixtures answer as Mezo's API down. */
export const fixtureDownMezoId = "down.mezo"

/**
 * `/internal/pro/wallets/{address}/identity`. Like the API's route it
 * takes an address only: anything else, a Mezo ID included, is a 404.
 */
function identityFixture(key: string, nowMs: number): FixtureResponse {
  const name = key.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(name)) return { status: 404 }
  const found = isDemo(name)
  return {
    status: 200,
    body: {
      data: {
        address: found ? demoWallet : name,
        status: found ? "found" : "not-found",
        mezoId: found ? demoMezoId : null,
        linkedAccounts: [],
      },
      meta: {
        source: "mezo-accounts",
        checkedAt: Math.floor(nowMs / 1000),
      },
    },
  }
}

/**
 * `/internal/scan/mezo-ids/{key}`, the API's Mezo ID resolver, in its own
 * shapes: pyke.mezo is the demo wallet, down.mezo plays Mezo's API down
 * (the API answers that 200 and unstored), any other well-formed ID or
 * address is not found, and a key that is neither is the route's 404.
 */
function mezoIdFixture(key: string): FixtureResponse {
  const lower = key.toLowerCase()
  if (/^0x[0-9a-f]{40}$/.test(lower)) {
    return {
      status: 200,
      body: {
        data: isDemo(lower)
          ? { status: "found", mezo_id: demoMezoId, wallets: [demoWallet] }
          : { status: "not-found" },
      },
    }
  }
  const id = canonicalMezoId(key)
  if (id === null) return { status: 404 }
  if (id === fixtureDownMezoId) {
    return { status: 200, body: { data: { status: "unavailable" } } }
  }
  return {
    status: 200,
    body: {
      data:
        id === demoMezoId
          ? { status: "found", mezo_id: id, wallets: [demoWallet] }
          : { status: "not-found" },
    },
  }
}

/**
 * The directory as the API pages it, for the options Pro sends: `funded`,
 * `sort=incentives` and `limit`. Anything else is the whole demo directory.
 */
function directoryPage(
  query: URLSearchParams,
  directory: GaugeDirectory,
): GaugeDirectory {
  let gauges = directory.gauges
  if (query.get("funded") === "true") {
    gauges = gauges.filter(
      (card) => card.isAlive && card.incentives.tokens.length > 0,
    )
  }
  if (query.get("sort") === "incentives") {
    gauges = [...gauges].sort(
      (left, right) =>
        Number(right.incentives.usd) - Number(left.incentives.usd),
    )
  }
  const total = gauges.length
  const limit = Number(query.get("limit") ?? total)
  const size = Number.isFinite(limit) && limit > 0 ? limit : total
  // The cursor is the offset of the page, as the API's is. Without it the
  // fixtures could never serve more than one page (100 gauges), which a
  // directory the size of mainnet's needs.
  const offset = Number(query.get("cursor") ?? 0)
  const start = Number.isInteger(offset) && offset > 0 ? offset : 0
  return {
    ...directory,
    gauges: gauges.slice(start, start + size),
    total,
    nextCursor: start + size < total ? String(start + size) : null,
  }
}

/** What a request may ask of the fixtures beyond its path. */
export type FixtureOptions = {
  /**
   * `live`: the gauge directory at mainnet's size, for measuring what Vote
   * inlines. `pools-only`: only pool gauges funded, as in Epoch 49.
   * Everything else is the same.
   */
  directory?: "live" | "pools-only" | undefined
}

export function fixtureResponse(
  path: string,
  nowMs: number,
  options: FixtureOptions = {},
): FixtureResponse {
  const url = new URL(path, "https://fixtures.invalid")
  const parts = url.pathname.split("/").filter(Boolean)
  if (parts[0] === "internal" && parts[1] === "scan") {
    const [, , route, key, ...rest] = parts
    return route === "mezo-ids" && key !== undefined && rest.length === 0
      ? mezoIdFixture(decodeURIComponent(key))
      : { status: 404 }
  }
  if (parts[0] !== "internal" || parts[1] !== "pro") return { status: 404 }
  const [resource, id, view] = parts.slice(2)
  anchorMs ??= nowMs
  const elapsed = Math.max(0, nowMs - anchorMs)
  switch (resource) {
    case "prices":
      return { status: 200, body: { data: demoReadModels.prices } }
    case "head":
      return {
        status: 200,
        body: {
          data: {
            block: demoChainHead.block + Math.floor(elapsed / 3800),
            timestamp: demoChainHead.timestamp + Math.floor(elapsed / 1000),
          },
        },
      }
    case "summary":
      return envelope(fixtureSummary)
    case "gauges": {
      if (id === undefined) {
        return envelope(
          directoryPage(
            url.searchParams,
            options.directory === "live"
              ? liveSizedGaugeDirectory()
              : options.directory === "pools-only"
                ? poolsOnlyGaugeDirectory()
                : fixtureGaugeDirectory,
          ),
        )
      }
      const found = profile(id)
      return found === null ? { status: 404 } : envelope(found)
    }
    case "protocol": {
      if (id === "activity") {
        const category = activityCategorySchema.safeParse(
          url.searchParams.get("category"),
        )
        return envelope(
          protocolActivity(
            category.success ? category.data : null,
            url.searchParams.get("cursor"),
            25,
          ),
        )
      }
      if (id !== "epochs") return envelope(fixtureProtocol)
      const snapshot = protocolEpoch(Number(view))
      return snapshot === null ? { status: 404 } : envelope(snapshot)
    }
    case "wallets": {
      if (id === undefined) return { status: 404 }
      switch (view) {
        case "overview":
          return envelope(
            isDemo(id)
              ? liveOverview(demoReadModels.overview, nowMs)
              : id.toLowerCase() === twoLockWallet
                ? twoLockOverview()
                : id.toLowerCase() === boostedWallet
                  ? boostedOverview(nowMs)
                  : emptyOverview(id),
          )
        case "balances":
          // Every wallet holds the demo balances, so a wallet with no
          // locks shows what it could lock.
          return envelope({
            ...demoReadModels.balances,
            address: id,
            tokens: otherTokensFixture,
          })
        case "rewards":
          return envelope(
            isDemo(id)
              ? demoReadModels.rewards
              : isHistoryWallet(id)
                ? historyRewards(id, nowMs)
                : emptyRewards(id),
          )
        case "activity": {
          const category = activityCategorySchema.safeParse(
            url.searchParams.get("category"),
          )
          const limit = Number(url.searchParams.get("limit") ?? 25)
          if (isHistoryWallet(id)) {
            return envelope(
              historyActivity(
                id,
                category.success ? category.data : null,
                url.searchParams.get("cursor"),
                Number.isInteger(limit) && limit > 0 ? limit : 25,
                nowMs,
              ),
            )
          }
          return envelope(
            activity(
              id,
              category.success ? category.data : null,
              url.searchParams.get("cursor"),
              Number.isInteger(limit) && limit > 0 ? limit : 25,
            ),
          )
        }
        case "identity":
          return identityFixture(decodeURIComponent(id), nowMs)
        default:
          return { status: 404 }
      }
    }
    default:
      return { status: 404 }
  }
}
