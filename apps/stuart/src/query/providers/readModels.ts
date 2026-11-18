import {
  type ChainHead,
  chainHeadSchema,
  type GaugeCard,
  type GaugeConsistencyRanking,
  type GaugeDirectoryResponse,
  type GaugeKind,
  type GaugeProfileResponse,
  gaugeConsistencyRankingSchema,
  gaugeDirectoryResponseSchema,
  gaugeProfileResponseSchema,
  type Prices,
  type ProSummaryResponse,
  pricesResponseSchema,
  proSummaryResponseSchema,
  readModelResponseSchema,
  type WalletOverviewResponse,
  type WalletRewardsResponse,
  walletOverviewResponseSchema,
  walletRewardsResponseSchema,
} from "@matchbox/contracts/read-models"
import {
  demoChainHead,
  demoGaugeDirectory,
  demoGaugeProfile,
  demoMeta,
  demoPrices,
  demoSummary,
  demoWalletOverview,
  demoWalletRewards,
} from "@matchbox/contracts/read-models/fixtures"
import type { VoteBranch } from "@matchbox/stuart-ui/contract"
import { z } from "zod"

// The API Worker's `/internal/pro/*` read models (the same documents Pro
// renders), through the `API` service binding, validated with the
// @matchbox/contracts schemas. Without a binding (local dev, tests) the
// shared demo fixtures answer instead, so Stuart works end to end.

export type ReadModelSource = {
  kind: "api" | "fixture"
  /** Every gauge of one voter, all pages. */
  gauges: (voter: VoteBranch) => Promise<GaugeDirectoryResponse>
  /** The current epoch and snapshot, from a one-gauge page. */
  epoch: () => Promise<GaugeDirectoryResponse>
  /** Null when the API has no profile for the gauge (404). */
  gaugeProfile: (gauge: string) => Promise<GaugeProfileResponse | null>
  /** Null when the API has no document for the wallet (404). */
  walletOverview: (wallet: string) => Promise<WalletOverviewResponse | null>
  walletRewards: (wallet: string) => Promise<WalletRewardsResponse | null>
  prices: () => Promise<Prices>
  head: () => Promise<ChainHead>
  /** Protocol totals for the current epoch (the signed-out summary). */
  summary: () => Promise<ProSummaryResponse>
  /** Gauges matching a name or address prefix, by votes. */
  searchGauges: (query: string, limit: number) => Promise<GaugeCard[]>
  /** A wallet's Mezo ID, or null without one (or when the lookup fails). */
  identity: (address: string) => Promise<string | null>
  /** Most consistently funded gauges; null until the API serves it (404). */
  consistency: (
    kind: GaugeKind | null,
    limit: number,
  ) => Promise<{ data: GaugeConsistencyRanking } | null>
}

// `/internal/pro/wallets/{address}/identity`: only the Mezo ID is read.
const identityResponseSchema = z.object({
  data: z.object({ mezoId: z.string().min(1).nullable() }),
})

const consistencyResponseSchema = readModelResponseSchema(
  gaugeConsistencyRankingSchema,
)

// The chain head changes about every 3.5 seconds; questions arriving in a
// burst share one read per isolate instead of one each.
const HEAD_TTL_MS = 2_000
let headMemo: { at: number; value: Promise<ChainHead> } | null = null

/** The slice of a Workers `Fetcher` (service binding) Stuart uses. */
export type ApiFetcher = {
  fetch: (input: Request) => Promise<Response>
}

export class ReadModelError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.status = status
  }
}

// The host is ignored by a service binding; it names the target in logs.
const API_ORIGIN = "https://matchbox-developer-api"
const TIMEOUT_MS = 5_000
// The API pages the directory (100 gauges at most per page); 780 gauges
// across all voters on 8 Nov 2026.
const MAX_DIRECTORY_PAGES = 20

const headResponseSchema = z.object({ data: chainHeadSchema })

