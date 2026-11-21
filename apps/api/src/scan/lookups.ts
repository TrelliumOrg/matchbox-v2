import {
  type ScanDimensionKind,
  type ScanLabelItem,
  scanDimensionMatches,
  scanMetricDefinition,
  scanMetricNotes,
  scanMetricRecomputed,
  scanSearchKindSchema,
  scanSeriesMaxDays,
} from "@matchbox/contracts/scan"
import { EPOCH_SECONDS, EPOCH_ZERO_START } from "@matchbox/domain"
import { PlatformError } from "@matchbox/server"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiContext, ApiEnv } from "../context"
import { readReadModel } from "../read-models/store"
import { tokenRegistry } from "../read-models/token-registry"
import { queryOf, type ScanContext } from "./context"
import { musdPrice } from "./crosschain"
import {
  type GaugeSearchEntry,
  gaugeSearchEntry,
  matchGaugeNames,
} from "./gauge-search"
import { labelItem } from "./items"
import { escrowParam } from "./lists"
import { knownMarketDecimals, tokenDecimals } from "./market-decimals"
import { readSplitRange, splitPoolTokenDays } from "./markets"
import { labelsByAddresses, scanQueries } from "./queries"
import {
  type MarketPrice,
  registeredTokens,
  tokenListBase,
  usdAt,
} from "./tokens"

// /internal/scan series, prices, labels and search.

const daySchema = z.iso.date()
const dayRowSchema = z.object({ day: daySchema })
const pointRowSchema = z.object({
  day: daySchema,
  value: z.string().regex(/^(0|-?[1-9][0-9]*)$/),
  /** The jobs Worker's own mark: the day can still change. */
  partial: z.union([z.literal(0), z.literal(1)]).default(0),
})
const dimensionRowSchema = z.object({ dimension: z.string() })
const latestRowSchema = z.object({
  day: daySchema,
  value: z.string().regex(/^(0|[1-9][0-9]*)$/),
  partial: z.union([z.literal(0), z.literal(1)]).default(0),
})
const priceRowSchema = z.object({
  day: daySchema,
  price: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/),
})

const dayMs = 86_400_000

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs
  )
}

/** The longest label list one lookup returns. */
const maxLabels = 50
/** Labels a composed document carries at most (its first addresses). */
export const scanLabelLimit = maxLabels

/**
 * The token a `decimals: "token"` series is in, from its dimension: the
 * token itself, a pool-token's token, a token-destination's token, or a
 * Morpho market's loan token (collateral token for collateral metrics).
 * Null for a total across tokens or markets.
 */
async function seriesToken(
  scan: ScanContext,
  metric: string,
  kind: ScanDimensionKind,
  dimension: string,
): Promise<string | null> {
  switch (kind) {
    case "token":
      return dimension === "" ? null : dimension
    case "pool-token":
      return dimension.split(":")[1] ?? null
    case "token-destination":
      return dimension.split(":")[0] ?? null
    case "market": {
      if (dimension === "" || scan.deps.readDb === null) return null
      const row = await scan.first(scanQueries.market, [
        scan.deps.network,
        dimension,
      ])
      const parsed = marketTokensSchema.safeParse(row)
      if (!parsed.success) return null
      return metric.includes("collateral")
        ? parsed.data.collateral_token.toLowerCase()
        : parsed.data.loan_token.toLowerCase()
    }
    default:
      return null
  }
}

const marketTokensSchema = z.object({
  loan_token: z.string(),
  collateral_token: z.string(),
})

/** Canonical address list: lower case, each once, sorted. */
function canonicalAddresses(addresses: readonly string[]): string[] {
  return [...new Set(addresses.map((value) => value.toLowerCase()))].sort()
}
/** Prefix search results. */
const maxMatches = 20

/** Labels for up to 50 addresses, by key lookups. */
export async function labelsFor(
  scan: ScanContext,
  addresses: readonly string[],
): Promise<Record<string, ScanLabelItem>> {
  const wanted = [...new Set(addresses.map((value) => value.toLowerCase()))]
    .filter((value) => /^0x[0-9a-f]{40}$/.test(value))
    .slice(0, maxLabels)
  if (wanted.length === 0) return {}
  const rows = await scan.rows(labelsByAddresses(wanted.length), wanted)
  const labels: Record<string, ScanLabelItem> = {}
  for (const label of scan.mapRows(rows, labelItem).rows) {
    labels[label.address] = label
  }
  return labels
}

