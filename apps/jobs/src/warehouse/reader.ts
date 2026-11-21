import { neon } from "@neondatabase/serverless"
import { z } from "zod"

// Reads from the Neon warehouse (`matchbox.*` projections, written by the
// indexer). Every query runs in a READ ONLY transaction, and production uses
// the read-only `matchbox_api_ro` role as well. Numeric columns are cast to
// text in SQL so no amount ever passes through a JS number.

const network = "mezo"

/** Wallet-facing action types the read models render. */
export const walletActionTypes = [
  "LOCK_CREATED",
  "LOCK_AMOUNT_INCREASED",
  "LOCK_EXTENDED",
  "LOCK_PERMANENT",
  "LOCK_PERMANENT_UNLOCKED",
  "LOCK_MERGED",
  "LOCK_WITHDRAWN",
  "BOOST_VOTE",
  "VOTE_BRIBE_CLAIMED",
  "VOTE_FEE_CLAIMED",
  "INCENTIVE_ADDED",
] as const

/**
 * Addresses that are never a person's wallet: the zero address (Mezo's
 * voters log some votes with a zero actor) and the common burn addresses.
 */
export const excludedWallets = [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0xdead000000000000000000000000000000000000",
] as const

export function isExcludedWallet(address: string): boolean {
  return excludedWallets.some((excluded) => excluded === address.toLowerCase())
}

/** The protocol feed adds keeper pokes. */
export const feedActionTypes = [...walletActionTypes, "BOOST_POKE"] as const

const text = z.string()
const nullableText = z.string().nullable()

export const activityEventRowSchema = z.object({
  tx_hash: text,
  log_index: text,
  block_number: text,
  timestamp: text,
  action_type: text,
  source: text,
  actor: nullableText,
  recipient: nullableText,
  token_id: nullableText,
  amount: nullableText,
  duration: nullableText,
  prev_duration: nullableText,
  post_duration: nullableText,
  prev_is_permanent: z.boolean().nullable(),
  post_is_permanent: z.boolean().nullable(),
  merge_source_token_id: nullableText,
  merge_dest_token_id: nullableText,
  token: nullableText,
  gauge: nullableText,
  weight: nullableText,
  boostable_token_id: nullableText,
  boost: nullableText,
  epoch_start: nullableText,
  contract_address: text,
})

export type ActivityEventRow = z.infer<typeof activityEventRowSchema>

export const lockRowSchema = z.object({
  contract_address: text,
  token_id: text,
  owner: text,
  amount: text,
  unlock_at: nullableText,
  is_permanent: z.boolean(),
  created_at: nullableText,
})

export type LockRow = z.infer<typeof lockRowSchema>

export const voteRowSchema = z.object({
  voter_contract: text,
  token_id: text,
  gauge: text,
  current_weight: text,
  last_updated_at: text,
})

export type VoteRow = z.infer<typeof voteRowSchema>

export const rewardSourceRowSchema = z.object({
  gauge: text,
  reward_contract: text,
  token: text,
})

export type RewardSourceRow = z.infer<typeof rewardSourceRowSchema>

export const depositRowSchema = z.object({
  epoch_start: text,
  voter_source: text,
  gauge: text,
  token: text,
  amount: text,
  deposits: z.number().int(),
})

export type DepositRow = z.infer<typeof depositRowSchema>

export const gaugeVoteRowSchema = z.object({
  gauge: text,
  source: text,
  epoch_start: text,
  /** The gauge's total weight at its last vote event in the epoch (raw). */
  weight: text,
})

export type GaugeVoteRow = z.infer<typeof gaugeVoteRowSchema>

export const lockStatsRowSchema = z.object({
  contract_address: text,
  lockers: z.number().int(),
  amount: text,
})

export type LockStatsRow = z.infer<typeof lockStatsRowSchema>

export type ProtocolRows = {
  lockStats: LockStatsRow[]
  vebtcVoteWeight: string
  vebtcVotes: number
  deposits: DepositRow[]
  feed: ActivityEventRow[]
  feedTotal: number
}

