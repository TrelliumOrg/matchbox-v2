import {
  type ActivityCategory,
  type ActivityRow,
  activityTypesIn,
  type WalletActivity,
  type WalletRewards,
} from "@matchbox/contracts/read-models"
import {
  demoEpoch,
  demoGauges,
  demoTokens,
} from "@matchbox/contracts/read-models/fixtures"
import {
  EPOCH_SECONDS,
  EPOCH_ZERO_START,
  epochIndexFor,
  epochStartOf,
} from "@matchbox/domain"

/**
 * Wallets with a long history, paged like the API: the newest rows as the
 * stored document holds them, then the rest from the stored history
 * (apps/api/src/read-models/wallet-history.ts), a cursor `h.<ts>[.<id>]`,
 * pages ending where an epoch ends, at most 100 rows.
 *
 * `longHistoryWallet` voted in every epoch from Epoch 0 to the live one
 * and claimed every epoch after, and made a lock the week before Epoch 0.
 * `pendingHistoryWallet` has the same rows but its stored history stops
 * at Epoch 20, with older epochs not stored yet.
 */
export const longHistoryWallet = `0x5050${"0".repeat(32)}0050`
export const pendingHistoryWallet = `0x5050${"0".repeat(32)}0051`
/** The long history, whose downloads the fixtures refuse as a 429 would. */
export const busyExportWallet = `0x5050${"0".repeat(32)}0429`

/** Rows the stored document holds, newest first. */
const documentRows = 40
/** The pending wallet's stored history goes back to this epoch. */
const pendingFrom = 20
const pageMax = 100

function hash(kind: number, epoch: number): string {
  const body = `${kind.toString(16).padStart(2, "0")}${(epoch + 1).toString(16).padStart(6, "0")}`
  return `0x${body.repeat(8)}`
}

const lock = { escrow: "vemezo" as const, tokenId: "5050" }

/** Every epoch from 0 to the one holding `now`, oldest first. */
function epochsUpTo(now: number): number[] {
  const last = epochIndexFor(epochStartOf(now))
  return Array.from({ length: last + 1 }, (_, index) => index)
}

function epochRef(number: number) {
  const ref = demoEpoch(number)
  return { number, start: ref.start, end: ref.end }
}

/** Each epoch's claim pays 0.50 USD in MEZO. */
const claimUsd = "0.50"
const claimMezo = "2.717391"

/**
 * Its value when claimed (apps/api/src/read-models/claim-prices.ts): MEZO
 * at $0.184 that day, except the first two claims, whose days had no
 * price, and claims under 3 days old, whose day is not settled yet: those
 * carry an estimate.
 */
function valueWhenClaimed(epoch: number, claimAt: number, now: number) {
  const day = new Date(claimAt * 1000).toISOString().slice(0, 10)
  if (claimAt > now - 3 * 86_400) {
    // Settling: an estimate at the same price, final 3 days on.
    const finalOn = new Date(Date.parse(`${day}T00:00:00Z`) + 3 * 86_400_000)
    return {
      estimate: {
        usd: claimUsd,
        tokens: [
          { token: demoTokens.mezo.address, price: "0.184", usd: claimUsd },
        ],
        finalOn: finalOn.toISOString().slice(0, 10),
      },
    }
  }
  const priced = epoch > 2
  return {
    atClaim: {
      usd: priced ? claimUsd : "0.00",
      tokens: [
        {
          token: demoTokens.mezo.address,
          price: priced ? "0.184" : null,
          usd: priced ? claimUsd : null,
          day,
          source: priced ? ("coingecko" as const) : null,
          pricedAs: priced ? ("mezo" as const) : null,
        },
      ],
    },
  }
}

function rowsOf(wallet: string, now: number): ActivityRow[] {
  const rows: ActivityRow[] = [
    {
      type: "lock-create",
      id: `${hash(3, 0)}-0`,
      txHash: hash(3, 0),
      block: 1_000,
      // Thursday 4 Dec 2025, the week before Epoch 0.
      timestamp: EPOCH_ZERO_START - 7 * 86_400 + 3_600,
      status: "confirmed",
      actor: wallet,
      lock,
      amount: { token: demoTokens.mezo, amount: "5000.00", usd: "920.00" },
      unlocksAt: EPOCH_ZERO_START + 104 * EPOCH_SECONDS,
    },
  ]
  for (const epoch of epochsUpTo(now)) {
    const start = EPOCH_ZERO_START + epoch * EPOCH_SECONDS
    const claimAt = start + 3_600
    if (epoch >= 1 && claimAt <= now) {
      rows.push({
        type: "claim",
        id: `${hash(2, epoch)}-4`,
        txHash: hash(2, epoch),
        block: 2_000 + epoch * 10,
        timestamp: claimAt,
        status: "confirmed",
        actor: wallet,
        epoch: epochRef(epoch - 1),
        rewards: {
          usd: claimUsd,
          tokens: [
            { token: demoTokens.mezo, amount: claimMezo, usd: claimUsd },
          ],
        },
        ...valueWhenClaimed(epoch, claimAt, now),
        locks: [lock],
        gauges: [demoGauges.kilnLabs],
      })
    }
    const voteAt = start + 2 * 86_400
    if (voteAt <= now) {
      rows.push({
        type: "vote",
        id: `${hash(1, epoch)}-2`,
        txHash: hash(1, epoch),
        block: 2_005 + epoch * 10,
        timestamp: voteAt,
        status: "confirmed",
        actor: wallet,
        lock,
        epoch: epochRef(epoch),
        votes: "5000",
        allocations: [{ gauge: demoGauges.kilnLabs, basisPoints: 10_000 }],
      })
    }
  }
  return rows.sort(
    (a, b) => b.timestamp - a.timestamp || (a.id < b.id ? 1 : -1),
  )
}

