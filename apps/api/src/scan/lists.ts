import { CONTRACTS } from "@matchbox/chain"
import type { ScanActivityItem } from "@matchbox/contracts/scan"
import { EPOCH_SECONDS, EPOCH_ZERO_START, epochStartOf } from "@matchbox/domain"
import { PlatformError } from "@matchbox/server"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiContext, ApiEnv } from "../context"
import { readReadModel } from "../read-models/store"
import {
  addressParam,
  epochParam,
  hashParam,
  newestBlockKey,
  type Page,
  page,
  pageParams,
  pathParam,
  queryOf,
  type ScanContext,
  segmentedPage,
  tokenIdParam,
} from "./context"
import { CursorCodec, keyPart } from "./cursor"
import {
  type ActivityWithRowid,
  activityItem,
  depositItem,
  epochItem,
  gaugeEpochItem,
  lockItem,
  servedLock,
  servedVote,
  voteItem,
} from "./items"
import {
  escrowNamed,
  liveSlot,
  lockDocument,
  scanLiveDeadlineMs,
  waitUntilOf,
} from "./live-locks"
import { labelsFor, scanLabelLimit } from "./lookups"
import { maxKey, maxSortKey, type ScanQuery, scanQueries } from "./queries"
import type { ScanCacheClass } from "./serve"

// /internal/scan activity, locks, gauges, incentives and epochs: each a
// keyset page over one index of matchbox-scan, cached by the last Scan
// copy run (or for a day when sealed).

const blockKey = z.tuple([keyPart.block, keyPart.logIndex, keyPart.rowid])
const blockLogKey = z.tuple([keyPart.block, keyPart.logIndex])

export const codecs = {
  activityFeed: new CursorCodec(
    "activity",
    z.tuple([keyPart.seconds, keyPart.block, keyPart.logIndex, keyPart.rowid]),
  ),
  activityTx: new CursorCodec(
    "activity-tx",
    z.tuple([keyPart.logIndex, keyPart.rowid]),
  ),
  activityAddress: new CursorCodec("activity-address", blockKey),
  activityGauge: new CursorCodec("activity-gauge", blockKey),
  activityLock: new CursorCodec("activity-lock", blockKey),
  activityEpoch: new CursorCodec("activity-epoch", blockKey),
  activityAction: new CursorCodec(
    "activity-action",
    z.tuple([keyPart.seconds, keyPart.block, keyPart.logIndex, keyPart.rowid]),
  ),
  locksByAmount: new CursorCodec(
    "locks-amount",
    z.tuple([keyPart.sortKey, keyPart.tokenId]),
  ),
  /** [range (0 timed, 1 permanent, 2 unknown), unlock, token id]. */
  locksByUnlock: new CursorCodec(
    "locks-unlock",
    z.tuple([z.number().int().min(0).max(2), keyPart.seconds, keyPart.tokenId]),
  ),
  /** [range (0 dated, 1 no creation time), created, token id]. */
  locksByCreated: new CursorCodec(
    "locks-created",
    z.tuple([z.number().int().min(0).max(1), keyPart.seconds, keyPart.tokenId]),
  ),
  locksByOwner: new CursorCodec(
    "locks-owner",
    z.tuple([keyPart.address, keyPart.tokenId]),
  ),
  /** [escrow, token id, epoch, gauge]. */
  votesByOwner: new CursorCodec(
    "votes-owner",
    z.tuple([
      keyPart.address,
      keyPart.tokenId,
      keyPart.seconds,
      keyPart.address,
    ]),
  ),
  /** [escrow, token id, gauge], within one epoch. */
  votesByOwnerInEpoch: new CursorCodec(
    "votes-owner-epoch",
    z.tuple([keyPart.address, keyPart.tokenId, keyPart.address]),
  ),
  votesByLock: new CursorCodec(
    "votes-lock",
    z.tuple([keyPart.seconds, keyPart.address]),
  ),
  voters: new CursorCodec(
    "voters",
    z.tuple([keyPart.sortKey, keyPart.tokenId, keyPart.address]),
  ),
  incentivesByGauge: new CursorCodec(
    "incentives-gauge",
    z.tuple([keyPart.seconds, keyPart.block, keyPart.logIndex]),
  ),
  incentivesByEpoch: new CursorCodec("incentives-epoch", blockLogKey),
  incentivesByDepositor: new CursorCodec("incentives-depositor", blockLogKey),
  gaugeHistory: new CursorCodec("gauge-history", z.tuple([keyPart.seconds])),
  gaugeRanking: new CursorCodec("gauge-ranking", z.tuple([keyPart.rank])),
  epochs: new CursorCodec("epochs", z.tuple([keyPart.seconds])),
} as const

