import { parseJson } from "@matchbox/contracts/encoding"
import {
  epochSeconds,
  epochStartOf,
  marketMetaSchema,
  type VoterKind,
  voterKindSchema,
  voterTotalWeightsSchema,
} from "@matchbox/contracts/market"
import type { NetworkSlug } from "@matchbox/contracts/network"
import type { Logger } from "@matchbox/logger"
import { z } from "zod"
import { aprPercent, sumUsd } from "./money"
import { votingTokenUsd } from "./snapshot"
import type { MarketDatabase } from "./store"

// Each voter's epoch in MARKET_DB (`market_voter_epochs`): the priced
// rewards on its gauges, its total vote weight, and the voting APR they
// give, by the very formula each gauge's projected APR uses (`aprPercent`
// over the summed rewards and the voter's whole weight), from the rows the
// market cron stored. So an epoch's figure is what its last snapshot said,
// and agrees with the gauges' own APRs. An escrow's row adds its voters'
// APRs (`escrowAprPercent`).
//
// Each cron run after the snapshot: the current epoch at most every 30
// minutes (written only when a figure changed), and one past epoch that
// has no final row yet, so the stored history fills itself, oldest gaps
// newest first, with no script.

export const voterEpochsRefreshSeconds = 30 * 60

const voters = voterKindSchema.options

/** Rows per escrow too: veBTC votes on pools and validators, veMEZO on boost and third-party gauges. */
export const escrowVoters = {
  vebtc: ["pools", "validators"],
  vemezo: ["boost", "third-party"],
} as const satisfies Record<string, readonly VoterKind[]>

export type VoterEpochKey = VoterKind | keyof typeof escrowVoters

const voterKeySchema = z.enum([...voters, "vebtc", "vemezo"])

export type VoterEpochRow = {
  network: NetworkSlug
  epoch_start: number
  voter: VoterEpochKey
  total_usd: string | null
  weight: string | null
  voting_token_usd: string | null
  apr_percent: string | null
  funded_gauges: number
  unpriced_rewards: number
  open: 0 | 1
  updated_at: number
}

const epochHeaderSchema = z.object({
  total_weights: z.string(),
  prices: z.string(),
})

const rewardRowSchema = z.object({
  voter: voterKindSchema,
  incentives: z.string(),
})

const incentivesSchema = z.object({
  totalUsd: z.string().nullable(),
  unpricedRewards: z.number().int().nonnegative(),
})

function jsonOf<Schema extends z.ZodType>(
  schema: Schema,
  text: string,
): z.output<Schema> | null {
  const parsed = parseJson(text)
  if (!parsed.ok) return null
  const result = schema.safeParse(parsed.value)
  return result.success ? result.data : null
}

/**
 * An escrow's voting APR: what one lock earns voting its full power on
 * each of its escrow's ballots. Each voter keeps its own ballot, so one
 * lock votes on both (on 15 Nov 2026, 22 veBTC locks voted on both
 * PoolsVoter and ValidatorsVoter, 1,034 of the validators' 1,040 BTC of
 * votes). So it is the sum of each voter's APR; the APR of the summed
 * rewards over the summed weights counts such a lock twice. A voter with
 * no rewards adds 0. null when a voter's weight or the token's price is
 * unknown, a voter has rewards but no votes, or a voter's rewards are all
 * unpriced (`unpriced` > 0 with no `totalUsd`): its part is not known,
 * and the other voter's alone is not the escrow's.
 */
export function escrowAprPercent(
  parts: readonly {
    totalUsd: string | null
    weight: bigint | null
    /** Reward tokens with no price (the gauges' `unpricedRewards`). */
    unpriced?: number
  }[],
  votingTokenUsd: string | null,
): string | null {
  if (votingTokenUsd === null) return null
  const aprs: string[] = []
  for (const part of parts) {
    if (part.weight === null) return null
    if (part.totalUsd === null) {
      if ((part.unpriced ?? 0) > 0) return null
      continue
    }
    const apr = aprPercent({
      totalUsd: part.totalUsd,
      weight: part.weight,
      votingTokenUsd,
    })
    if (apr === null) return null
    aprs.push(apr)
  }
  return sumUsd(aprs)
}

/**
 * One epoch's rows from its stored header and funded gauges, or null when
 * the epoch has no header (never snapshotted).
 */