/** The warehouse queries the snapshot needs (Neon or a recorded fixture). */
export type WarehouseReader = {
  /** Highest projected block and its timestamp. */
  head(): Promise<{ block: number; timestamp: number } | null>
  /** Wallets touched after `afterBlock` (actors and current lock owners). */
  changedWallets(afterBlock: number, limit: number): Promise<string[]>
  /**
   * Every wallet with on-chain activity (anyone who ever owned a lock or
   * acted in Mezo Earn) after `afterAddress`, in address order.
   */
  sweepWallets(afterAddress: string, limit: number): Promise<string[]>
  locksOf(wallets: readonly string[]): Promise<LockRow[]>
  activeVotes(tokenIds: readonly string[]): Promise<VoteRow[]>
  /** Up to `perWallet` latest wallet-facing events per wallet. */
  activityOf(
    wallets: readonly string[],
    perWallet: number,
  ): Promise<ActivityEventRow[]>
  /**
   * Whole transactions of each wallet's wallet-facing events, one page per
   * request, all in one round trip: `older` reads back from `from`, newest
   * first; `newer` reads forward from it, oldest first, stopping before
   * `until`. Transactions are ordered by timestamp, then hash.
   */
  walletHistory(
    requests: readonly WalletHistoryRequest[],
  ): Promise<ActivityEventRow[][]>
  protocol(input: {
    epochStart: number
    sinceEpoch: number
    vebtcVoters: readonly string[]
    feedRows: number
  }): Promise<ProtocolRows>
  /**
   * Each gauge's total weight at its last vote or abstain event per epoch
   * since `sinceEpoch`. PoolsVoter events name the pool, mapped to its
   * gauge here.
   */
  gaugeVotes(sinceEpoch: number): Promise<GaugeVoteRow[]>
}

export type WalletHistoryRequest = {
  wallet: string
  direction: "older" | "newer"
  /** Excluded: the page starts past this transaction. */
  from: { ts: number; tx: string }
  /** `newer` only, excluded: the page stops before this transaction. */
  until?: { ts: number; tx: string }
  /** Transactions in the page, at most. */
  limit: number
}

const activityColumns = `
  tx_hash, log_index::text, block_number::text, timestamp::text, action_type,
  source, actor, recipient, token_id::text, amount::text, duration::text,
  prev_duration::text, post_duration::text, prev_is_permanent, post_is_permanent,
  merge_source_token_id::text, merge_dest_token_id::text, token, gauge,
  weight::text, boostable_token_id::text, boost::text, epoch_start::text,
  contract_address`

/** `activityColumns` read through the alias `e`, for a join. */
const eventColumns = `
  e.tx_hash, e.log_index::text, e.block_number::text, e.timestamp::text,
  e.action_type, e.source, e.actor, e.recipient, e.token_id::text,
  e.amount::text, e.duration::text, e.prev_duration::text,
  e.post_duration::text, e.prev_is_permanent, e.post_is_permanent,
  e.merge_source_token_id::text, e.merge_dest_token_id::text, e.token,
  e.gauge, e.weight::text, e.boostable_token_id::text, e.boost::text,
  e.epoch_start::text, e.contract_address`

type Query = { text: string; params: unknown[] }

/** Runs queries in one READ ONLY transaction (one HTTP round trip). */
export type QueryRunner = (queries: Query[]) => Promise<unknown[][]>

export function neonQueryRunner(url: string): QueryRunner {
  const sql = neon(url)
  return async function run(queries) {
    const results = await sql.transaction(
      (tx) => queries.map((query) => tx.query(query.text, query.params)),
      { readOnly: true, isolationLevel: "RepeatableRead" },
    )
    return results.map((rows) => z.array(z.unknown()).parse(rows))
  }
}

function rows<Schema extends z.ZodType>(
  schema: Schema,
  result: unknown[] | undefined,
): z.output<Schema>[] {
  return z.array(schema).parse(result ?? [])
}