async function getJson<T>(
  api: ApiFetcher,
  path: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const response = await api.fetch(
    new Request(`${API_ORIGIN}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  )
  if (response.status === 404) return null
  if (!response.ok) {
    throw new ReadModelError(
      `${path} answered ${response.status}`,
      response.status,
    )
  }
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) {
    throw new ReadModelError(
      `${path} did not match its schema`,
      response.status,
    )
  }
  return parsed.data
}

async function required<T>(
  api: ApiFetcher,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const value = await getJson(api, path, schema)
  if (value === null) throw new ReadModelError(`${path} is missing`, 404)
  return value
}

/** Every gauge of one voter, following `nextCursor` across pages. */
async function allGauges(
  api: ApiFetcher,
  voter: VoteBranch,
): Promise<GaugeDirectoryResponse> {
  const base = `/internal/pro/gauges?voter=${voter}&limit=100`
  const first = await required(api, base, gaugeDirectoryResponseSchema)
  let cursor = first.data.nextCursor
  const gauges = [...first.data.gauges]
  for (let page = 1; cursor !== null && page < MAX_DIRECTORY_PAGES; page += 1) {
    const next = await required(
      api,
      `${base}&cursor=${encodeURIComponent(cursor)}`,
      gaugeDirectoryResponseSchema,
    )
    gauges.push(...next.data.gauges)
    cursor = next.data.nextCursor
  }
  return {
    data: { ...first.data, gauges, nextCursor: null },
    meta: first.meta,
  }
}

function lower(address: string): string {
  return address.toLowerCase()
}

export function createApiReadModels(api: ApiFetcher): ReadModelSource {
  return {
    kind: "api",
    gauges: (voter) => allGauges(api, voter),
    epoch: () =>
      required(
        api,
        "/internal/pro/gauges?limit=1",
        gaugeDirectoryResponseSchema,
      ),
    gaugeProfile: (gauge) =>
      getJson(
        api,
        `/internal/pro/gauges/${lower(gauge)}`,
        gaugeProfileResponseSchema,
      ),
    walletOverview: (wallet) =>
      getJson(
        api,
        `/internal/pro/wallets/${lower(wallet)}/overview`,
        walletOverviewResponseSchema,
      ),
    walletRewards: (wallet) =>
      getJson(
        api,
        `/internal/pro/wallets/${lower(wallet)}/rewards`,
        walletRewardsResponseSchema,
      ),
    prices: async () =>
      (await required(api, "/internal/pro/prices", pricesResponseSchema)).data,
    head: () => {
      const now = Date.now()
      if (headMemo !== null && now - headMemo.at < HEAD_TTL_MS) {
        return headMemo.value
      }
      const value = required(
        api,
        "/internal/pro/head",
        headResponseSchema,
      ).then((response) => response.data)
      headMemo = { at: now, value }
      value.catch(() => {
        headMemo = null
      })
      return value
    },
    searchGauges: async (query, limit) => {
      const page = await required(
        api,
        `/internal/pro/gauges?q=${encodeURIComponent(query)}&limit=${limit}&sort=votes`,
        gaugeDirectoryResponseSchema,
      )
      return page.data.gauges
    },
    identity: async (address) => {
      const found = await getJson(
        api,
        `/internal/pro/wallets/${lower(address)}/identity`,
        identityResponseSchema,
      )
      return found?.data.mezoId ?? null
    },
    consistency: (kind, limit) =>
      getJson(
        api,
        `/internal/pro/gauges/consistency?limit=${limit}${kind === null ? "" : `&kind=${kind}`}`,
        consistencyResponseSchema,
      ),
    summary: () =>
      required(api, "/internal/pro/summary", proSummaryResponseSchema),
  }
}

/** The shared demo data: one profiled gauge and one wallet. */
export function createFixtureReadModels(): ReadModelSource {
  const profiled = lower(demoGaugeProfile.card.gauge.address)
  const wallet = lower(demoWalletOverview.address)
  return {
    kind: "fixture",
    gauges: async (voter) => ({
      data: {
        ...demoGaugeDirectory,
        gauges: demoGaugeDirectory.gauges.filter(
          (card) => card.gauge.voter === voter,
        ),
      },
      meta: demoMeta,
    }),
    epoch: async () => ({ data: demoGaugeDirectory, meta: demoMeta }),
    gaugeProfile: async (gauge) =>
      lower(gauge) === profiled
        ? { data: demoGaugeProfile, meta: demoMeta }
        : null,
    walletOverview: async (address) =>
      lower(address) === wallet
        ? { data: demoWalletOverview, meta: demoMeta }
        : null,
    walletRewards: async (address) =>
      lower(address) === wallet
        ? { data: demoWalletRewards, meta: demoMeta }
        : null,
    prices: async () => demoPrices,
    head: async () => demoChainHead,
    summary: async () => ({ data: demoSummary, meta: demoMeta }),
    consistency: async () => null,
    searchGauges: async (query, limit) => {
      const text = query.toLowerCase()
      return demoGaugeDirectory.gauges
        .filter(
          (card) =>
            card.gauge.name.toLowerCase().includes(text) ||
            card.gauge.address.toLowerCase().startsWith(text),
        )
        .slice(0, limit)
    },
    identity: async () => null,
  }
}