/** veBTC and veMEZO by name or address, lower case. */
const escrows: Record<string, string> = {
  vebtc: CONTRACTS.mainnet.veBTC.toLowerCase(),
  vemezo: CONTRACTS.mainnet.veMEZO.toLowerCase(),
}

export const escrowParam = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(
    z.union([
      z.enum(["vebtc", "vemezo"]).transform((name) => escrows[name] ?? ""),
      z.enum([escrows.vebtc ?? "", escrows.vemezo ?? ""]),
    ]),
  )

const actionParam = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/)
const sourceParam = z.string().regex(/^[A-Z][A-Z_]{1,40}$/)

function activityKey(row: ActivityWithRowid) {
  return [row.item.block_number, row.item.log_index, row.rid] as const
}

function activityServed(row: ActivityWithRowid): ScanActivityItem {
  return row.item
}

/** A raw activity row shaped like a parsed one, for reading its key. */
function activityShell(raw: unknown): ActivityWithRowid {
  const row = (raw ?? {}) as ScanActivityItem & { rid: number }
  return { item: row, rid: row.rid }
}

/**
 * A `run`-class list: keyed by the last copy run; an aggregate list also
 * by the aggregate version (ScanContext.aggregateVersion), and `clock` by
 * whatever the answer took from the clock (the epoch it defaulted to, the
 * epoch "now" falls in for `sealed`), so it retires when that moves.
 */
async function runList(
  scan: ScanContext,
  c: ApiContext,
  render: () => Promise<unknown>,
  options: {
    aggregate?: boolean
    clock?: string
    /** `run` unless the key's clock retires answers sooner. */
    cacheClass?: ScanCacheClass
  } = {},
): Promise<Response> {
  const version =
    options.aggregate === true
      ? await scan.aggregateVersion()
      : (await scan.runVersion()).id
  const url = new URL(c.req.url)
  return scan.responder.serve(c, {
    cacheClass: options.cacheClass ?? "run",
    resource: `${url.pathname}${url.search}`,
    version: `r${version}${options.clock === undefined ? "" : `-${options.clock}`}`,
    caller: callerOf(c),
    render: async () => ({ body: await render() }),
  })
}

/** An answer fit to keep a day: computed, and no row of it skipped. */
function wholeAnswer(body: unknown): boolean {
  const meta =
    typeof body === "object" && body !== null
      ? (body as { meta?: { computed?: unknown; skipped?: unknown } }).meta
      : undefined
  if (meta?.computed === false) return false
  return typeof meta?.skipped !== "number" || meta.skipped === 0
}

/** The epoch the clock is in, for keys of answers that depend on it. */
function clockEpoch(scan: ScanContext): string {
  return `e${epochStartOf(scan.nowSeconds())}`
}

export type AddressRole = "actor" | "recipient" | "sender" | "any"

/** One range scan per role; `any` merges all three. */
const addressQueries: Record<AddressRole, readonly ScanQuery[]> = {
  actor: [scanQueries.activityByActor],
  recipient: [scanQueries.activityByRecipient],
  sender: [scanQueries.activityByTxFrom],
  any: [
    scanQueries.activityByActor,
    scanQueries.activityByRecipient,
    scanQueries.activityByTxFrom,
  ],
}

/**
 * Activity rows naming an address as actor, recipient or transaction
 * sender: one range scan each, merged newest first, each row once.
 */
