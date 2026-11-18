import {
  addressCountersSchema,
  type BlockscoutCaller,
  blockSchema,
  addressSchema as blockscoutAddressSchema,
  logsPageSchema,
  tokenBalancesPageSchema,
  tokenTransfersPageSchema,
  transactionSchema,
  transactionsPageSchema,
} from "@matchbox/contracts/blockscout"
import type {
  ScanAddressTokens,
  ScanPartReason,
} from "@matchbox/contracts/scan"
import { PlatformError } from "@matchbox/server"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { CacheClass } from "../blockscout/routes"
import type { ApiContext, ApiEnv } from "../context"
import { enclavePositions, ownerPositions } from "./borrow"
import {
  addressParam,
  hashParam,
  page,
  pathParam,
  queryOf,
  type ScanContext,
} from "./context"
import { activityItem, lockItem, servedLock } from "./items"
import { activityForAddress, codecs } from "./lists"
import { liveOwnerPage, scanLiveDeadlineMs, waitUntilOf } from "./live-locks"
import { labelsFor, scanLabelLimit } from "./lookups"
import { scanQueries } from "./queries"
import { addressTokens } from "./tokens"

// Composed entity documents: one subrequest per Scan page. Each document
// reads Blockscout through the proxy's own code path (its allowlist, cache
// classes and budgets, with the caller's identity) and merges our rows. A
// part that fails is `{ status: "unavailable", reason }`; the document is
// always served.

type Part<T> =
  | {
      status: "ok"
      data: T
      cacheClass: CacheClass | null
      /**
       * False for a stored copy the proxy served past its freshness (its
       * refresh refused for this caller, or still running): the next caller
       * may get it fresh.
       */
      shared: boolean
    }
  | { status: "unavailable"; reason: ScanPartReason }

/**
 * Reasons a part is unavailable that hold for every caller at the same
 * head and data version, so a document carrying them may still be shared
 * under the head key (never as final):
 * - `not_found`: Blockscout's 404, which the proxy itself believes for a
 *   block, for everyone;
 * - `invalid`: Blockscout rejected the path; it would for anyone;
 * - `disabled`: deployment config (no proxy, or SCAN_DB unbound).
 * The others are never stored: `rate_limited` is that caller's bucket (or
 * the shared upstream budget, which refills); `upstream` is an outage or a
 * D1 error and `schema` an answer we could not read, both transient, and
 * pinning either under the head key would serve the failure to callers
 * who would have been served. Their parts are cached by the proxy anyway,
 * so not storing the document costs one re-composition.
 */
const shareableReasons: ReadonlySet<ScanPartReason> = new Set([
  "not_found",
  "invalid",
  "disabled",
])

/** Whether a document made of these parts may be stored for everyone. */
function shareable(parts: readonly Part<unknown>[]): boolean {
  return parts.every((part) =>
    part.status === "ok" ? part.shared : shareableReasons.has(part.reason),
  )
}

/** One proxy read, parsed with the same schema the proxy trimmed with. */
async function proxied<T>(
  scan: ScanContext,
  c: ApiContext,
  path: string,
  schema: z.ZodType<T>,
  caller: BlockscoutCaller,
  query: URLSearchParams = new URLSearchParams(),
): Promise<Part<T>> {
  const proxy = scan.deps.proxy
  if (proxy === null) return { status: "unavailable", reason: "disabled" }
  try {
    const answer = await proxy.handle(path, query, caller, (task) => {
      try {
        c.executionCtx.waitUntil(task.catch(() => undefined))
      } catch {
        // Detached in tests.
      }
    })
    switch (answer.kind) {
      case "not-found":
        return { status: "unavailable", reason: "not_found" }
      case "invalid":
        return { status: "unavailable", reason: "invalid" }
      case "unavailable":
        return {
          status: "unavailable",
          reason:
            answer.reason === "rate-limited"
              ? "rate_limited"
              : answer.reason === "schema"
                ? "schema"
                : "upstream",
        }
      case "ok": {
        let raw: unknown
        try {
          raw = JSON.parse(answer.body)
        } catch {
          return { status: "unavailable", reason: "schema" }
        }
        const parsed = schema.safeParse(raw)
        if (!parsed.success) return { status: "unavailable", reason: "schema" }
        return {
          status: "ok",
          data: parsed.data,
          // A stored copy served on an upstream error is never final.
          cacheClass: answer.cacheStatus === "stale" ? null : answer.cacheClass,
          // The proxy answers these no-store too: the stored copy, served
          // because this caller's read was refused or is still running.
          shared:
            answer.cacheStatus !== "stale" &&
            answer.cacheStatus !== "revalidating",
        }
      }
    }
  } catch (error) {
    scan.deps.logger.warn({ message: "Composed part failed", path, error })
    return { status: "unavailable", reason: "upstream" }
  }
}

/**
 * Our own part: a failure degrades it instead of failing the document.
 * An unbound database is `disabled`; any other error (a D1 error, a bad
 * row) is `upstream`.
 */