export async function voterEpochRows(
  db: MarketDatabase,
  network: NetworkSlug,
  epochStart: number,
  input: { open: boolean; nowSeconds: number },
): Promise<VoterEpochRow[] | null> {
  const header = await db
    .prepare(
      `SELECT total_weights, prices FROM market_epochs
       WHERE network = ? AND epoch_start = ?`,
    )
    .bind(network, epochStart)
    .first()
  const parsedHeader = epochHeaderSchema.safeParse(header)
  if (!parsedHeader.success) return null
  const weights = jsonOf(
    voterTotalWeightsSchema,
    parsedHeader.data.total_weights,
  )
  const prices = jsonOf(
    marketMetaSchema.shape.prices,
    parsedHeader.data.prices,
  ) ?? { btcUsd: null, mezoUsd: null }
  const result = await db
    .prepare(
      `SELECT voter, incentives FROM market_gauges
       WHERE network = ? AND epoch_start = ? AND has_rewards = 1`,
    )
    .bind(network, epochStart)
    .all()
  const totals = new Map<
    VoterKind,
    { usd: string[]; funded: number; unpriced: number }
  >(voters.map((voter) => [voter, { usd: [], funded: 0, unpriced: 0 }]))
  for (const row of result.results) {
    const parsed = rewardRowSchema.safeParse(row)
    if (!parsed.success) continue
    const incentives = jsonOf(incentivesSchema, parsed.data.incentives)
    const entry = totals.get(parsed.data.voter)
    if (incentives === null || entry === undefined) continue
    entry.funded += 1
    entry.unpriced += incentives.unpricedRewards
    if (incentives.totalUsd !== null) entry.usd.push(incentives.totalUsd)
  }
  const kindUsd = (kind: VoterKind): string | null => {
    const usd = totals.get(kind)?.usd ?? []
    return usd.length === 0 ? null : sumUsd(usd)
  }
  const kindWeight = (kind: VoterKind): bigint | null => {
    const value = weights?.[kind] ?? null
    return value === null ? null : BigInt(value)
  }
  // A voter's row is its own ballot; an escrow's row adds its voters' APRs
  // (`escrowAprPercent`). Its rewards and weight are the voters' sums
  // (votes cast across both ballots), shown for reference only.
  const row = (
    voter: VoterEpochKey,
    kinds: readonly VoterKind[],
  ): VoterEpochRow => {
    const parts = kinds.map(
      (kind) => totals.get(kind) ?? { usd: [], funded: 0, unpriced: 0 },
    )
    const entry = {
      usd: parts.flatMap((part) => part.usd),
      funded: parts.reduce((sum, part) => sum + part.funded, 0),
      unpriced: parts.reduce((sum, part) => sum + part.unpriced, 0),
    }
    const totalUsd = entry.usd.length === 0 ? null : sumUsd(entry.usd)
    const kindWeights = kinds.map((kind) => weights?.[kind] ?? null)
    const weight = kindWeights.some((value) => value === null)
      ? null
      : kindWeights
          .reduce((sum, value) => sum + BigInt(value ?? "0"), 0n)
          .toString()
    // Every kind of one escrow is valued at the same token's price.
    const price = votingTokenUsd(kinds[0] ?? "pools", prices)
    return {
      network,
      epoch_start: epochStart,
      voter,
      total_usd: totalUsd,
      weight,
      voting_token_usd: price,
      apr_percent:
        kinds.length > 1
          ? escrowAprPercent(
              kinds.map((kind) => ({
                totalUsd: kindUsd(kind),
                weight: kindWeight(kind),
                unpriced: totals.get(kind)?.unpriced ?? 0,
              })),
              price,
            )
          : totalUsd === null || weight === null || price === null
            ? null
            : aprPercent({
                totalUsd,
                weight: BigInt(weight),
                votingTokenUsd: price,
              }),
      funded_gauges: entry.funded,
      unpriced_rewards: entry.unpriced,
      open: input.open ? 1 : 0,
      updated_at: input.nowSeconds,
    }
  }
  return [
    ...voters.map((voter) => row(voter, [voter])),
    row("vebtc", escrowVoters.vebtc),
    row("vemezo", escrowVoters.vemezo),
  ]
}

const upsertSql = `INSERT INTO market_voter_epochs (network, epoch_start, voter,
  total_usd, weight, voting_token_usd, apr_percent, funded_gauges,
  unpriced_rewards, open, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (network, epoch_start, voter) DO UPDATE SET
  total_usd = excluded.total_usd, weight = excluded.weight,
  voting_token_usd = excluded.voting_token_usd,
  apr_percent = excluded.apr_percent, funded_gauges = excluded.funded_gauges,
  unpriced_rewards = excluded.unpriced_rewards, open = excluded.open,
  updated_at = excluded.updated_at
WHERE market_voter_epochs.total_usd IS NOT excluded.total_usd
  OR market_voter_epochs.weight IS NOT excluded.weight
  OR market_voter_epochs.voting_token_usd IS NOT excluded.voting_token_usd
  OR market_voter_epochs.apr_percent IS NOT excluded.apr_percent
  OR market_voter_epochs.funded_gauges IS NOT excluded.funded_gauges
  OR market_voter_epochs.unpriced_rewards IS NOT excluded.unpriced_rewards
  OR market_voter_epochs.open IS NOT excluded.open`