async function activityForAddress(
  scan: ScanContext,
  address: string,
  role: AddressRole,
  cursor: string | undefined,
  limit: number,
): Promise<Page<ScanActivityItem>> {
  const codec = codecs.activityAddress
  const key = codec.decode(cursor) ?? newestBlockKey
  const queries = addressQueries[role]
  const lists = await Promise.all(
    queries.map((query) =>
      scan.rows(query, [address, key[0], key[1], key[2], limit + 1]),
    ),
  )
  // Each row once (a row can name the address in two roles), before it
  // is mapped, so a bad row is skipped and counted once too.
  const seen = new Set<unknown>()
  const unique = lists.flat().filter((raw) => {
    const rid = (raw as { rid?: unknown } | null)?.rid
    if (seen.has(rid)) return false
    seen.add(rid)
    return true
  })
  // Ordered by each raw row's key, bad rows included, so the page and
  // its cursor step over a bad row instead of stranding what follows.
  const keyed: { raw: unknown; key: readonly [number, number, number] }[] = []
  const unkeyed: unknown[] = []
  for (const raw of unique) {
    const rawKey = codec.keyOf(activityKey(activityShell(raw)))
    if (rawKey === null) unkeyed.push(raw)
    else keyed.push({ raw, key: rawKey })
  }
  keyed.sort(
    (left, right) =>
      right.key[0] - left.key[0] ||
      right.key[1] - left.key[1] ||
      left.key[2] - right.key[2],
  )
  const window = keyed.slice(0, limit)
  const { rows: kept, skipped } = scan.mapRows(
    window.map((entry) => entry.raw),
    activityItem,
  )
  // Unkeyable rows are bad rows too: logged and counted.
  const lost = scan.mapRows(unkeyed, activityItem).skipped
  const last = window.at(-1)
  // More when any scan had more rows than the page, good or not.
  const more = keyed.length > limit || lists.some((list) => list.length > limit)
  return {
    data: kept.map(activityServed),
    nextCursor: more && last !== undefined ? codec.encode(last.key) : null,
    meta: { skipped: skipped + lost },
  }
}

export { activityForAddress }