async function own<T>(
  scan: ScanContext,
  read: () => Promise<T>,
): Promise<Part<T>> {
  try {
    return { status: "ok", data: await read(), cacheClass: null, shared: true }
  } catch (error) {
    if (error instanceof PlatformError && error.code === "service_disabled") {
      return { status: "unavailable", reason: "disabled" }
    }
    scan.deps.logger.warn({ message: "Composed part failed", error })
    return { status: "unavailable", reason: "upstream" }
  }
}

function served<T>(
  part: Part<T>,
):
  | { status: "ok"; data: T }
  | { status: "unavailable"; reason: ScanPartReason } {
  return part.status === "ok"
    ? { status: "ok", data: part.data }
    : { status: "unavailable", reason: part.reason }
}

function isFinal(part: Part<unknown>): boolean {
  return (
    part.status === "ok" &&
    (part.cacheClass === "immutable" || part.cacheClass === "final")
  )
}

/** Addresses named anywhere in a JSON value (for labels). */
function addressesIn(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) into.add(value.toLowerCase())
  } else if (Array.isArray(value)) {
    for (const item of value) addressesIn(item, into)
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) addressesIn(item, into)
  }
  return into
}

const checkpointSchema = z.object({ value: z.string().regex(/^[0-9]+$/) })

const blockIdParam = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,15}|0x[0-9a-fA-F]{64})$/)
  .transform((value) => value.toLowerCase())