export function isHistoryWallet(address: string): boolean {
  const lower = address.toLowerCase()
  return (
    lower === longHistoryWallet ||
    lower === pendingHistoryWallet ||
    lower === busyExportWallet
  )
}

function epochOf(row: ActivityRow): number {
  return row.timestamp < EPOCH_ZERO_START
    ? -1
    : epochIndexFor(epochStartOf(row.timestamp))
}

function cursorAt(value: string): { ts: number; id: string | null } | null {
  const match = /^h\.(\d+)(?:\.(.+))?$/.exec(value)
  return match === null ? null : { ts: Number(match[1]), id: match[2] ?? null }
}

/** One page of a history wallet's activity, as the API pages it. */
export function historyActivity(
  address: string,
  category: ActivityCategory | null,
  cursor: string | null,
  limit: number,
  nowMs: number,
): WalletActivity {
  const wallet = address.toLowerCase()
  const all = rowsOf(wallet, Math.floor(nowMs / 1000))
  const types = category === null ? null : new Set(activityTypesIn(category))
  const fits = (row: ActivityRow) => types === null || types.has(row.type)
  const document = all.slice(0, documentRows)
  const stored =
    wallet === pendingHistoryWallet
      ? all.filter((row) => epochOf(row) >= pendingFrom)
      : all
  const complete = wallet !== pendingHistoryWallet
  const at = cursor === null ? null : cursorAt(cursor)
  if (at === null) {
    const rows = document.filter(fits)
    const start =
      cursor === null ? 0 : rows.findIndex((row) => row.id === cursor) + 1
    const page = rows.slice(start, start + limit)
    const last = page.at(-1)
    if (start + limit < rows.length && last !== undefined) {
      return { address, rows: page, nextCursor: last.id }
    }
    const oldest = document.at(-1)?.timestamp
    const older = stored.some(
      (row) => oldest !== undefined && row.timestamp < oldest,
    )
    return older && oldest !== undefined
      ? { address, rows: page, nextCursor: `h.${oldest}` }
      : { address, rows: page, nextCursor: null, pending: !complete }
  }
  const rest = stored
    .filter(fits)
    .filter((row) =>
      at.id === null
        ? row.timestamp < at.ts
        : row.timestamp < at.ts || (row.timestamp === at.ts && row.id < at.id),
    )
  let take = Math.min(limit, pageMax, rest.length)
  while (
    take > 0 &&
    take < rest.length &&
    take < pageMax &&
    epochOf(rest[take] as ActivityRow) ===
      epochOf(rest[take - 1] as ActivityRow)
  ) {
    take += 1
  }
  const page = rest.slice(0, take)
  const last = page.at(-1)
  if (rest.length > take && last !== undefined) {
    return {
      address,
      rows: page,
      nextCursor: `h.${last.timestamp}.${last.id}`,
    }
  }
  return { address, rows: page, nextCursor: null, pending: !complete }
}

/** Cents of a "0.50" figure, summed exactly. */
function sumUsd(values: readonly string[]): string {
  let cents = 0n
  for (const value of values) {
    const [whole = "0", fraction = ""] = value.split(".")
    cents += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2))
  }
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`
}

/** The rewards document: the 12 latest claims, Earned over every claim. */
export function historyRewards(address: string, nowMs: number): WalletRewards {
  const wallet = address.toLowerCase()
  const claims = rowsOf(wallet, Math.floor(nowMs / 1000)).flatMap((row) =>
    row.type === "claim" && row.epoch !== null
      ? [{ ...row, epoch: row.epoch }]
      : [],
  )
  const known =
    wallet === pendingHistoryWallet
      ? claims.filter((row) => epochOf(row) >= pendingFrom)
      : claims
  const epochs = known.map((row) => row.epoch.number)
  const valued = known.flatMap((row) =>
    row.atClaim === undefined ? [] : [row.atClaim],
  )
  return {
    address,
    epoch: null,
    readyToClaim: { usd: "0", tokens: [] },
    byLock: [],
    // At the claims' values when claimed, as the snapshot sums it.
    earned: {
      usd: sumUsd(valued.map((value) => value.usd)),
      fromEpoch: epochs.length === 0 ? null : Math.min(...epochs),
      toEpoch: epochs.length === 0 ? null : Math.max(...epochs),
      whenClaimed: {
        unpriced: valued.filter((value) =>
          value.tokens.some((token) => token.price === null),
        ).length,
        pending: known.length - valued.length,
        // Every pending fixture claim is in its settling days.
        settling: known.length - valued.length,
      },
    },
    history: claims.slice(0, 12).map((row) => ({
      epoch: row.epoch,
      claimedAt: row.timestamp,
      rewards: row.rewards,
      ...(row.atClaim === undefined ? {} : { atClaim: row.atClaim }),
      ...(row.estimate === undefined ? {} : { estimate: row.estimate }),
      txHash: row.txHash,
      block: row.block ?? 0,
    })),
  }
}
