import type { GaugeProfile } from "@matchbox/contracts/gauge-profiles"
import type { NetworkSlug } from "@matchbox/contracts/network"
import type { Logger } from "@matchbox/logger"
import type { MarketStore } from "../market/store"
import type { ApiStore } from "../store/api-store"
import {
  type PublicProfileSource,
  readPublicProfiles,
} from "../store/public-profiles"
import {
  type AvatarFetch,
  avatarTargets,
  type ExtractBudget,
  resolveAvatarColors,
} from "./avatar-colors/extract"
import type { GaugeDetailsReader } from "./gauge-details"
import type { GaugeLabelReader } from "./gauge-labels"
import { buildGaugeReadModels, type GaugeChainReader } from "./gauges"
import { readPricesFromKv } from "./prices-kv"
import { type ReadDatabase, writeReadModels } from "./store"

export { pricesKvKey, readPricesFromKv } from "./prices-kv"

/** Every curated profile on `network`, following cursors. */
async function allProfiles(
  store: ApiStore,
  network: NetworkSlug,
): Promise<GaugeProfile[]> {
  const profiles: GaugeProfile[] = []
  let cursor: Awaited<ReturnType<ApiStore["listGaugeProfiles"]>>["nextCursor"] =
    null
  for (let page = 0; page < 50; page += 1) {
    const result = await store.listGaugeProfiles({
      network,
      profileType: null,
      tag: null,
      updatedSince: null,
      addresses: null,
      limit: 100,
      cursor,
    })
    profiles.push(...result.profiles)
    cursor = result.nextCursor
    if (cursor === null) break
  }
  return profiles
}

/** Gauge documents are rebuilt on the quarter hour (D1 write budget). */
export function isGaugePublishMinute(date: Date): boolean {
  return date.getUTCMinutes() % 15 < 5
}

export type PublishGaugesOptions = {
  network: NetworkSlug
  market: MarketStore
  store: ApiStore
  /**
   * Read curated profiles from Supabase's public tables instead of the
   * store (the preview runs a memory store without the service-role key).
   */
  publicProfiles: PublicProfileSource | null
  readDb: ReadDatabase
  /** PRICES KV, for pool TVL and APR; null leaves them unpriced. */
  prices: KVNamespace | null
  chain: GaugeChainReader | null
  /** Pair, vault and MEZO gauge names (MARKET_DB); null skips them. */
  labels: GaugeLabelReader | null
  /** Per-kind metadata from chain reads; null skips it. */
  details: GaugeDetailsReader | null
  /** Colours from profile pictures (cached in READ_DB); null skips them. */
  avatars: { fetcher: AvatarFetch; budget: ExtractBudget } | null
  now: () => Date
  logger: Logger
}

/** Rebuilds the gauge directory and profiles; returns rows changed. */
export async function publishGaugeReadModels(
  options: PublishGaugesOptions,
): Promise<number> {
  const profiles = await (options.publicProfiles === null
    ? allProfiles(options.store, options.network)
    : readPublicProfiles(options.publicProfiles)
  ).catch((error: unknown) => {
    options.logger.warn({ message: "Gauge profiles unavailable", error })
    return []
  })
  const avatars =
    options.avatars === null
      ? null
      : await resolveAvatarColors({
          db: options.readDb,
          targets: avatarTargets(profiles),
          fetcher: options.avatars.fetcher,
          budget: options.avatars.budget,
          now: () => Date.now(),
          logger: options.logger,
        })
  if (avatars !== null) {
    options.logger.info({
      message: "Avatar colours resolved",
      colors: avatars.colors.size,
      extracted: avatars.extracted,
      failed: avatars.failed,
      pending: avatars.pending,
      writes: avatars.writes,
    })
  }
  const writes = await buildGaugeReadModels({
    network: options.network,
    market: options.market,
    profiles,
    chain: options.chain,
    avatarColors: avatars?.colors ?? new Map(),
    labels: options.labels,
    details: options.details,
    prices:
      options.prices === null
        ? null
        : await readPricesFromKv(options.prices).catch(() => null),
    nowSeconds: Math.floor(options.now().getTime() / 1000),
  })
  const changed = await writeReadModels(options.readDb, writes)
  options.logger.info({
    message: "Gauge read models published",
    documents: writes.length,
    changed,
  })
  return changed
}