export function registerScanEntities(
  app: Hono<ApiEnv>,
  scan: ScanContext,
): void {
  /**
   * A composed document: rendered on a miss, keyed by the head and copy
   * run, and kept a day once `final` says nothing in it can change.
   */
  async function composed(
    c: ApiContext,
    render: () => Promise<{
      body: unknown
      final: boolean
      parts: readonly Part<unknown>[]
    }>,
  ): Promise<Response> {
    const url = new URL(c.req.url)
    const slot = `t${Math.floor(scan.nowMs() / 3_800)}`
    // SCAN_DB unbound or failing: key on the time slot; the SCAN_DB parts
    // answer for themselves (disabled or upstream). A version that failed
    // to read for any reason but an unbound database makes the document
    // unshareable: nothing says what data it was rendered from.
    let versionFailed = false
    const [run, clock] = await Promise.all([
      scan.runVersion().then(
        (version) => version.id,
        (error) => {
          versionFailed = !(
            error instanceof PlatformError && error.code === "service_disabled"
          )
          return slot
        },
      ),
      scan.deps.clock().catch(() => ({ height: null, lastActive: null })),
    ])
    const head = clock.height === null ? slot : String(clock.height)
    // A final document is stored under a version-free key too, so the next
    // request finds it whatever the head.
    const finalKey = {
      resource: `${url.pathname}${url.search}`,
      version: "final",
    }
    return scan.responder.serveComposed(c, {
      finalKey,
      resource: finalKey.resource,
      version: `h${head}-r${run}`,
      caller: callerOf(c),
      render: async () => {
        const rendered = await render()
        return {
          body: rendered.body,
          final: rendered.final,
          shareable: !versionFailed && shareable(rendered.parts),
        }
      },
    })
  }

  app.get("/internal/scan/entities/tx/:hash", (c) => {
    const hash = pathParam(c, "hash", hashParam)
    queryOf(c, {})
    const caller = callerOf(c)
    return composed(c, async () => {
      const [transaction, logs, tokenTransfers, activity, checkpoint] =
        await Promise.all([
          proxied(scan, c, `transactions/${hash}`, transactionSchema, caller),
          proxied(scan, c, `transactions/${hash}/logs`, logsPageSchema, caller),
          proxied(
            scan,
            c,
            `transactions/${hash}/token-transfers`,
            tokenTransfersPageSchema,
            caller,
          ),
          own(scan, async () => {
            const rows = await scan.rows(scanQueries.activityByTx, [
              hash,
              -1,
              0,
              200,
            ])
            return scan.mapRows(rows, activityItem).rows.map((row) => row.item)
          }),
          own(scan, () =>
            scan.first(scanQueries.scanCursor, ["copy:activity"]),
          ),
        ])
      // Labels for the first 50 distinct addresses in document order.
      const named = [
        ...addressesIn([
          served(transaction),
          served(logs),
          served(tokenTransfers),
          served(activity),
        ]),
      ]
      const labels = await own(scan, () => labelsFor(scan, named))
      const copied =
        checkpoint.status === "ok"
          ? checkpointSchema.safeParse(checkpoint.data)
          : null
      const timestamp =
        transaction.status === "ok" && transaction.data.timestamp !== null
          ? Math.floor(Date.parse(transaction.data.timestamp) / 1000)
          : null
      // Our rows for it are complete once the copy has read past its block.
      const activityComplete =
        copied?.success === true &&
        timestamp !== null &&
        Number(copied.data.value) > timestamp + 60
      const final =
        isFinal(transaction) &&
        isFinal(logs) &&
        isFinal(tokenTransfers) &&
        activity.status === "ok" &&
        activityComplete &&
        labels.status === "ok"
      return {
        final,
        parts: [
          transaction,
          logs,
          tokenTransfers,
          activity,
          checkpoint,
          labels,
        ],
        body: {
          data: {
            hash,
            transaction: served(transaction),
            logs: served(logs),
            tokenTransfers: served(tokenTransfers),
            activity: served(activity),
            labels: labels.status === "ok" ? labels.data : {},
            labelLimit: scanLabelLimit,
            labelsTruncated: named.length > scanLabelLimit,
            final,
          },
        },
      }
    })
  })

  app.get("/internal/scan/entities/address/:address", (c) => {
    const address = pathParam(c, "address", addressParam)
    queryOf(c, {})
    const caller = callerOf(c)
    return composed(c, async () => {
      const started = scan.nowMs()
      const [
        summary,
        counters,
        locks,
        borrow,
        activity,
        balances,
        prices,
        snapshot,
      ] = await Promise.all([
        proxied(
          scan,
          c,
          `addresses/${address}`,
          blockscoutAddressSchema,
          caller,
        ),
        proxied(
          scan,
          c,
          `addresses/${address}/counters`,
          addressCountersSchema,
          caller,
        ),
        // The owner's first page of locks, as the chain has them now
        // (live-locks.ts: read at most once a minute per address).
        own(scan, async () =>
          liveOwnerPage(
            scan,
            {
              caller,
              deadline: started + scanLiveDeadlineMs,
              waitUntil: waitUntilOf(c),
            },
            address,
            await page(scan, {
              query: scanQueries.locksByOwner,
              codec: codecs.locksByOwner,
              cursor: undefined,
              limit: 25,
              binds: (key, limit) => [address, ...(key ?? ["", ""]), limit],
              row: lockItem,
              keyOf: (lock) => [lock.escrow, lock.token_id] as const,
              item: servedLock,
            }),
          ),
        ),
        own(scan, async () => {
          const [positions, enclave] = await Promise.all([
            ownerPositions(scan, address),
            enclavePositions(scan, address),
          ])
          return {
            owner: address,
            morpho: positions.morpho,
            trove: positions.trove,
            enclave,
            btc_usd: positions.price,
          }
        }),
        own(scan, () =>
          activityForAddress(scan, address, "any", undefined, 25),
        ),
        // ERC-20 balances, first page of 50: one proxy read, refreshed by
        // the proxy at most every 4 blocks per address. Never
        // token-balances, which answers every token unpaged.
        proxied(
          scan,
          c,
          `addresses/${address}/tokens`,
          tokenBalancesPageSchema,
          caller,
          new URLSearchParams({ type: "ERC-20" }),
        ),
        scan.deps.readPrices().catch(() => null),
        // How old the live snapshot behind the loans is, as on every live
        // Borrow answer. Never rejects: unknown fields are null.
        scan.liveSnapshot(),
      ])
      const tokens: Part<ScanAddressTokens> =
        balances.status === "ok"
          ? { ...balances, data: addressTokens(balances.data, prices) }
          : balances
      // Labels for the address first, then the first addresses its parts
      // name, in document order, within the same limit as a transaction.
      const named = [
        ...new Set([
          address,
          ...addressesIn([
            served(summary),
            served(locks),
            served(borrow),
            served(activity),
          ]),
        ]),
      ]
      const labels = await own(scan, () => labelsFor(scan, named))
      return {
        final: false,
        parts: [summary, counters, labels, locks, borrow, activity, tokens],
        body: {
          data: {
            address,
            summary: served(summary),
            counters: served(counters),
            label:
              labels.status === "ok" ? (labels.data[address] ?? null) : null,
            locks: served(locks),
            borrow:
              borrow.status === "ok"
                ? { ...served(borrow), snapshot }
                : served(borrow),
            activity: served(activity),
            labels: labels.status === "ok" ? labels.data : {},
            labelLimit: scanLabelLimit,
            labelsTruncated: named.length > scanLabelLimit,
            tokens: served(tokens),
          },
        },
      }
    })
  })

  app.get("/internal/scan/entities/block/:id", (c) => {
    const id = pathParam(c, "id", blockIdParam)
    queryOf(c, {})
    const caller = callerOf(c)
    return composed(c, async () => {
      const [block, transactions] = await Promise.all([
        proxied(scan, c, `blocks/${id}`, blockSchema, caller),
        proxied(
          scan,
          c,
          `blocks/${id}/transactions`,
          transactionsPageSchema,
          caller,
        ),
      ])
      const miner =
        block.status === "ok" ? [block.data.miner.hash.toLowerCase()] : []
      const named = [
        ...new Set([...miner, ...addressesIn(served(transactions))]),
      ]
      const labels = await own(scan, () => labelsFor(scan, named))
      const final =
        isFinal(block) &&
        (isFinal(transactions) ||
          (block.status === "ok" && block.data.transactions_count === 0)) &&
        labels.status === "ok"
      return {
        final,
        parts: [block, transactions, labels],
        body: {
          data: {
            id,
            block: served(block),
            transactions: served(transactions),
            labels: labels.status === "ok" ? labels.data : {},
            labelLimit: scanLabelLimit,
            labelsTruncated: named.length > scanLabelLimit,
            final,
          },
        },
      }
    })
  })
}