async function write(
  db: MarketDatabase,
  rows: readonly VoterEpochRow[],
): Promise<void> {
  if (rows.length === 0) return
  await db.batch(
    rows.map((row) =>
      db
        .prepare(upsertSql)
        .bind(
          row.network,
          row.epoch_start,
          row.voter,
          row.total_usd,
          row.weight,
          row.voting_token_usd,
          row.apr_percent,
          row.funded_gauges,
          row.unpriced_rewards,
          row.open,
          row.updated_at,
        ),
    ),
  )
}

/**
 * The newest past epoch with a header but no final row (none, or one
 * written while it ran): the next one to settle.
 */
async function nextPastEpoch(
  db: MarketDatabase,
  network: NetworkSlug,
  current: number,
): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT e.epoch_start AS epoch_start FROM market_epochs e
       WHERE e.network = ? AND e.epoch_start < ?
         AND NOT EXISTS (
           SELECT 1 FROM market_voter_epochs v
           WHERE v.network = e.network AND v.epoch_start = e.epoch_start
             AND v.open = 0)
       ORDER BY e.epoch_start DESC LIMIT 1`,
    )
    .bind(network, current)
    .first()
  const parsed = z.object({ epoch_start: z.number().int() }).safeParse(row)
  return parsed.success ? parsed.data.epoch_start : null
}

export type VoterEpochsResult = {
  current: "written" | "fresh" | "missing"
  settled: number | null
}

/** One cron run's refresh; never throws (the snapshot already stands). */
export async function refreshVoterEpochs(input: {
  db: MarketDatabase
  network: NetworkSlug
  nowSeconds: number
  logger: Logger
}): Promise<VoterEpochsResult | null> {
  const { db, network, nowSeconds } = input
  try {
    const current = epochStartOf(nowSeconds)
    const result: VoterEpochsResult = { current: "fresh", settled: null }
    const last = await db
      .prepare(
        `SELECT max(updated_at) AS at FROM market_voter_epochs
         WHERE network = ? AND epoch_start = ?`,
      )
      .bind(network, current)
      .first()
    const at = z.object({ at: z.number().int().nullable() }).safeParse(last)
    const lastWrite = at.success ? at.data.at : null
    if (
      lastWrite === null ||
      nowSeconds - lastWrite >= voterEpochsRefreshSeconds
    ) {
      const rows = await voterEpochRows(db, network, current, {
        open: true,
        nowSeconds,
      })
      if (rows === null) result.current = "missing"
      else {
        await write(db, rows)
        result.current = "written"
      }
    }
    const past = await nextPastEpoch(db, network, current)
    if (past !== null && past + epochSeconds <= nowSeconds) {
      const rows = await voterEpochRows(db, network, past, {
        open: false,
        nowSeconds,
      })
      if (rows !== null) {
        await write(db, rows)
        result.settled = past
      }
    }
    return result
  } catch (error) {
    input.logger.warn({ message: "Voter epochs not refreshed", error })
    return null
  }
}

const storedRowSchema = z.object({
  epoch_start: z.number().int(),
  voter: voterKeySchema,
  total_usd: z.string().nullable(),
  weight: z.string().nullable(),
  voting_token_usd: z.string().nullable(),
  apr_percent: z.string().nullable(),
  funded_gauges: z.number().int(),
  unpriced_rewards: z.number().int(),
  open: z.union([z.literal(0), z.literal(1)]),
  updated_at: z.number().int(),
})

/** Stored rows from `from` on, oldest first; rows failing their schema are left out. */
export async function listVoterEpochs(
  db: MarketDatabase,
  network: NetworkSlug,
  from: number,
): Promise<z.output<typeof storedRowSchema>[]> {
  const result = await db
    .prepare(
      `SELECT epoch_start, voter, total_usd, weight, voting_token_usd,
         apr_percent, funded_gauges, unpriced_rewards, open, updated_at
       FROM market_voter_epochs
       WHERE network = ? AND epoch_start >= ?
       ORDER BY epoch_start, voter`,
    )
    .bind(network, from)
    .all()
  return result.results.flatMap((row) => {
    const parsed = storedRowSchema.safeParse(row)
    return parsed.success ? [parsed.data] : []
  })
}