export function createWarehouseReader(run: QueryRunner): WarehouseReader {
  async function one(query: Query): Promise<unknown[]> {
    const [result] = await run([query])
    return result ?? []
  }
  return {
    async head() {
      const [row] = rows(
        z.object({ block: nullableText, ts: nullableText }),
        await one({
          text: `SELECT max(block_number)::text AS block, max(timestamp)::text AS ts
                 FROM matchbox.activity_events WHERE network = $1`,
          params: [network],
        }),
      )
      if (row?.block == null || row.ts == null) return null
      return { block: Number(row.block), timestamp: Number(row.ts) }
    },

    async changedWallets(afterBlock, limit) {
      const result = rows(
        z.object({ wallet: text }),
        await one({
          text: `WITH touched AS (
                   SELECT actor, recipient, token_id, contract_address
                   FROM matchbox.activity_events
                   WHERE network = $1 AND block_number > $2
                     AND action_type = ANY($3::text[])
                 )
                 SELECT DISTINCT wallet FROM (
                   SELECT actor AS wallet FROM touched
                   UNION SELECT recipient FROM touched
                   UNION SELECT l.owner FROM touched t
                     JOIN matchbox.lock_positions l
                       ON l.network = $1 AND l.token_id = t.token_id
                      AND l.contract_address = t.contract_address
                 ) w
                 WHERE wallet IS NOT NULL AND wallet <> ALL($5::text[])
                 LIMIT $4`,
          params: [
            network,
            afterBlock,
            [...walletActionTypes],
            limit,
            [...excludedWallets],
          ],
        }),
      )
      return result.map((row) => row.wallet.toLowerCase())
    },

    async sweepWallets(afterAddress, limit) {
      const result = rows(
        z.object({ wallet: text }),
        await one({
          text: `SELECT wallet FROM (
                   SELECT owner AS wallet FROM matchbox.lock_positions
                   WHERE network = $1 AND owner > $2
                   UNION
                   SELECT actor FROM matchbox.activity_events
                   WHERE network = $1 AND actor > $2
                     AND action_type = ANY($4::text[])
                 ) w
                 WHERE wallet <> ALL($5::text[])
                 ORDER BY wallet LIMIT $3`,
          params: [
            network,
            afterAddress,
            limit,
            [...walletActionTypes],
            [...excludedWallets],
          ],
        }),
      )
      return result.map((row) => row.wallet.toLowerCase())
    },

    async locksOf(wallets) {
      return rows(
        lockRowSchema,
        await one({
          text: `SELECT contract_address, token_id::text, owner, amount::text,
                   unlock_at::text, is_permanent, created_at::text
                 FROM matchbox.lock_positions
                 WHERE network = $1 AND owner = ANY($2::text[])
                   AND NOT is_withdrawn AND NOT is_merged
                 ORDER BY owner, contract_address, token_id`,
          params: [network, [...wallets]],
        }),
      )
    },

    async activeVotes(tokenIds) {
      return rows(
        voteRowSchema,
        await one({
          text: `SELECT voter_contract, token_id::text, gauge,
                   current_weight::text, last_updated_at::text
                 FROM matchbox.votes
                 WHERE network = $1 AND is_active
                   AND token_id = ANY($2::numeric[])`,
          params: [network, [...tokenIds]],
        }),
      )
    },

    async activityOf(wallets, perWallet) {
      return rows(
        activityEventRowSchema,
        await one({
          text: `SELECT e.* FROM unnest($2::text[]) AS w(wallet)
                 CROSS JOIN LATERAL (
                   SELECT ${activityColumns}
                   FROM matchbox.activity_events
                   WHERE network = $1 AND actor = w.wallet
                     AND action_type = ANY($3::text[])
                   ORDER BY timestamp DESC, log_index DESC
                   LIMIT $4
                 ) e`,
          params: [network, [...wallets], [...walletActionTypes], perWallet],
        }),
      )
    },

    async walletHistory(requests) {
      if (requests.length === 0) return []
      const results = await run(
        requests.map((request) => {
          const params: unknown[] = [
            network,
            request.wallet,
            [...walletActionTypes],
            request.from.ts,
            request.from.tx,
          ]
          const older = request.direction === "older"
          let range = `(timestamp, tx_hash) ${older ? "<" : ">"} ($4::bigint, $5::text)`
          if (!older && request.until !== undefined) {
            params.push(request.until.ts, request.until.tx)
            range += " AND (timestamp, tx_hash) < ($6::bigint, $7::text)"
          }
          params.push(request.limit)
          const order = older ? "DESC" : "ASC"
          return {
            text: `WITH txs AS (
                     SELECT tx_hash, timestamp FROM matchbox.activity_events
                     WHERE network = $1 AND actor = $2
                       AND action_type = ANY($3::text[]) AND ${range}
                     GROUP BY timestamp, tx_hash
                     ORDER BY timestamp ${order}, tx_hash ${order}
                     LIMIT $${params.length}
                   )
                   SELECT ${eventColumns}
                   FROM matchbox.activity_events e
                   JOIN txs t ON t.tx_hash = e.tx_hash AND t.timestamp = e.timestamp
                   WHERE e.network = $1 AND e.actor = $2
                     AND e.action_type = ANY($3::text[])
                   ORDER BY e.timestamp DESC, e.log_index DESC`,
            params,
          }
        }),
      )
      return results.map((result) => rows(activityEventRowSchema, result))
    },

    async gaugeVotes(sinceEpoch) {
      return rows(
        gaugeVoteRowSchema,
        await one({
          text: `WITH pools AS (
                   SELECT DISTINCT pool, gauge FROM matchbox.contracts
                   WHERE network = $1 AND kind = 'gauge'
                     AND pool IS NOT NULL AND gauge IS NOT NULL
                 )
                 SELECT DISTINCT ON (g, epoch) g AS gauge, source,
                   epoch::text AS epoch_start, total_weight::text AS weight
                 FROM (
                   SELECT coalesce(p.gauge, e.gauge) AS g, e.source,
                     e.timestamp - (e.timestamp % 604800) AS epoch,
                     e.total_weight, e.timestamp, e.log_index
                   FROM matchbox.activity_events e
                   LEFT JOIN pools p ON p.pool = e.gauge
                   WHERE e.network = $1
                     AND e.action_type IN ('BOOST_VOTE', 'BOOST_ABSTAIN')
                     AND e.total_weight IS NOT NULL AND e.gauge IS NOT NULL
                     AND e.timestamp >= $2
                 ) x
                 ORDER BY g, epoch, timestamp DESC, log_index DESC`,
          params: [network, sinceEpoch],
        }),
      )
    },

    async protocol(input) {
      const [lockStats, weight, votes, deposits, feed, total] = await run([
        {
          text: `SELECT contract_address, count(DISTINCT owner)::int AS lockers,
                   sum(amount)::text AS amount
                 FROM matchbox.lock_positions
                 WHERE network = $1 AND NOT is_withdrawn AND NOT is_merged
                 GROUP BY contract_address`,
          params: [network],
        },
        {
          text: `SELECT coalesce(sum(current_weight), 0)::text AS weight
                 FROM matchbox.votes
                 WHERE network = $1 AND is_active
                   AND voter_contract = ANY($2::text[])`,
          params: [network, [...input.vebtcVoters]],
        },
        {
          text: `SELECT count(DISTINCT tx_hash)::int AS votes
                 FROM matchbox.activity_events
                 WHERE network = $1 AND action_type = 'BOOST_VOTE'
                   AND source IN ('POOLS_VOTER', 'VALIDATORS_VOTER')
                   AND timestamp >= $2`,
          params: [network, input.epochStart],
        },
        {
          text: `SELECT epoch_start::text, voter_source, gauge, token,
                   sum(amount)::text AS amount, count(*)::int AS deposits
                 FROM matchbox.reward_deposits
                 WHERE network = $1 AND epoch_start >= $2
                 GROUP BY epoch_start, voter_source, gauge, token`,
          params: [network, input.sinceEpoch],
        },
        {
          text: `SELECT ${activityColumns}
                 FROM matchbox.activity_events
                 WHERE network = $1 AND action_type = ANY($2::text[])
                 ORDER BY timestamp DESC, log_index DESC
                 LIMIT $3`,
          params: [network, [...feedActionTypes], input.feedRows],
        },
        {
          text: `SELECT count(DISTINCT tx_hash)::int AS total
                 FROM matchbox.activity_events
                 WHERE network = $1 AND action_type = ANY($2::text[])
                   AND timestamp >= $3`,
          params: [network, [...feedActionTypes], input.epochStart],
        },
      ])
      const [weightRow] = rows(z.object({ weight: text }), weight)
      const [votesRow] = rows(z.object({ votes: z.number().int() }), votes)
      const [totalRow] = rows(z.object({ total: z.number().int() }), total)
      return {
        lockStats: rows(lockStatsRowSchema, lockStats),
        vebtcVoteWeight: weightRow?.weight ?? "0",
        vebtcVotes: votesRow?.votes ?? 0,
        deposits: rows(depositRowSchema, deposits),
        feed: rows(activityEventRowSchema, feed),
        feedTotal: totalRow?.total ?? 0,
      }
    },
  }
}
