import type { ScanValidatorRow } from "@matchbox/contracts/scan"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiEnv } from "../context"
import { readReadModel } from "../read-models/store"
import { queryOf, type ScanContext } from "./context"
import { labelsFor } from "./lookups"
import { scanQueries } from "./queries"

// /internal/scan/validators: blocks proposed per validator on the latest
// day with counts (chain.blocks_proposed, the jobs Worker's daily
// difference of each validator's Blockscout validations_count), each one's
// share of that day, its running total, and what the API already knows
// of the ValidatorPool set (Pro's gauge directory: operator, status, the
// moniker or profile name) and the labels. A day's count exists only from
// the second daily read; before then the route says "not available yet",
// never zero.

const proposedMetric = "chain.blocks_proposed"
const totalMetric = "chain.blocks_proposed_total"
/**
 * Blocks the chain produced on a day (dimension ''): the difference of
 * Blockscout's newest height at two daily reads. The shares' denominator.
 */
const blocksMetric = "chain.blocks"

const dayBlocksSchema = z.object({
  value: z.string().regex(/^(0|[1-9][0-9]*)$/),
  partial: z.union([z.literal(0), z.literal(1)]).default(0),
})

const dayRowSchema = z.object({ day: z.iso.date().nullable() })
/** A validator's address; '' (the total across validators) is no row. */
const validatorDimension = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase())

const countRowSchema = z.object({
  dimension: validatorDimension,
  value: z.string().regex(/^(0|[1-9][0-9]*)$/),
  partial: z.union([z.literal(0), z.literal(1)]).default(0),
})
const totalRowSchema = z.object({
  dimension: validatorDimension,
  day: z.iso.date(),
  value: z.string().regex(/^(0|[1-9][0-9]*)$/),
})

type PoolEntry = {
  operator: string | null
  gauge: string
  name: string
  status: "active" | "left"
}

/** Validator gauges in Pro's directory, parsed once per etag. */
let poolMemo: { etag: string; entries: Promise<PoolEntry[]> } | null = null

function poolEntries(scan: ScanContext, etag: string): Promise<PoolEntry[]> {
  if (poolMemo?.etag !== etag) {
    const entries = readReadModel(
      scan.read(),
      scan.deps.network,
      "gauges",
      "current",
    ).then((directory) =>
      (directory?.data.gauges ?? []).flatMap((card) =>
        card.meta?.kind === "validator"
          ? [
              {
                operator: card.meta.operator?.toLowerCase() ?? null,
                gauge: card.gauge.address.toLowerCase(),
                name: card.gauge.name,
                status: card.meta.status,
              },
            ]
          : [],
      ),
    )
    poolMemo = { etag, entries }
    entries.catch(() => {
      if (poolMemo?.entries === entries) poolMemo = null
    })
  }
  return poolMemo.entries
}

