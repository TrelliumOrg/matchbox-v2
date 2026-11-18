import { canonicalMezoId } from "@matchbox/domain/mezo-id"
import { createServerFn } from "@tanstack/react-start"
import { setResponseHeader } from "@tanstack/react-start/server"
import * as adapt from "./adapters"
import { emptyOverview, emptyRewards } from "./fixture-api"
import {
  type Identity,
  type IdentityLookup,
  readIdentity,
} from "./identity.server"
import {
  activityResponse,
  afterQuery,
  balancesResponse,
  directoryResponse,
  epochReference,
  headResponse,
  liveConfig,
  overviewResponse,
  parseAddress,
  parseCursor,
  parseFilter,
  parseIdentityKey,
  pricesResponse,
  profileResponse,
  protocolActivityResponse,
  protocolEpochResponse,
  protocolResponse,
  rewardsResponse,
  summaryResponse,
  walletRpcUrl,
} from "./inputs.server"
import { readMarketInputs } from "./market-inputs"
import { log, readModel } from "./source.server"

/**
 * Server functions behind every route loader. They run on the Pro Worker,
 * read the API Worker's `/internal/pro/*` routes, validate them with the
 * shared schemas from `@matchbox/contracts/read-models` and map them into
 * the screens' view models, so the browser never talks to `/internal/*` and
 * never downloads zod. Validators are type-only identities.
 */

/**
 * `after`: the block of a transaction the browser just had mined
 * (`tx/fresh-after`), so the answer includes it.
 */
type AfterInput = { after?: number | undefined }

type AddressInput = { address: string } & AfterInput

/**
 * A wallet's overview, or null when the API has no read model for it yet
 * (404). Screens then show their empty states instead of an error.
 */
function walletOverview(address: string, after?: number | undefined) {
  return readModel(
    `/internal/pro/wallets/${address}/overview${afterQuery(after)}`,
    overviewResponse(),
    true,
  )
}

/**
 * The wallet's unlocked BTC and MEZO, read live from the chain by the API.
 * Null when that read fails: balances never break a screen.
 */
function walletBalances(address: string) {
  return readModel(
    `/internal/pro/wallets/${address}/balances`,
    balancesResponse(),
    true,
  )
    .then((found) => found?.data ?? null)
    .catch(() => null)
}

function addressInput(input: AddressInput): AddressInput {
  return input
}

export const getMarket = createServerFn({ method: "GET" }).handler(
  async function getMarketHandler() {
    const { head, prices, degraded } = await readMarketInputs({
      head: async () =>
        (await readModel("/internal/pro/head", headResponse())).data,
      prices: async () =>
        (await readModel("/internal/pro/prices", pricesResponse())).data,
      indexedHead: async () => {
        const { meta } = await readModel(
          "/internal/pro/protocol",
          protocolResponse(),
        )
        return { block: meta.block, timestamp: meta.updatedAt }
      },
    })
    if (degraded.length > 0) {
      log.warn({ message: "market rendered without a read", degraded })
    }
    return {
      market: adapt.market(head, prices, epochReference()),
      live: liveConfig(),
      rpc: walletRpcUrl(),
    }
  },
)

export const getHome = createServerFn({ method: "GET" }).handler(
  async function getHomeHandler() {
    const [summary, top] = await Promise.all([
      readModel("/internal/pro/summary", summaryResponse()),
      readModel(
        "/internal/pro/gauges?funded=true&sort=incentives&limit=4",
        directoryResponse(),
      ),
    ])
    return adapt.home(summary.data, top.data)
  },
)

const directoryPage = 100

/**
 * Every gauge, for Vote's sorting and Optimize: the directory is paged (at
 * most 100 a page, cursors are offsets), so the rest load in parallel after
 * the first page names the total.
 */
export const getGauges = createServerFn({ method: "GET" })
  .validator(function gaugesInput(input: AfterInput | undefined) {
    return input
  })
  .handler(async function getGaugesHandler({ data }) {
    const after = afterQuery(data?.after, "&")
    const first = await readModel(
      `/internal/pro/gauges?limit=${directoryPage}${after}`,
      directoryResponse(),
    )
    const offsets: number[] = []
    for (
      let offset = first.data.gauges.length;
      first.data.nextCursor !== null && offset < first.data.total;
      offset += directoryPage
    ) {
      offsets.push(offset)
    }
    const rest = await Promise.all(
      offsets.map((offset) =>
        readModel(
          `/internal/pro/gauges?limit=${directoryPage}&cursor=${offset}${after}`,
          directoryResponse(),
        ),
      ),
    )
    const pages = [first, ...rest]
    return adapt.gaugeList(
      { ...first.data, gauges: pages.flatMap((page) => page.data.gauges) },
      // The oldest page: every vote total is at least this new.
      Math.min(...pages.map((page) => page.meta.block)),
    )
  })