export function registerScanLists(app: Hono<ApiEnv>, scan: ScanContext): void {
  // -- activity ------------------------------------------------------------
  app.get("/internal/scan/activity", (c) => {
    const params = queryOf(c, pageParams)
    return runList(scan, c, () =>
      page(scan, {
        query: scanQueries.activityFeed,
        codec: codecs.activityFeed,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [...(key ?? [maxKey, maxKey, maxKey, 0]), limit],
        row: activityItem,
        rawRow: activityShell,
        keyOf: (row) =>
          [
            row.item.timestamp,
            row.item.block_number,
            row.item.log_index,
            row.rid,
          ] as const,
        item: activityServed,
      }),
    )
  })

  app.get("/internal/scan/activity/tx/:hash", (c) => {
    const hash = pathParam(c, "hash", hashParam)
    const params = queryOf(c, pageParams)
    return runList(scan, c, () =>
      page(scan, {
        query: scanQueries.activityByTx,
        codec: codecs.activityTx,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [hash, ...(key ?? [-1, 0]), limit],
        row: activityItem,
        rawRow: activityShell,
        keyOf: (row) => [row.item.log_index, row.rid] as const,
        item: activityServed,
      }),
    )
  })

  app.get("/internal/scan/activity/address/:address", (c) => {
    const address = pathParam(c, "address", addressParam)
    const params = queryOf(c, {
      ...pageParams,
      role: z.enum(["actor", "recipient", "sender", "any"]).default("any"),
    })
    return runList(scan, c, () =>
      activityForAddress(
        scan,
        address,
        params.role,
        params.cursor,
        params.limit,
      ),
    )
  })

  function activityByColumn(
    path: string,
    name: string,
    schema: z.ZodType<string | number>,
    query:
      | typeof scanQueries.activityByGauge
      | typeof scanQueries.activityByEpoch,
    codec: typeof codecs.activityGauge,
  ) {
    app.get(path, (c) => {
      const value = pathParam(c, name, schema)
      const params = queryOf(c, pageParams)
      return runList(scan, c, () =>
        page(scan, {
          query,
          codec,
          cursor: params.cursor,
          limit: params.limit,
          binds: (key, limit) => [value, ...(key ?? newestBlockKey), limit],
          row: activityItem,
          rawRow: activityShell,
          keyOf: activityKey,
          item: activityServed,
        }),
      )
    })
  }
  activityByColumn(
    "/internal/scan/activity/gauge/:gauge",
    "gauge",
    addressParam,
    scanQueries.activityByGauge,
    codecs.activityGauge,
  )
  activityByColumn(
    "/internal/scan/activity/epoch/:epoch",
    "epoch",
    epochParam,
    scanQueries.activityByEpoch,
    codecs.activityEpoch,
  )

  app.get("/internal/scan/activity/lock/:escrow/:tokenId", (c) => {
    const escrow = pathParam(c, "escrow", escrowParam)
    const tokenId = pathParam(c, "tokenId", tokenIdParam)
    const params = queryOf(c, pageParams)
    return runList(scan, c, () =>
      page(scan, {
        query: scanQueries.activityByLock,
        codec: codecs.activityLock,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [
          escrow,
          tokenId,
          ...(key ?? newestBlockKey),
          limit,
        ],
        row: activityItem,
        rawRow: activityShell,
        keyOf: activityKey,
        item: activityServed,
      }),
    )
  })

  app.get("/internal/scan/activity/action/:action", (c) => {
    const action = pathParam(c, "action", actionParam)
    const params = queryOf(c, pageParams)
    return runList(scan, c, () =>
      page(scan, {
        query: scanQueries.activityByAction,
        codec: codecs.activityAction,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [
          action,
          ...(key ?? [maxKey, maxKey, maxKey, 0]),
          limit,
        ],
        row: activityItem,
        rawRow: activityShell,
        keyOf: (row) =>
          [
            row.item.timestamp,
            row.item.block_number,
            row.item.log_index,
            row.rid,
          ] as const,
        item: activityServed,
      }),
    )
  })

  // -- locks ---------------------------------------------------------------
  app.get("/internal/scan/locks", (c) => {
    const params = queryOf(c, {
      ...pageParams,
      escrow: escrowParam,
      order: z.enum(["amount", "unlock", "created"]).default("amount"),
    })
    return runList(scan, c, () => {
      const common = {
        cursor: params.cursor,
        limit: params.limit,
        row: lockItem,
        item: servedLock,
      }
      switch (params.order) {
        case "amount":
          return page(scan, {
            ...common,
            query: scanQueries.locksByAmount,
            codec: codecs.locksByAmount,
            binds: (key, limit) => [
              params.escrow,
              ...(key ?? [maxSortKey, ""]),
              limit,
            ],
            keyOf: (lock) => [lock.amount_key, lock.token_id] as const,
          })
        case "unlock":
          // Timed locks soonest first, then permanent, then unknown.
          return segmentedPage(scan, {
            ...common,
            codec: codecs.locksByUnlock,
            segments: [
              {
                query: scanQueries.locksByUnlock,
                binds: (key, limit) => [
                  params.escrow,
                  ...(key === null ? [0, ""] : [key[1], key[2]]),
                  limit,
                ],
              },
              {
                query: scanQueries.locksPermanent,
                binds: (key, limit) => [params.escrow, key?.[2] ?? "", limit],
              },
              {
                query: scanQueries.locksUnlockUnknown,
                binds: (key, limit) => [params.escrow, key?.[2] ?? "", limit],
              },
            ],
            keyOf: (lock) =>
              [
                lock.unlock_at === null ? 2 : lock.unlock_at === 0 ? 1 : 0,
                lock.unlock_at ?? 0,
                lock.token_id,
              ] as const,
          })
        case "created":
          // Newest first, then the locks with no creation time.
          return segmentedPage(scan, {
            ...common,
            codec: codecs.locksByCreated,
            segments: [
              {
                query: scanQueries.locksByCreated,
                binds: (key, limit) => [
                  params.escrow,
                  ...(key === null ? [maxKey, ""] : [key[1], key[2]]),
                  limit,
                ],
              },
              {
                query: scanQueries.locksCreatedUnknown,
                binds: (key, limit) => [params.escrow, key?.[2] ?? "", limit],
              },
            ],
            keyOf: (lock) =>
              [
                lock.created_at === null ? 1 : 0,
                lock.created_at ?? 0,
                lock.token_id,
              ] as const,
          })
      }
    })
  })

  /**
   * One lock: its stored row with the chain's owner, amount and unlock over
   * it, and its voting power and current votes (`live`); a lock the store
   * does not have yet is made from the chain (`indexed: false`). Keyed on
   * the minute as well as the run. The chain read behind it, a "no such
   * lock" or a failure included, is kept at the edge for the minute
   * (live-locks.ts), so the 404 and 500 answers, which are not stored, do
   * not read the chain again.
   */
  app.get("/internal/scan/locks/:escrow/:tokenId", (c) => {
    const escrow = pathParam(c, "escrow", escrowParam)
    const tokenId = pathParam(c, "tokenId", tokenIdParam)
    queryOf(c, {})
    const name = escrowNamed(escrow)
    if (name === null) throw new PlatformError("not_found")
    const started = scan.nowMs()
    return runList(
      scan,
      c,
      async () => {
        const row = await scan.first(scanQueries.lock, [escrow, tokenId])
        const doc = await lockDocument({
          stored: row === null ? null : servedLock(lockItem(row)),
          escrow: name,
          tokenId,
          live: scan.live,
          // One deadline for the whole route, inside Matchscan's 3 s.
          ask: {
            caller: callerOf(c),
            deadline: started + scanLiveDeadlineMs,
            waitUntil: waitUntilOf(c),
          },
        })
        if (doc === null) throw new PlatformError("not_found")
        // Not stored and the chain did not answer: unknown, never a 404.
        if (doc === "unread") throw new PlatformError("internal_error")
        return doc
      },
      // Kept for the minute it is keyed on (`brief`), not a day.
      { clock: liveSlot(scan.nowMs()), cacheClass: "brief" },
    )
  })

  app.get("/internal/scan/locks/:escrow/:tokenId/votes", (c) => {
    const escrow = pathParam(c, "escrow", escrowParam)
    const tokenId = pathParam(c, "tokenId", tokenIdParam)
    const params = queryOf(c, pageParams)
    return runList(scan, c, () =>
      page(scan, {
        query: scanQueries.votesByLock,
        codec: codecs.votesByLock,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [
          escrow,
          tokenId,
          ...(key ?? [maxKey, ""]),
          limit,
        ],
        row: voteItem,
        keyOf: (vote) => [vote.epoch_start, vote.gauge] as const,
        item: servedVote,
      }),
    )
  })

  app.get("/internal/scan/owners/:address/locks", (c) => {
    const owner = pathParam(c, "address", addressParam)
    const params = queryOf(c, pageParams)
    return runList(scan, c, () =>
      page(scan, {
        query: scanQueries.locksByOwner,
        codec: codecs.locksByOwner,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [owner, ...(key ?? ["", ""]), limit],
        row: lockItem,
        keyOf: (lock) => [lock.escrow, lock.token_id] as const,
        item: servedLock,
      }),
    )
  })

  /**
   * The votes of every lock an address owns now, in one read: the owner's
   * locks joined to their votes (votesByOwner), with labels for the
   * page's gauges. By lock, each lock's newest epoch first; `epoch` keeps
   * one epoch. Aggregate-keyed like the other vote lists.
   */
  app.get("/internal/scan/owners/:address/votes", (c) => {
    const owner = pathParam(c, "address", addressParam)
    const params = queryOf(c, { ...pageParams, epoch: epochParam.optional() })
    return runList(
      scan,
      c,
      async () => {
        const votes =
          params.epoch === undefined
            ? await page(scan, {
                query: scanQueries.votesByOwner,
                codec: codecs.votesByOwner,
                cursor: params.cursor,
                limit: params.limit,
                binds: (key, limit) => [
                  owner,
                  ...(key ?? ["", "", maxKey, ""]),
                  limit,
                ],
                row: voteItem,
                keyOf: (vote) =>
                  [
                    vote.escrow,
                    vote.token_id,
                    vote.epoch_start,
                    vote.gauge,
                  ] as const,
                item: servedVote,
              })
            : await page(scan, {
                query: scanQueries.votesByOwnerInEpoch,
                codec: codecs.votesByOwnerInEpoch,
                cursor: params.cursor,
                limit: params.limit,
                binds: (key, limit) => [
                  owner,
                  params.epoch,
                  ...(key ?? ["", "", ""]),
                  limit,
                ],
                row: voteItem,
                keyOf: (vote) =>
                  [vote.escrow, vote.token_id, vote.gauge] as const,
                item: servedVote,
              })
        const gauges = [...new Set(votes.data.map((vote) => vote.gauge))]
        return {
          ...votes,
          labels: await labelsFor(scan, gauges),
          labelLimit: scanLabelLimit,
          labelsTruncated: gauges.length > scanLabelLimit,
        }
      },
      { aggregate: true },
    )
  })

  // -- gauges and incentives -----------------------------------------------
  app.get("/internal/scan/gauges/:gauge/voters", (c) => {
    const gauge = pathParam(c, "gauge", addressParam)
    const params = queryOf(c, { ...pageParams, epoch: epochParam.optional() })
    // No epoch: the current one, which moves with the clock; it is in the
    // key, so the answer retires when the epoch turns.
    const epoch = params.epoch ?? epochStartOf(scan.nowSeconds())
    return runList(
      scan,
      c,
      () =>
        page(scan, {
          query: scanQueries.votersByGauge,
          codec: codecs.voters,
          cursor: params.cursor,
          limit: params.limit,
          binds: (key, limit) => [
            epoch,
            gauge,
            ...(key ?? [maxSortKey, "", ""]),
            limit,
          ],
          row: voteItem,
          keyOf: (vote) =>
            [vote.weight_key, vote.token_id, vote.escrow] as const,
          item: servedVote,
        }),
      { aggregate: true, clock: `e${epoch}` },
    )
  })

  app.get("/internal/scan/gauges/:gauge/incentives", (c) => {
    const gauge = pathParam(c, "gauge", addressParam)
    const params = queryOf(c, pageParams)
    return runList(scan, c, () =>
      page(scan, {
        query: scanQueries.incentivesByGauge,
        codec: codecs.incentivesByGauge,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [
          gauge,
          ...(key ?? [maxKey, maxKey, maxKey]),
          limit,
        ],
        row: depositItem,
        keyOf: (row) =>
          [row.epoch_start, row.block_number, row.log_index] as const,
        item: (row) => row,
      }),
    )
  })

  app.get("/internal/scan/gauges/:gauge/epochs", (c) => {
    const gauge = pathParam(c, "gauge", addressParam)
    const params = queryOf(c, pageParams)
    return runList(
      scan,
      c,
      async () => {
        const dirty = await scan.dirty("epoch")
        const history = await page(scan, {
          query: scanQueries.gaugeHistory,
          codec: codecs.gaugeHistory,
          cursor: params.cursor,
          limit: params.limit,
          binds: (key, limit) => [gauge, ...(key ?? [maxKey]), limit],
          row: gaugeEpochItem,
          keyOf: (row) => [row.epoch_start] as const,
          item: (row) => ({
            ...row,
            complete: !dirty.has(String(row.epoch_start)),
          }),
        })
        return {
          ...history,
          meta: await aggregateMeta(
            history.data.every((row) => row.complete),
            history.meta.skipped,
          ),
        }
      },
      { aggregate: true },
    )
  })

  app.get("/internal/scan/depositors/:address/incentives", (c) => {
    const depositor = pathParam(c, "address", addressParam)
    const params = queryOf(c, pageParams)
    return runList(scan, c, () =>
      page(scan, {
        query: scanQueries.incentivesByDepositor,
        codec: codecs.incentivesByDepositor,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [depositor, ...(key ?? [maxKey, maxKey]), limit],
        row: depositItem,
        keyOf: (row) => [row.block_number, row.log_index] as const,
        item: (row) => row,
      }),
    )
  })

  // Pro's gauge documents (READ_DB), served under Scan's own cache class:
  // keyed by the document's etag, so a new publish retires them.
  async function proDocument(
    c: ApiContext,
    kind: "gauges" | "gauge-profile",
    key: string,
  ): Promise<Response> {
    const version = await scan.readModelVersion(kind, key)
    if (version === null) throw new PlatformError("not_found")
    const url = new URL(c.req.url)
    return scan.responder.serve(c, {
      cacheClass: "doc",
      resource: url.pathname,
      version: `d${version.etag}-${version.updated_at}`,
      caller: callerOf(c),
      render: async () => {
        const stored = await readReadModel(
          scan.read(),
          scan.deps.network,
          kind,
          key,
        )
        if (stored === null) throw new PlatformError("not_found")
        return { body: { data: stored.data, meta: stored.meta } }
      },
    })
  }

  app.get("/internal/scan/gauges", (c) => {
    queryOf(c, {})
    return proDocument(c, "gauges", "current")
  })

  app.get("/internal/scan/gauges/:gauge", (c) => {
    const gauge = pathParam(c, "gauge", addressParam)
    queryOf(c, {})
    return proDocument(c, "gauge-profile", gauge)
  })

  // -- epochs --------------------------------------------------------------
  app.get("/internal/scan/epochs", (c) => {
    const params = queryOf(c, pageParams)
    return runList(
      scan,
      c,
      async () => {
        const dirty = await scan.dirty("epoch")
        const epochs = await page(scan, {
          query: scanQueries.epochs,
          codec: codecs.epochs,
          cursor: params.cursor,
          limit: params.limit,
          binds: (key, limit) => [...(key ?? [maxKey]), limit],
          row: (raw) => epochItem(raw, scan.nowSeconds(), dirty),
          keyOf: (row) => [row.epoch_start] as const,
          item: (row) => row,
        })
        return {
          ...epochs,
          meta: await aggregateMeta(
            epochs.data.every((row) => row.complete),
            epochs.meta.skipped,
          ),
        }
        // `sealed` is taken from the clock.
      },
      { aggregate: true, clock: clockEpoch(scan) },
    )
  })

  /**
   * Sealed: ended, the one-time history fill applied (`history_filled` 1:
   * before it an old epoch may have no row yet), its totals row present,
   * its aggregates not waiting to be recomputed, and a copy run finished
   * an hour after its end. Never while stale (copies failing, a re-fill
   * due, a table halted). Without a status row nothing is sealed.
   */
  async function sealedEpoch(epoch: number): Promise<boolean> {
    const end = epoch + EPOCH_SECONDS
    if (end > scan.nowSeconds()) return false
    const run = await scan.runVersion()
    if (
      run.historyFilled !== true ||
      run.stale ||
      run.finishedAt === null ||
      run.finishedAt < end + 3_600
    ) {
      return false
    }
    const [dirty, row] = await Promise.all([
      scan.dirty("epoch"),
      scan.first(scanQueries.epoch, [epoch]),
    ])
    return !dirty.has(String(epoch)) && row !== null
  }

  /** The meta of an aggregate response (ScanContext.aggregateMeta). */
  function aggregateMeta(complete: boolean, skipped = 0) {
    return scan.aggregateMeta(complete, skipped)
  }

  function epochDocument(
    c: ApiContext,
    render: () => Promise<unknown>,
    epoch: number,
  ): Promise<Response> {
    return (async () => {
      const url = new URL(c.req.url)
      const resource = `${url.pathname}${url.search}`
      const sealed = await sealedEpoch(epoch)
      // Unsealed: by the aggregates and the epoch the clock is in (the
      // epoch's `sealed` flag, and its 404 before it starts).
      const version = `r${await scan.aggregateVersion()}-${clockEpoch(scan)}`
      if (!sealed) {
        return scan.responder.serve(c, {
          cacheClass: "run",
          resource,
          version,
          caller: callerOf(c),
          render: async () => ({ body: await render() }),
        })
      }
      // Sealed: kept a day, but only an answer that is whole. One that
      // says `computed: false` or skipped a bad row is stored under the
      // versioned key instead, as `run`.
      return scan.responder.serveComposed(c, {
        finalKey: { resource, version: "" },
        resource,
        version,
        cacheClass: "run",
        caller: callerOf(c),
        render: async () => {
          const body = await render()
          return { body, final: wholeAnswer(body) }
        },
      })
    })()
  }

  app.get("/internal/scan/epochs/:epoch", (c) => {
    const epoch = pathParam(c, "epoch", epochParam)
    queryOf(c, {})
    return epochDocument(
      c,
      async () => {
        // Before Epoch 0 or not started: no such epoch.
        if (epoch < EPOCH_ZERO_START || epoch > scan.nowSeconds()) {
          throw new PlatformError("not_found")
        }
        const [row, dirty] = await Promise.all([
          scan.first(scanQueries.epoch, [epoch]),
          scan.dirty("epoch"),
        ])
        if (row === null) {
          // A real epoch whose aggregates are not computed yet: not zero.
          return {
            data: null,
            meta: { ...(await aggregateMeta(false)), computed: false },
          }
        }
        const totals = epochItem(row, scan.nowSeconds(), dirty)
        const sources = [
          ...new Set([
            ...Object.keys(totals.vote_weight),
            ...Object.keys(totals.top_gauge),
          ]),
        ].sort()
        const [ranked, killed, incentives] = await Promise.all([
          Promise.all(
            sources.map(async (source) => {
              const rows = await scan.rows(scanQueries.gaugeRanking, [
                epoch,
                source,
                0,
                5,
              ])
              return [source, scan.mapRows(rows, gaugeEpochItem)] as const
            }),
          ),
          Promise.all(
            sources.map(async (source) => {
              const rows = await scan.rows(scanQueries.killedGauges, [
                epoch,
                source,
              ])
              return [source, scan.mapRows(rows, gaugeEpochItem)] as const
            }),
          ),
          page(scan, {
            query: scanQueries.incentivesByEpoch,
            codec: codecs.incentivesByEpoch,
            cursor: undefined,
            limit: 20,
            binds: (key, limit) => [epoch, ...(key ?? [maxKey, maxKey]), limit],
            row: depositItem,
            keyOf: (deposit) =>
              [deposit.block_number, deposit.log_index] as const,
            item: (deposit) => deposit,
          }),
        ])
        const skipped =
          [...ranked, ...killed].reduce(
            (sum, [, mapped]) => sum + mapped.skipped,
            0,
          ) + incentives.meta.skipped
        return {
          data: {
            epoch: totals,
            topGauges: Object.fromEntries(
              ranked.map(([source, mapped]) => [source, mapped.rows]),
            ),
            killedGauges: Object.fromEntries(
              killed
                .filter(([, mapped]) => mapped.rows.length > 0)
                .map(([source, mapped]) => [source, mapped.rows]),
            ),
            incentives,
          },
          meta: {
            ...(await aggregateMeta(totals.complete, skipped)),
            computed: true,
          },
        }
      },
      epoch,
    )
  })

  app.get("/internal/scan/epochs/:epoch/gauges", (c) => {
    const epoch = pathParam(c, "epoch", epochParam)
    const params = queryOf(c, { ...pageParams, source: sourceParam })
    return epochDocument(
      c,
      async () => {
        const dirty = await scan.dirty("epoch")
        const ranking = await page(scan, {
          query: scanQueries.gaugeRanking,
          codec: codecs.gaugeRanking,
          cursor: params.cursor,
          limit: params.limit,
          binds: (key, limit) => [epoch, params.source, ...(key ?? [0]), limit],
          row: gaugeEpochItem,
          keyOf: (row) => [row.rank ?? 0] as const,
          item: (row) => row,
        })
        // Killed gauges are unranked; listed beside the ranking, not hidden.
        const killed = await scan.rows(scanQueries.killedGauges, [
          epoch,
          params.source,
        ])
        const killedGauges = scan.mapRows(killed, gaugeEpochItem)
        return {
          ...ranking,
          killed: killedGauges.rows,
          meta: await aggregateMeta(
            !dirty.has(String(epoch)),
            ranking.meta.skipped + killedGauges.skipped,
          ),
        }
      },
      epoch,
    )
  })

  app.get("/internal/scan/epochs/:epoch/incentives", (c) => {
    const epoch = pathParam(c, "epoch", epochParam)
    const params = queryOf(c, pageParams)
    return epochDocument(
      c,
      () =>
        page(scan, {
          query: scanQueries.incentivesByEpoch,
          codec: codecs.incentivesByEpoch,
          cursor: params.cursor,
          limit: params.limit,
          binds: (key, limit) => [epoch, ...(key ?? [maxKey, maxKey]), limit],
          row: depositItem,
          keyOf: (row) => [row.block_number, row.log_index] as const,
          item: (row) => row,
        }),
      epoch,
    )
  })
}