async function labelsByName(
  scan: ScanContext,
  prefix: string,
): Promise<ScanLabelItem[]> {
  const lower = prefix.toLowerCase()
  const rows = await scan.rows(scanQueries.labelsByName, [
    lower,
    `${lower}\u{10ffff}`,
    maxMatches,
  ])
  return scan.mapRows(rows, labelItem).rows
}

async function labelsByAddressPrefix(
  scan: ScanContext,
  prefix: string,
): Promise<ScanLabelItem[]> {
  const lower = prefix.toLowerCase()
  const rows = await scan.rows(scanQueries.labelsByAddressPrefix, [
    lower,
    `${lower}g`,
    maxMatches,
  ])
  return scan.mapRows(rows, labelItem).rows
}

const addressPrefixSchema = z.string().regex(/^0x[0-9a-fA-F]{1,40}$/)
const namePrefixSchema = z.string().regex(/^[^\p{Cc}]{1,64}$/u)

/** MUSD on Mezo: priced at its market price when the quotes are fresh. */
const musdAddress = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"

export function registerScanLookups(
  app: Hono<ApiEnv>,
  scan: ScanContext,
): void {
  /**
   * Series and prices. A range is `long` (kept a day, no version) only when
   * it is settled: it ends before the day of `copied_through` minus one,
   * the status is not stale, and no point in it is partial (known once
   * rendered). Anything else is keyed by the aggregate version and the
   * slot (the half hour or hour of the closing-value and price writers,
   * which log no runs); a slot boundary is also a UTC midnight, so
   * "today" moves with the key.
   */
  async function seriesResponse(
    c: ApiContext,
    to: string,
    slotSeconds: number,
    render: () => Promise<{ body: unknown; settled: boolean }>,
  ): Promise<Response> {
    const url = new URL(c.req.url)
    const resource = `${url.pathname}${url.search}`
    const [run, aggregates] = await Promise.all([
      scan.runVersion(),
      scan.aggregateVersion(),
    ])
    const copied = run.status?.copied_through ?? null
    const mayBeLong =
      copied !== null && !run.stale && to < dayOf((copied - 86_400) * 1000)
    const version = `r${aggregates}-s${Math.floor(scan.nowSeconds() / slotSeconds)}`
    if (!mayBeLong) {
      return scan.responder.serve(c, {
        cacheClass: "run",
        resource,
        version,
        caller: callerOf(c),
        render: async () => ({ body: (await render()).body }),
      })
    }
    return scan.responder.serveComposed(c, {
      finalKey: { resource, version: "" },
      resource,
      version,
      cacheClass: "run",
      caller: callerOf(c),
      render: async () => {
        const rendered = await render()
        return { body: rendered.body, final: rendered.settled }
      },
    })
  }

  function range(from: string, to: string): void {
    const days = daysBetween(from, to)
    if (days < 0 || days > scanSeriesMaxDays) {
      throw new PlatformError("invalid_request")
    }
  }

  app.get("/internal/scan/series", (c) => {
    const params = queryOf(c, {
      metric: z.string().regex(/^[a-z_]+\.[a-z_0-9]+$/),
      dimension: z.string().max(130).default(""),
      from: daySchema,
      to: daySchema,
    })
    // Validated against the registry at request time; no names here.
    const definition = scanMetricDefinition(params.metric)
    if (definition === null) throw new PlatformError("invalid_request")
    const dimension = params.dimension.toLowerCase()
    const checked =
      definition.dimension === "voter-source" ? params.dimension : dimension
    if (!scanDimensionMatches(definition.dimension, checked)) {
      throw new PlatformError("invalid_request")
    }
    range(params.from, params.to)
    return seriesResponse(c, params.to, 1_800, async () => {
      const binds = [params.metric, checked]
      const [points, first, last, dirtyDays, tokenAddress] = await Promise.all([
        scan.rows(scanQueries.dailyRange, [...binds, params.from, params.to]),
        scan.first(scanQueries.dailyFirst, binds),
        scan.first(scanQueries.dailyLast, binds),
        scan.dirty("day"),
        definition.decimals === "token"
          ? seriesToken(scan, params.metric, definition.dimension, checked)
          : Promise.resolve(null),
      ])
      const registered =
        tokenAddress === null ? undefined : tokenRegistry.get(tokenAddress)
      // A market's tokens: the decimals read on chain when the market was
      // discovered, else the registry's; null when neither knows.
      const onChain =
        definition.dimension === "market" && tokenAddress !== null
          ? await knownMarketDecimals(scan).then((known) => {
              const decimals = known.get(checked)
              return params.metric.includes("collateral")
                ? decimals?.collateral
                : decimals?.loan
            })
          : undefined
      const resolvedDecimals =
        definition.decimals === "token"
          ? tokenAddress === null
            ? null
            : tokenDecimals(onChain, tokenAddress)
          : definition.decimals
      const today = dayOf(scan.nowMs())
      const lastDay = last === null ? null : dayRowSchema.parse(last).day
      const recomputed = scanMetricRecomputed(params.metric)
      const servedPoints = points.map((row) => {
        const point = pointRowSchema.parse(row)
        return {
          day: point.day,
          value: point.value,
          partial:
            point.partial === 1 ||
            point.day >= today ||
            (recomputed && dirtyDays.has(point.day)),
        }
      })
      const settled = servedPoints.every((point) => !point.partial)
      return {
        settled,
        body: {
          data: {
            metric: params.metric,
            dimension: checked,
            from: params.from,
            to: params.to,
            note: scanMetricNotes[params.metric] ?? null,
            unit: definition.unit,
            decimals: definition.decimals,
            resolvedDecimals,
            token:
              tokenAddress === null
                ? null
                : {
                    address: tokenAddress,
                    symbol: registered?.token.symbol ?? null,
                  },
            kind: definition.kind,
            signed: definition.signed,
            // One series' own values only: never summed with another metric.
            points: servedPoints,
            firstDay: first === null ? null : dayRowSchema.parse(first).day,
            lastDay,
            endsOn: definition.liveWriter ? null : lastDay,
          },
          meta: await scan.aggregateMeta(settled),
        },
      }
    })
  })

  /**
   * Every dimension of one metric over a range, in one range scan: the
   * per-token rollups (pool.token_balance, dex.token_volume_in) and any
   * other token series, up to `scanSeriesMaxDays`, or one pool-token
   * metric over a week (two rows per pool a day). At most `splitRows` rows,
   * newest first: past that the range starts the day after the cut, so
   * every day served is whole, and `truncated` says so. Cached as /series
   * is.
   */
  app.get("/internal/scan/series/split", (c) => {
    const params = queryOf(c, {
      metric: z.string().regex(/^[a-z_]+\.[a-z_0-9]+$/),
      from: daySchema,
      to: daySchema,
    })
    const definition = scanMetricDefinition(params.metric)
    if (definition === null) throw new PlatformError("invalid_request")
    const maxDays =
      definition.dimension === "token"
        ? scanSeriesMaxDays
        : definition.dimension === "pool-token"
          ? splitPoolTokenDays
          : null
    if (maxDays === null) throw new PlatformError("invalid_request")
    const days = daysBetween(params.from, params.to)
    if (days < 0 || days > maxDays) throw new PlatformError("invalid_request")
    return seriesResponse(c, params.to, 1_800, async () => {
      const split = await readSplitRange(
        scan,
        params.metric,
        definition,
        params.from,
        params.to,
      )
      return {
        settled: split.settled,
        body: {
          data: split.data,
          meta: await scan.aggregateMeta(split.settled),
        },
      }
    })
  })

  app.get("/internal/scan/prices/:token", (c) => {
    const token = z.enum(["btc", "mezo"]).safeParse(c.req.param("token"))
    if (!token.success) throw new PlatformError("not_found")
    const params = queryOf(c, { from: daySchema, to: daySchema })
    range(params.from, params.to)
    return seriesResponse(c, params.to, 3_600, async () => {
      const [points, first, last] = await Promise.all([
        scan.rows(scanQueries.priceRange, [token.data, params.from, params.to]),
        scan.first(scanQueries.priceFirst, [token.data]),
        scan.first(scanQueries.priceLast, [token.data]),
      ])
      const served = points.map((row) => {
        const point = priceRowSchema.parse(row)
        return { ...point, partial: point.day >= dayOf(scan.nowMs()) }
      })
      const settled = served.every((point) => !point.partial)
      return {
        settled,
        body: {
          data: {
            token: token.data,
            from: params.from,
            to: params.to,
            points: served,
            firstDay: first === null ? null : dayRowSchema.parse(first).day,
            lastDay: last === null ? null : dayRowSchema.parse(last).day,
          },
          meta: await scan.aggregateMeta(true),
        },
      }
    })
  })

  /**
   * The token list in one read: every registered token, and every token
   * the jobs Worker keeps a supply for, with price, supply and holders.
   * Figures are the latest closes in SCAN_DB (`token.total_supply` is
   * totalSupply() at the close, never summed transfers; `token.holders`
   * Blockscout's count), read in one D1 batch, so a page view makes no
   * Blockscout read. Keyed by the aggregate version and the live slot (the
   * KV prices move every few minutes).
   */
  app.get("/internal/scan/tokens", (c) => {
    queryOf(c, {})
    return (async () => {
      const url = new URL(c.req.url)
      // MUSD's market price moves every minute: a 5-minute slot.
      const version = `r${await scan.aggregateVersion()}-${scan.liveVersion()}-p${Math.floor(scan.nowSeconds() / 300)}`
      return scan.responder.serve(c, {
        cacheClass: "run",
        resource: url.pathname,
        version,
        caller: callerOf(c),
        render: async () => {
          const [withSupply, prices, musdQuotes] = await Promise.all([
            scan.rows(scanQueries.dailyDimensions, ["token.total_supply"]),
            scan.deps.readPrices().catch(() => null),
            // Absent before scan-migrations 0006: MUSD stays at $1 taken.
            scan.rows(scanQueries.crossChainQuotes, ["musd"]).catch(() => []),
          ])
          const market = new Map<string, MarketPrice>()
          const musd = musdPrice(musdQuotes, scan.nowSeconds())
          if (musd.price_usd !== null && !musd.stale && musd.basis !== null) {
            market.set(musdAddress, {
              usd: musd.price_usd,
              source: musd.basis === "venues" ? "venues" : "coingecko",
            })
          }
          const registered = registeredTokens()
          const extra = withSupply
            .map((row) => dimensionRowSchema.safeParse(row))
            .flatMap((parsed) =>
              parsed.success && /^0x[0-9a-f]{40}$/.test(parsed.data.dimension)
                ? [parsed.data.dimension]
                : [],
            )
            .filter((address) => !registered.includes(address))
          const tokens = [...registered, ...extra]
          const latest = await scan.firstEach(scanQueries.dailyLatest, [
            ...tokens.map((token) => ["token.total_supply", token]),
            ...tokens.map((token) => ["token.holders", token]),
          ])
          const figure = (row: unknown) => {
            const parsed = latestRowSchema.safeParse(row)
            return parsed.success
              ? {
                  value: parsed.data.value,
                  day: parsed.data.day,
                  partial: parsed.data.partial === 1,
                }
              : null
          }
          const data = tokens.map((address, index) => {
            const base = tokenListBase(address, prices, market)
            const supply = figure(latest[index])
            const holders = figure(latest[tokens.length + index])
            return {
              ...base,
              supply,
              supply_usd:
                supply === null
                  ? null
                  : usdAt(BigInt(supply.value), base.decimals, base.price_usd),
              holders,
            }
          })
          const complete = data.every(
            (row) =>
              row.supply?.partial !== true && row.holders?.partial !== true,
          )
          return {
            body: {
              data,
              prices: {
                btc_usd: prices?.btc?.usd ?? null,
                mezo_usd: prices?.mezo?.usd ?? null,
              },
              meta: await scan.aggregateMeta(complete),
            },
          }
        },
      })
    })()
  })

  // The shell's view of how complete and current Scan's data is. No error
  // text or re-fill reason: those stay in the jobs Worker's logs.
  app.get("/internal/scan/status", (c) => {
    queryOf(c, {})
    return (async () => {
      const run = await scan.runVersion()
      const status = run.status
      const url = new URL(c.req.url)
      return scan.responder.serve(c, {
        cacheClass: "run",
        resource: url.pathname,
        // The whole row, so a failure or a new count shows within seconds,
        // and the live slot for the live snapshot's age.
        version: `${run.id}-u${status?.updated_at ?? 0}-${scan.liveVersion()}`,
        caller: callerOf(c),
        render: async () => {
          const liveSnapshot = await scan.liveSnapshot()
          return {
            // A head the clock missed (a hub just woken) is not kept.
            store: !(liveSnapshot.head === null && liveSnapshot.block !== null),
            body: {
              data: {
                source: status === null ? "runs" : "status",
                asOf: run.finishedAt,
                lastRunStatus: status?.last_run_status ?? null,
                lastRunAt: status?.last_run_at ?? null,
                consecutiveFailures: status?.consecutive_failures ?? null,
                copiedThrough: status?.copied_through ?? null,
                dirtyEpochs: status?.dirty_epochs ?? null,
                dirtyDays: status?.dirty_days ?? null,
                aggregatesComplete: run.aggregatesComplete,
                historyFilled: run.historyFilled,
                refillRequired:
                  status === null ? null : status.refill_required === 1,
                quarantinedRows: status?.quarantined_rows ?? null,
                // Names only: the reasons stay in the jobs Worker's logs.
                halted: status === null ? null : run.halted !== null,
                haltedTables: status === null ? null : (run.halted ?? []),
                // Lag only: a pending re-fill is refillRequired.
                stale: run.delayed,
                liveSnapshot,
              },
            },
          }
        },
      })
    })()
  })

  async function runVersioned(
    c: ApiContext,
    render: () => Promise<unknown>,
    extraVersion = "",
    /** The canonical resource, when the URL's query is not. */
    resource?: string,
  ): Promise<Response> {
    const url = new URL(c.req.url)
    const run = await scan.runVersion()
    return scan.responder.serve(c, {
      cacheClass: "run",
      resource: resource ?? `${url.pathname}${url.search}`,
      version: `r${run.id}${extraVersion}`,
      caller: callerOf(c),
      render: async () => ({ body: await render() }),
    })
  }

  app.get("/internal/scan/labels", (c) => {
    const params = queryOf(c, { address: z.string().min(1).max(2_200) })
    const addresses = params.address.split(",")
    if (
      addresses.length > maxLabels ||
      !addresses.every((value) => /^0x[0-9a-fA-F]{40}$/.test(value))
    ) {
      throw new PlatformError("invalid_request")
    }
    // One entry per set of addresses, whatever their case, order or repeats.
    const wanted = canonicalAddresses(addresses)
    return runVersioned(
      c,
      async () => ({ data: await labelsFor(scan, wanted) }),
      "",
      `/internal/scan/labels?address=${wanted.join(",")}`,
    )
  })

  app.get("/internal/scan/labels/search", (c) => {
    const params = queryOf(c, {
      q: z.string().min(1).max(64),
      by: z.enum(["name", "address"]).default("name"),
    })
    if (
      params.by === "address" &&
      !addressPrefixSchema.safeParse(params.q).success
    ) {
      throw new PlatformError("invalid_request")
    }
    if (params.by === "name" && !namePrefixSchema.safeParse(params.q).success) {
      throw new PlatformError("invalid_request")
    }
    return runVersioned(c, async () => ({
      data:
        params.by === "name"
          ? await labelsByName(scan, params.q)
          : await labelsByAddressPrefix(scan, params.q),
    }))
  })

  /**
   * Gauge names from Pro's directory, parsed once per directory etag and
   * kept in the isolate, so a name search reads only the (memoised)
   * version row, not the whole document.
   */
  let gaugeNames: {
    etag: string
    names: Promise<GaugeSearchEntry[]>
  } | null = null

  async function gaugeNameIndex(etag: string): Promise<GaugeSearchEntry[]> {
    if (gaugeNames?.etag !== etag) {
      const names = readReadModel(
        scan.read(),
        scan.deps.network,
        "gauges",
        "current",
      ).then((directory) =>
        (directory?.data.gauges ?? []).map(gaugeSearchEntry),
      )
      gaugeNames = { etag, names }
      names.catch(() => {
        if (gaugeNames?.names === names) gaugeNames = null
      })
    }
    return gaugeNames.names
  }

  async function gaugeNameMatches(
    prefix: string,
    etag: string | null,
  ): Promise<{ address: string; name: string }[]> {
    if (etag === null) return []
    return matchGaugeNames(await gaugeNameIndex(etag), prefix, maxMatches)
  }

  app.get("/internal/scan/search", (c) => {
    const params = queryOf(c, {
      kind: scanSearchKindSchema,
      q: z.string().min(1).max(80),
    })
    return (async () => {
      // Name search reads Pro's directory too: key it on that document's
      // etag as well as the run.
      const directory =
        params.kind === "name" && scan.deps.readDb !== null
          ? await scan.readModelVersion("gauges", "current")
          : null
      return runVersioned(
        c,
        async () => {
          switch (params.kind) {
            case "name": {
              if (!namePrefixSchema.safeParse(params.q).success) {
                throw new PlatformError("invalid_request")
              }
              const [labels, gauges] = await Promise.all([
                labelsByName(scan, params.q),
                gaugeNameMatches(params.q, directory?.etag ?? null),
              ])
              const labelled = new Set(labels.map((label) => label.address))
              return {
                data: {
                  kind: params.kind,
                  hits: [
                    ...labels.map((label) => ({
                      type: "label" as const,
                      label,
                    })),
                    ...gauges
                      .filter((gauge) => !labelled.has(gauge.address))
                      .map((gauge) => ({ type: "gauge" as const, ...gauge })),
                  ],
                },
              }
            }
            case "address": {
              if (!/^0x[0-9a-fA-F]{40}$/.test(params.q)) {
                throw new PlatformError("invalid_request")
              }
              const labels = await labelsFor(scan, [params.q])
              return {
                data: {
                  kind: params.kind,
                  hits: Object.values(labels).map((label) => ({
                    type: "label" as const,
                    label,
                  })),
                },
              }
            }
            case "address-prefix": {
              if (!addressPrefixSchema.safeParse(params.q).success) {
                throw new PlatformError("invalid_request")
              }
              const labels = await labelsByAddressPrefix(scan, params.q)
              return {
                data: {
                  kind: params.kind,
                  hits: labels.map((label) => ({
                    type: "label" as const,
                    label,
                  })),
                },
              }
            }
            case "epoch": {
              // An epoch number (0, 1, ...) or an epoch start (unix seconds).
              const number = z.coerce.number().int().min(0).safeParse(params.q)
              if (!number.success) throw new PlatformError("invalid_request")
              const start =
                number.data < 100_000
                  ? EPOCH_ZERO_START + number.data * EPOCH_SECONDS
                  : number.data
              const row = await scan.first(scanQueries.epoch, [start])
              return {
                data: {
                  kind: params.kind,
                  hits:
                    row === null
                      ? []
                      : [{ type: "epoch" as const, epoch_start: start }],
                },
              }
            }
            case "lock": {
              // "123" (either escrow) or "vebtc:123"; anything more is a 400.
              const parts = params.q.split(":")
              if (parts.length > 2) throw new PlatformError("invalid_request")
              const [maybeEscrow, maybeId] =
                parts.length === 2 ? parts : [undefined, params.q]
              const id = z
                .string()
                .regex(/^(0|[1-9][0-9]{0,77})$/)
                .safeParse(maybeId)
              if (!id.success) throw new PlatformError("invalid_request")
              const escrowList =
                maybeEscrow === undefined ? ["vebtc", "vemezo"] : [maybeEscrow]
              const candidates = escrowList.map((name) => {
                const parsed = escrowParam.safeParse(name)
                if (!parsed.success) throw new PlatformError("invalid_request")
                return parsed.data
              })
              const found = await Promise.all(
                candidates.map(async (escrow) =>
                  (await scan.first(scanQueries.lock, [escrow, id.data])) ===
                  null
                    ? null
                    : escrow,
                ),
              )
              return {
                data: {
                  kind: params.kind,
                  hits: found.flatMap((escrow) =>
                    escrow === null
                      ? []
                      : [{ type: "lock" as const, escrow, token_id: id.data }],
                  ),
                },
              }
            }
          }
        },
        directory === null ? "" : `-g${directory.etag}`,
      )
    })()
  })
}