export function registerScanValidators(
  app: Hono<ApiEnv>,
  scan: ScanContext,
): void {
  app.get("/internal/scan/validators", (c) => {
    queryOf(c, {})
    return (async () => {
      const directory =
        scan.deps.readDb === null
          ? null
          : await scan.readModelVersion("gauges", "current").catch(() => null)
      const url = new URL(c.req.url)
      return scan.responder.serve(c, {
        cacheClass: "run",
        resource: url.pathname,
        version: `r${await scan.aggregateVersion()}-g${directory?.etag ?? "-"}`,
        caller: callerOf(c),
        render: async () => {
          const latest = dayRowSchema.safeParse(
            await scan.first(scanQueries.dailyLatestDay, [proposedMetric]),
          )
          const day = latest.success ? latest.data.day : null
          const [counts, totals, pool, dayBlocksRow] = await Promise.all([
            day === null
              ? Promise.resolve([])
              : scan.rows(scanQueries.dailyOnDay, [proposedMetric, day]),
            scan.rows(scanQueries.dailyDimensions, [totalMetric]).then((rows) =>
              scan.firstEach(
                scanQueries.dailyLatestOf,
                rows.flatMap((row) => {
                  const parsed = z
                    .object({ dimension: z.string() })
                    .safeParse(row)
                  return parsed.success
                    ? [[totalMetric, parsed.data.dimension]]
                    : []
                }),
              ),
            ),
            directory === null
              ? Promise.resolve([])
              : poolEntries(scan, directory.etag).catch(() => []),
            day === null
              ? Promise.resolve(null)
              : scan.first(scanQueries.dailyOn, [blocksMetric, "", day]),
          ])
          const dayBlocksParsed = dayBlocksSchema.safeParse(dayBlocksRow)
          const dayBlocks = dayBlocksParsed.success
            ? {
                value: BigInt(dayBlocksParsed.data.value),
                partial: dayBlocksParsed.data.partial === 1,
              }
            : null
          const countBy = new Map<string, { value: bigint; partial: boolean }>()
          for (const row of counts) {
            const parsed = countRowSchema.safeParse(row)
            if (!parsed.success) continue
            countBy.set(parsed.data.dimension.toLowerCase(), {
              value: BigInt(parsed.data.value),
              partial: parsed.data.partial === 1,
            })
          }
          const totalBy = new Map<string, { value: string; day: string }>()
          for (const row of totals) {
            const parsed = totalRowSchema.safeParse(row)
            if (!parsed.success) continue
            totalBy.set(parsed.data.dimension.toLowerCase(), {
              value: parsed.data.value,
              day: parsed.data.day,
            })
          }
          const poolBy = new Map<string, PoolEntry>()
          for (const entry of pool) {
            if (entry.operator !== null) poolBy.set(entry.operator, entry)
          }
          // Every validator any source knows: counted, totalled or in
          // the pool (by operator; a pool entry with no operator has no
          // address to match blocks with, and is listed by its gauge).
          const addresses = [
            ...new Set([
              ...totalBy.keys(),
              ...countBy.keys(),
              ...poolBy.keys(),
            ]),
          ].sort()
          const labels = await labelsFor(scan, addresses).catch(() => ({}))
          // Shares of every block the chain produced that day
          // (chain.blocks), never of the known validators' sum: with no
          // count of the day's blocks, shares are unknown. A validator
          // without a count for the day has no share; its blocks are in
          // the unattributed remainder.
          const missing = [...totalBy.keys()].filter((key) => !countBy.has(key))
          const dayTotal = [...countBy.values()].reduce(
            (sum, count) => sum + count.value,
            0n,
          )
          const shareable =
            day !== null && dayBlocks !== null && dayBlocks.value > 0n
          // The height and each counter are read seconds to minutes apart,
          // so the counted blocks can overshoot the day's by a few.
          const unattributed =
            dayBlocks === null
              ? null
              : dayBlocks.value > dayTotal
                ? dayBlocks.value - dayTotal
                : 0n
          const rows: ScanValidatorRow[] = addresses.map((address) => {
            const count = countBy.get(address) ?? null
            const entry = poolBy.get(address) ?? null
            return {
              address,
              name: entry?.name ?? null,
              label:
                (labels as Record<string, { name: string }>)[address]?.name ??
                null,
              operator: entry?.operator ?? null,
              gauge: entry?.gauge ?? null,
              pool_status: entry?.status ?? null,
              blocks: count === null ? null : count.value.toString(),
              share_bps:
                shareable && count !== null && dayBlocks !== null
                  ? Math.min(
                      10_000,
                      Number((count.value * 10_000n) / dayBlocks.value),
                    )
                  : null,
              blocks_total: totalBy.get(address) ?? null,
            }
          })
          const unmatchedPool = pool
            .filter((entry) => entry.operator === null)
            .map((entry) => ({
              gauge: entry.gauge,
              name: entry.name,
              pool_status: entry.status,
            }))
          return {
            body: {
              data: {
                available: day !== null,
                reason:
                  day === null
                    ? "Not available yet: a day's count needs two daily reads of each validator's counter."
                    : null,
                day,
                day_total: day === null ? null : dayTotal.toString(),
                shares_complete: shareable && missing.length === 0,
                share_of: shareable ? "all_blocks" : null,
                blocks_in_day:
                  dayBlocks === null ? null : dayBlocks.value.toString(),
                unattributed_blocks:
                  unattributed === null ? null : unattributed.toString(),
                missing_counts: day === null ? [] : missing.sort(),
                validators: rows,
                pool_without_operator: unmatchedPool,
              },
              meta: await scan.aggregateMeta(
                day !== null &&
                  missing.length === 0 &&
                  dayBlocks !== null &&
                  !dayBlocks.partial &&
                  [...countBy.values()].every((count) => !count.partial),
              ),
            },
          }
        },
      })
    })()
  })
}