export const getGauge = createServerFn({ method: "GET" })
  .validator(addressInput)
  .handler(async function getGaugeHandler({ data }) {
    const profile = await readModel(
      `/internal/pro/gauges/${parseAddress(data.address)}${afterQuery(data.after)}`,
      profileResponse(),
      true,
    )
    return profile === null ? null : adapt.gaugeProfile(profile.data)
  })

export const getOverview = createServerFn({ method: "GET" })
  .validator(addressInput)
  .handler(async function getOverviewHandler({ data }) {
    const address = parseAddress(data.address)
    const [overview, balances] = await Promise.all([
      walletOverview(address, data.after),
      walletBalances(address),
    ])
    const reference = epochReference()
    const current = adapt.epochFor(
      overview?.meta.updatedAt ?? Math.floor(Date.now() / 1000),
      reference,
    ).number
    const view = adapt.overview(
      overview?.data ?? emptyOverview(address),
      reference,
      current,
      balances,
    )
    // The voted gauges' display names, from their profiles (a few reads).
    const voted = [
      ...new Set(
        view.locks.flatMap((lock) =>
          lock.votes.map((vote) => vote.gauge.address.toLowerCase()),
        ),
      ),
    ]
    const profiles = await Promise.all(
      voted.map((gauge) =>
        readModel(`/internal/pro/gauges/${gauge}`, profileResponse(), true)
          .then((found) =>
            found === null
              ? null
              : ([gauge, found.data.card.gauge.name] as const),
          )
          .catch(() => null),
      ),
    )
    return adapt.withGaugeNames(
      view,
      new Map(profiles.filter((entry) => entry !== null)),
    )
  })

export const getVoter = createServerFn({ method: "GET" })
  .validator(addressInput)
  .handler(async function getVoterHandler({ data }) {
    const address = parseAddress(data.address)
    const [overview, balances] = await Promise.all([
      walletOverview(address, data.after),
      walletBalances(address),
    ])
    return adapt.voter(overview?.data ?? emptyOverview(address), balances)
  })

export const getRewards = createServerFn({ method: "GET" })
  .validator(addressInput)
  .handler(async function getRewardsHandler({ data }) {
    const address = parseAddress(data.address)
    // The projection lives on the overview read model (summed over locks).
    const [rewards, overview] = await Promise.all([
      readModel(
        `/internal/pro/wallets/${address}/rewards${afterQuery(data.after)}`,
        rewardsResponse(),
        true,
      ),
      walletOverview(address, data.after),
    ])
    const view = adapt.rewards(rewards?.data ?? emptyRewards(address))
    const projected = overview?.data.projected ?? null
    if (projected === null || !/[1-9]/.test(projected.usd)) return view
    const epoch = adapt.epochFor(
      overview?.meta.updatedAt ?? Math.floor(Date.now() / 1000),
      epochReference(),
    )
    return {
      ...view,
      projected: {
        epoch: epoch.number,
        usd: projected.usd,
        paysAt: epoch.endsAt,
      },
    }
  })

export const getActivity = createServerFn({ method: "GET" })
  .validator(function activityInput(input: {
    address: string
    filter: string
    /** The page after this one: a page's `nextCursor`. */
    cursor?: string | undefined
  }) {
    return input
  })
  .handler(async function getActivityHandler({ data }) {
    const filter = parseFilter(data.filter)
    const query = new URLSearchParams()
    if (filter !== "all") query.set("category", filter)
    const cursor = parseCursor(data.cursor)
    if (cursor !== null) query.set("cursor", cursor)
    const search = query.size === 0 ? "" : `?${query}`
    const address = parseAddress(data.address)
    const page = await readModel(
      `/internal/pro/wallets/${address}/activity${search}`,
      activityResponse(),
      true,
    )
    return adapt.activityPage(
      page?.data ?? { address, rows: [], nextCursor: null },
      epochReference(),
    )
  })

