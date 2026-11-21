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
  ScanLiveSnapshot,
  ScanLiveTransaction,
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
  liveSnapshotMaxBehind,
  page,
  pathParam,
  queryOf,
  type ScanContext,
} from "./context"
import { activityItem, lockItem, servedLock } from "./items"
import { activityForAddress, codecs } from "./lists"
import { liveOwnerPage, scanLiveDeadlineMs, waitUntilOf } from "./live-locks"
import { liveTransaction } from "./live-tx"
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

/**
 * When the address document stops waiting for its parts, counted from the
 * request's arrival. Matchscan gives the API 3 s for the whole document
 * (`apiReadTimeoutMs` in apps/scan), while a Blockscout read may take the
 * proxy's 4 s and a cold D1 read a second or more: one slow part used to
 * hold the document past Matchscan's timeout, and every card of the page
 * showed "Data unavailable". A part still running here is served as
 * unavailable (`upstream`, so the document is not stored) and finishes in
 * the background, where its proxy or memo entry is ready for the retry.
 *
 * Before the render come the copy run's version and the head (0.3 s each,
 * side by side), two edge lookups (`scanLookupMs` each) and the rate-limit
 * call (`scanSpendMs`): their time comes out of the parts' time, never on
 * top of it. The locks part's own chain deadline (`scanLiveDeadlineMs`,
 * 2.2 s after arrival) comes first, so it serves the stored locks rather
 * than nothing. The labels end by 2.6 s, which leaves 0.4 s for encoding
 * the document and the hop to Matchscan.
 */
export const composedPartsMs = scanLiveDeadlineMs + 100
/** The labels read, which waits for the parts: also from arrival. */
export const composedLabelsMs = composedPartsMs + 300
/**
 * The copy run's version, which keys every composed document (as long as
 * the head read's own bound): past it the document is keyed on the time
 * slot and not shared, as when the read fails.
 */
export const composedVersionMs = 300
/** A render this slow logs where its time went. */
export const composedSlowMs = 1_500

/** Each part's time, and whether it was cut at its deadline. */
type PartTimings = Record<string, { ms: number; late: boolean }>

/**
 * `work`, or `fallback` once the clock passes `until` (`Date.now()` ms)
 * first. Late work is handed to `waitUntil` so it still finishes (and
 * fills its caches), with its failure caught: the copy run's version read
 * may reject (a D1 error) after its deadline, and nothing awaits it then.
 * Exported for tests.
 */
export async function bounded<T>(
  name: string,
  work: Promise<T>,
  until: number,
  fallback: T,
  waitUntil: (task: Promise<unknown>) => void,
  timings: PartTimings,
): Promise<T> {
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<typeof lateMark>((resolve) => {
    timer = setTimeout(() => resolve(lateMark), Math.max(0, until - started))
  })
  try {
    const result = await Promise.race([work, late])
    timings[name] = { ms: Date.now() - started, late: result === lateMark }
    if (result === lateMark) {
      waitUntil(work.then(noop, noop))
      return fallback
    }
    return result
  } finally {
    clearTimeout(timer)
  }
}

const lateMark: unique symbol = Symbol("late")

function noop(): void {}

const latePart: Part<never> = { status: "unavailable", reason: "upstream" }

