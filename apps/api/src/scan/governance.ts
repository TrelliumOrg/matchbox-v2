import {
  type ScanGaugeAprPoint,
  type ScanLockDistribution,
  type ScanLockDistributionPoint,
  type ScanVoterEpoch,
  scanAprVoterSchema,
  scanEpochSourceRowSchema,
  scanGaugeEmissionRowSchema,
  scanLockDistributionSchema,
  scanLockEscrowSchema,
  scanLockGroupSchema,
} from "@matchbox/contracts/scan"
import { EPOCH_SECONDS, EPOCH_ZERO_START, epochStartOf } from "@matchbox/domain"
import { PlatformError } from "@matchbox/server"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiContext, ApiEnv } from "../context"
import { listVoterEpochs } from "../market/voter-epochs"
import {
  addressParam,
  epochParam,
  pathParam,
  queryOf,
  type ScanContext,
} from "./context"
import { scanQueries } from "./queries"
import type { ScanCacheClass } from "./serve"

// /internal/scan governance summaries (README "Governance"): each voter's
// epoch totals and every gauge's emissions (SCAN_DB `epoch_sources`,
// `gauge_emissions`), the escrows' daily lock distribution
// (`lock_distribution`), and voting APR per epoch from the market cron's
// own store (MARKET_DB `market_voter_epochs`, `market_gauges`). Every
// statement is one primary-key or index range; nothing reads Neon.

const sourceParam = z.string().regex(/^[A-Z][A-Z_]{1,40}$/)
/** How much older than 30 or 90 days a lock read may be to compare with. */
const compareSlackDays = 3
const epochsParam = z.coerce.number().int().min(1).max(104)