export const getProtocol = createServerFn({ method: "GET" })
  .validator(function protocolInput(input: { epoch: number | null }) {
    return input
  })
  .handler(async function getProtocolHandler({ data: input }) {
    const protocol = await readModel(
      "/internal/pro/protocol",
      protocolResponse(),
    )
    const requested = input.epoch
    if (requested === null || requested === protocol.data.epoch.number) {
      return adapt.protocol(protocol.data)
    }
    // A past epoch: its snapshot, or only its bar when there is none.
    const snapshot = await readModel(
      `/internal/pro/protocol/epochs/${requested}`,
      protocolEpochResponse(),
      true,
    )
    return adapt.protocol(protocol.data, {
      epoch: requested,
      snapshot: snapshot?.data ?? null,
    })
  })

const protocolCategories = [
  "votes",
  "claims",
  "locks",
  "incentives",
  "system",
] as const

/**
 * A page of everyone's activity for Protocol's "Load more" and filters.
 * An API without the document yet answers 404: an empty last page, so the
 * section keeps the rows it painted with and offers nothing more.
 */
export const getProtocolActivity = createServerFn({ method: "GET" })
  .validator(function protocolActivityInput(input: {
    /** One of the API's categories; anything else reads every row. */
    category: string | null
    /** The page after this row: a page's `nextCursor` or a row id. */
    cursor: string | null
  }) {
    return input
  })
  .handler(async function getProtocolActivityHandler({ data }) {
    const query = new URLSearchParams()
    const category = protocolCategories.find((known) => known === data.category)
    if (category !== undefined) query.set("category", category)
    const cursor = parseCursor(data.cursor)
    if (cursor !== null) query.set("cursor", cursor)
    const search = query.size === 0 ? "" : `?${query}`
    const page = await readModel(
      `/internal/pro/protocol/activity${search}`,
      protocolActivityResponse(),
      true,
    )
    return adapt.protocolActivityPage(
      page?.data ?? { rows: [], nextCursor: null },
    )
  })

/** A token the wallet holds beyond BTC, MEZO and MUSD. */
export type OtherToken = {
  address: string
  symbol: string
  name: string
  /** Decimal string in the token's units. */
  amount: string
  /** Null when the token has no price. */
  usd: string | null
}

/**
 * The wallet's other registered tokens (mUSDC, sMUSD, SolvBTC, ...) for the
 * Account panel, largest value first as the API lists them. Empty when the
 * read fails: the panel still shows BTC, MEZO and MUSD from the RPC.
 */
export const getOtherTokens = createServerFn({ method: "GET" })
  .validator(function otherTokensInput(input: { address: string }) {
    return input
  })
  .handler(async function getOtherTokensHandler({
    data,
  }): Promise<OtherToken[]> {
    const balances = await walletBalances(parseAddress(data.address))
    return (balances?.tokens ?? []).map((held) => ({
      address: held.token.address,
      symbol: held.token.symbol,
      name: held.token.name,
      amount: held.amount,
      usd: held.usd,
    }))
  })

/** A wallet's Mezo ID, or the wallet a Mezo ID names. */
export type { Identity, IdentityLookup }

/**
 * Looks up `key` (an address or "pyke.mezo", see identity.server) for
 * display: found, not found, or unavailable. Never throws.
 */
export const getIdentity = createServerFn({ method: "GET" })
  .validator(function identityInput(input: { key: string }) {
    return input
  })
  .handler(async function getIdentityHandler({
    data,
  }): Promise<IdentityLookup> {
    const key = parseIdentityKey(data.key)
    return key === null ? { status: "not-found" } : readIdentity(key)
  })

/**
 * A Mezo ID's wallet as Mezo answers it now, past every stored answer
 * (the API's `?fresh=1`), answered no-store: what a transfer sends to.
 */
export const getFreshIdentity = createServerFn({ method: "GET" })
  .validator(function freshIdentityInput(input: { id: string }) {
    return input
  })
  .handler(async function getFreshIdentityHandler({
    data,
  }): Promise<IdentityLookup> {
    setResponseHeader("cache-control", "private, no-store")
    const id = canonicalMezoId(typeof data.id === "string" ? data.id : "")
    return id === null
      ? { status: "not-found" }
      : readIdentity(id, { fresh: true })
  })