/** The live snapshot's age when its read was late: unknown, never stale. */
const unknownSnapshot: ScanLiveSnapshot = {
  block: null,
  head: null,
  behind_blocks: null,
  stale: null,
  max_behind_blocks: liveSnapshotMaxBehind,
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

/** A transaction part's block time, unix seconds. */
function timestampOf(
  transaction: Part<{ timestamp: string | null }>,
): number | null {
  return transaction.status === "ok" && transaction.data.timestamp !== null
    ? Math.floor(Date.parse(transaction.data.timestamp) / 1000)
    : null
}

/**
 * Whether the copy has read past a block of this time, so our rows for its
 * transactions are complete. False for an unknown time.
 */
function activityCopied(
  checkpoint: Part<unknown>,
  timestamp: number | null,
): boolean {
  if (timestamp === null || checkpoint.status !== "ok") return false
  const copied = checkpointSchema.safeParse(checkpoint.data)
  return copied.success && Number(copied.data.value) > timestamp + 60
}

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
    /** When the request arrived (`Date.now()` ms). */
    arrived: number,
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
    const versionTimings: PartTimings = {}
    const [run, clock] = await Promise.all([
      bounded(
        "version",
        scan.runVersion().then((version): string | null => version.id),
        arrived + composedVersionMs,
        null,
        waitUntilOf(c),
        versionTimings,
      ).then(
        (version) => {
          // Late: keyed like a failed read, and not shared.
          if (version !== null) return version
          versionFailed = true
          return slot
        },
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
    return composed(c, Date.now(), async () => {
      const started = scan.nowMs()
      const transactionRead = proxied(
        scan,
        c,
        `transactions/${hash}`,
        transactionSchema,
        caller,
      )
      const checkpointRead = own(scan, () =>
        scan.first(scanQueries.scanCursor, ["copy:activity"]),
      )
      const activityRead = own(scan, async () => {
        const rows = await scan.rows(scanQueries.activityByTx, [
          hash,
          -1,
          0,
          200,
        ])
        return scan.mapRows(rows, activityItem).rows.map((row) => row.item)
      })
      // The chain is read only for a transaction the explorer or our copy
      // has yet to reach (live-tx.ts), as soon as the explorer has said:
      // never for one our rows already cover, nor one the copy has read
      // past by the chain's own time (the explorer's may be missing when
      // its part is limited or failing).
      const liveRead = Promise.all([
        transactionRead,
        checkpointRead,
        activityRead,
      ]).then(
        async ([
          transaction,
          checkpoint,
          activity,
        ]): Promise<Part<ScanLiveTransaction> | null> => {
          if (scan.deps.chain?.tx === undefined) return null
          if (activity.status === "ok" && activity.data.length > 0) return null
          if (activityCopied(checkpoint, timestampOf(transaction))) return null
          const read = await liveTransaction(
            scan,
            {
              caller,
              deadline: started + scanLiveDeadlineMs,
              waitUntil: waitUntilOf(c),
            },
            hash,
          )
          if (read === null)
            return { status: "unavailable", reason: "upstream" }
          if (activityCopied(checkpoint, read.timestamp)) return null
          return { status: "ok", data: read, cacheClass: null, shared: true }
        },
      )
      const [transaction, logs, tokenTransfers, activity, checkpoint, live] =
        await Promise.all([
          transactionRead,
          proxied(scan, c, `transactions/${hash}/logs`, logsPageSchema, caller),
          proxied(
            scan,
            c,
            `transactions/${hash}/token-transfers`,
            tokenTransfersPageSchema,
            caller,
          ),
          activityRead,
          checkpointRead,
          liveRead,
        ])
      // Labels for the first 50 distinct addresses in document order.
      const named = [
        ...addressesIn([
          served(transaction),
          served(logs),
          served(tokenTransfers),
          served(activity),
          ...(live === null ? [] : [served(live)]),
        ]),
      ]
      const labels = await own(scan, () => labelsFor(scan, named))
      // Our rows for it are complete once the copy has read past its block.
      const activityComplete = activityCopied(
        checkpoint,
        timestampOf(transaction),
      )
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
          ...(live === null ? [] : [live]),
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
            ...(live === null ? {} : { live: served(live) }),
          },
        },
      }
    })
  })

  app.get("/internal/scan/entities/address/:address", (c) => {
    // Every deadline of this document counts from here (`composedPartsMs`).
    const arrived = Date.now()
    const arrivedAt = scan.nowMs()
    const address = pathParam(c, "address", addressParam)
    queryOf(c, {})
    const caller = callerOf(c)
    return composed(c, arrived, async () => {
      const renderStarted = Date.now()
      const timings: PartTimings = {}
      const waitUntil = waitUntilOf(c)
      function part<T>(name: string, work: Promise<Part<T>>): Promise<Part<T>> {
        return bounded(
          name,
          work,
          arrived + composedPartsMs,
          latePart,
          waitUntil,
          timings,
        )
      }
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
        part(
          "summary",
          proxied(
            scan,
            c,
            `addresses/${address}`,
            blockscoutAddressSchema,
            caller,
          ),
        ),
        part(
          "counters",
          proxied(
            scan,
            c,
            `addresses/${address}/counters`,
            addressCountersSchema,
            caller,
          ),
        ),
        // The owner's first page of locks, as the chain has them now
        // (live-locks.ts: read at most once a minute per address).
        part(
          "locks",
          own(scan, async () =>
            liveOwnerPage(
              scan,
              {
                caller,
                deadline: arrivedAt + scanLiveDeadlineMs,
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
        ),
        part(
          "borrow",
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
        ),
        part(
          "activity",
          own(scan, () =>
            activityForAddress(scan, address, "any", undefined, 25),
          ),
        ),
        // ERC-20 balances, first page of 50: one proxy read, refreshed by
        // the proxy at most every 4 blocks per address. Never
        // token-balances, which answers every token unpaged.
        part(
          "tokens",
          proxied(
            scan,
            c,
            `addresses/${address}/tokens`,
            tokenBalancesPageSchema,
            caller,
            new URLSearchParams({ type: "ERC-20" }),
          ),
        ),
        bounded(
          "prices",
          scan.deps.readPrices().catch(() => null),
          arrived + composedPartsMs,
          null,
          waitUntil,
          timings,
        ),
        // How old the live snapshot behind the loans is, as on every live
        // Borrow answer. Never rejects: unknown fields are null.
        bounded(
          "snapshot",
          scan.liveSnapshot(),
          arrived + composedPartsMs,
          unknownSnapshot,
          waitUntil,
          timings,
        ),
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
      const labels = await bounded(
        "labels",
        own(scan, () => labelsFor(scan, named)),
        arrived + composedLabelsMs,
        latePart,
        waitUntil,
        timings,
      )
      const ms = Date.now() - arrived
      if (ms >= composedSlowMs) {
        // Which part held the document (no address: the route is enough),
        // and how much of the time went before the render.
        scan.deps.logger.warn({
          message: "Composed document slow",
          route: "/internal/scan/entities/address/{address}",
          ms,
          beforeRenderMs: renderStarted - arrived,
          parts: timings,
        })
      }
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
    return composed(c, Date.now(), async () => {
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