function jsonText(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function day(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** This file's tables (scan-migrations 0007, market migration 0003). */
const governanceTables = [
  "epoch_sources",
  "gauge_emissions",
  "lock_distribution",
  "market_voter_epochs",
]

function isMissingGovernanceTable(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return governanceTables.some((table) =>
    text.includes(`no such table: ${table}`),
  )
}

/**
 * Serves one route. Before its migration is applied a route answers 404
 * (Matchscan's "not available yet", which it may cache), not a 500.
 */
function serve(
  scan: ScanContext,
  c: ApiContext,
  version: string,
  render: () => Promise<unknown>,
  cacheClass: ScanCacheClass = "run",
): Promise<Response> {
  const url = new URL(c.req.url)
  return scan.responder.serve(c, {
    cacheClass,
    resource: `${url.pathname}${url.search}`,
    version,
    caller: callerOf(c),
    render: async () => {
      try {
        return { body: await render() }
      } catch (error) {
        if (isMissingGovernanceTable(error)) {
          throw new PlatformError("not_found")
        }
        throw error
      }
    },
  })
}

function market(scan: ScanContext): D1Database {
  const db = scan.deps.marketDb
  if (db === undefined || db === null) {
    throw new PlatformError("service_disabled")
  }
  return db
}

/** MARKET_DB is rewritten by the five-minute cron: a five-minute slot. */
function marketVersion(scan: ScanContext): string {
  return `m${Math.floor(scan.nowSeconds() / 300)}`
}

const gaugeIncentivesSchema = z.object({
  voter: scanAprVoterSchema,
  weight: z.string().nullable(),
  totalUsd: z.string().nullable(),
  aprPercent: z.string().nullable(),
  unpricedRewards: z.number().int().nonnegative(),
})

export function registerScanGovernance(
  app: Hono<ApiEnv>,
  scan: ScanContext,
): void {
  // Each voter's totals per epoch, oldest first.
  app.get("/internal/scan/epoch-sources", (c) => {
    const params = queryOf(c, { epochs: epochsParam.default(26) })
    return (async () =>
      serve(scan, c, `r${await scan.aggregateVersion()}`, async () => {
        const last = epochStartOf(scan.nowSeconds())
        const first = Math.max(
          EPOCH_ZERO_START,
          last - (params.epochs - 1) * EPOCH_SECONDS,
        )
        const [raws, dirty] = await Promise.all([
          scan.rows(scanQueries.epochSources, [first, last]),
          scan.dirty("epoch"),
        ])
        let skipped = 0
        const data = raws.flatMap((raw) => {
          const row = raw as Record<string, unknown>
          const parsed = scanEpochSourceRowSchema.safeParse({
            ...row,
            incentives: jsonText(row.incentives),
            fees: jsonText(row.fees),
          })
          if (!parsed.success) {
            skipped += 1
            return []
          }
          return [
            {
              ...parsed.data,
              complete: !dirty.has(String(parsed.data.epoch_start)),
            },
          ]
        })
        return {
          data,
          meta: await scan.aggregateMeta(
            data.every((row) => row.complete),
            skipped,
          ),
        }
      }))()
  })

  // One gauge's emissions, newest epoch first.
  app.get("/internal/scan/gauges/:gauge/emissions", (c) => {
    const gauge = pathParam(c, "gauge", addressParam)
    const params = queryOf(c, { limit: epochsParam.default(52) })
    return (async () =>
      serve(scan, c, `r${await scan.aggregateVersion()}`, async () => {
        const raws = await scan.rows(scanQueries.gaugeEmissions, [
          gauge,
          params.limit,
        ])
        const parsed = raws.map((raw) =>
          scanGaugeEmissionRowSchema.safeParse(raw),
        )
        const data = parsed.flatMap((row) => (row.success ? [row.data] : []))
        return {
          data,
          meta: await scan.aggregateMeta(true, parsed.length - data.length),
        }
      }))()
  })

  // Every gauge one voter paid in an epoch.
  app.get("/internal/scan/epoch-emissions/:start", (c) => {
    const start = pathParam(c, "start", epochParam)
    const params = queryOf(c, { source: sourceParam })
    if (start < EPOCH_ZERO_START || start > scan.nowSeconds()) {
      throw new PlatformError("not_found")
    }
    return (async () =>
      serve(scan, c, `r${await scan.aggregateVersion()}`, async () => {
        const raws = await scan.rows(scanQueries.epochEmissions, [
          start,
          params.source,
        ])
        const parsed = raws.map((raw) =>
          scanGaugeEmissionRowSchema.safeParse(raw),
        )
        const data = parsed.flatMap((row) => (row.success ? [row.data] : []))
        return {
          data,
          meta: await scan.aggregateMeta(true, parsed.length - data.length),
        }
      }))()
  })

  // The escrow's newest lock distribution, 30 and 90 days before it, and
  // a year of daily headline figures.
  app.get("/internal/scan/lock-distribution", (c) => {
    const params = queryOf(c, { escrow: scanLockEscrowSchema })
    return (async () =>
      serve(scan, c, `r${await scan.aggregateVersion()}`, async () => {
        const doc = (raw: unknown | null): ScanLockDistribution | null => {
          if (raw === null) return null
          const parsed = scanLockDistributionSchema.safeParse(
            jsonText((raw as Record<string, unknown>).data),
          )
          return parsed.success ? parsed.data : null
        }
        const today = day(scan.nowSeconds())
        const latest = doc(
          await scan.first(scanQueries.lockDistributionOn, [
            params.escrow,
            today,
          ]),
        )
        if (latest === null) {
          return {
            data: { latest: null, ago30: null, ago90: null, history: [] },
          }
        }
        const back = (days: number) =>
          day(Date.parse(`${latest.day}T00:00:00Z`) / 1000 - days * 86_400)
        // The newest read on or before N days back, if it is within
        // `compareSlackDays` of it: never a far older read labelled "30d".
        const around = async (days: number) => {
          const found = doc(
            await scan.first(scanQueries.lockDistributionOn, [
              params.escrow,
              back(days),
            ]),
          )
          return found !== null && found.day >= back(days + compareSlackDays)
            ? found
            : null
        }
        const [ago30, ago90, history] = await Promise.all([
          around(30),
          around(90),
          scan.rows(scanQueries.lockDistributionHistory, [
            params.escrow,
            back(365),
          ]),
        ])
        const points: ScanLockDistributionPoint[] = history.flatMap((raw) => {
          const row = raw as Record<string, unknown>
          const live = scanLockGroupSchema.safeParse(jsonText(row.live))
          const permanent = scanLockGroupSchema.safeParse(
            jsonText(row.permanent),
          )
          const timed = scanLockGroupSchema.safeParse(jsonText(row.timed))
          return typeof row.day === "string" &&
            live.success &&
            permanent.success &&
            timed.success
            ? [
                {
                  day: row.day,
                  live: live.data,
                  permanent: permanent.data,
                  timed: timed.data,
                },
              ]
            : []
        })
        return {
          data: {
            latest,
            ago30: ago30?.day === latest.day ? null : ago30,
            ago90: ago90?.day === latest.day ? null : ago90,
            history: points,
          },
        }
      }))()
  })

  // Voting APR per voter and epoch (the market cron's store), oldest first.
  app.get("/internal/scan/apr", (c) => {
    const params = queryOf(c, { epochs: epochsParam.default(26) })
    const db = market(scan)
    return serve(
      scan,
      c,
      marketVersion(scan),
      async () => {
        const last = epochStartOf(scan.nowSeconds())
        const rows = await listVoterEpochs(
          db,
          scan.deps.network,
          last - (params.epochs - 1) * EPOCH_SECONDS,
        )
        const data: ScanVoterEpoch[] = rows
          .filter((row) => row.epoch_start <= last)
          .map((row) => ({ ...row, open: row.open === 1 }))
        return { data }
      },
      "live",
    )
  })

  // One gauge's stored epochs and the APR the cron gave each, oldest first.
  app.get("/internal/scan/gauges/:gauge/apr", (c) => {
    const gauge = pathParam(c, "gauge", addressParam)
    const params = queryOf(c, { limit: epochsParam.default(52) })
    const db = market(scan)
    return serve(
      scan,
      c,
      marketVersion(scan),
      async () => {
        const last = epochStartOf(scan.nowSeconds())
        const result = await db
          .prepare(
            `SELECT epoch_start, incentives FROM market_gauges
             WHERE network = ? AND gauge_address = ? AND epoch_start <= ?
             ORDER BY epoch_start DESC LIMIT ?`,
          )
          .bind(scan.deps.network, gauge, last, params.limit)
          .all()
        const data: ScanGaugeAprPoint[] = result.results.flatMap((raw) => {
          const epoch = z.number().int().safeParse(raw.epoch_start)
          const incentives = gaugeIncentivesSchema.safeParse(
            jsonText(raw.incentives),
          )
          return epoch.success && incentives.success
            ? [
                {
                  epoch_start: epoch.data,
                  voter: incentives.data.voter,
                  weight: incentives.data.weight,
                  total_usd: incentives.data.totalUsd,
                  apr_percent: incentives.data.aprPercent,
                  unpriced_rewards: incentives.data.unpricedRewards,
                },
              ]
            : []
        })
        return { data: data.reverse() }
      },
      "live",
    )
  })
}
