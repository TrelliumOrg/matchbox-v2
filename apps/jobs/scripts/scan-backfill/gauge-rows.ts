import type { EpochSnapshot } from "@matchbox/api/market/snapshot"
import { storedGaugeHash } from "@matchbox/api/market/store"
import type { Gauge } from "@matchbox/contracts/market"
import { EPOCH_SECONDS } from "@matchbox/domain"
import type { SqlStatement } from "../../src/scan/statements"
import { dayOf } from "../../src/scan/transform"
import { closeBound } from "./closes"

// The gauge-epoch backfill's pure parts (gauge-epochs.ts): the block that
// closes an epoch and the MARKET_DB rows the market cron would have
// written for it (apps/api/src/market/store.ts, saveSnapshot).

/**
 * A finished epoch's rows in MARKET_DB are the ones its last market run as
 * the current epoch wrote: the 23:55 UTC run of the epoch's last day (the
 * stored finished epochs say as_of 23:55:17 to 23:55:20). Its block is the
 * last one at or before 23:55:00 of that day: the last one below this.
 */
export function epochCloseBound(epochStart: number): number {
  return closeBound(dayOf(epochStart + EPOCH_SECONDS - 86_400))
}

/** Epoch starts from `first` to `last`, inclusive, a week apart. */
export function epochStarts(first: number, last: number): number[] {
  const starts: number[] = []
  for (let start = first; start <= last; start += EPOCH_SECONDS) {
    starts.push(start)
  }
  return starts
}

function vebtcTokenOf(gauge: Gauge): string | null {
  return gauge.voter === "boost" ? gauge.vebtcTokenId : null
}

/**
 * Statements for one epoch, inserting only into an epoch MARKET_DB does
 * not hold yet: every gauge row is inserted only while the epoch has no
 * header row, and only if absent; the header goes last. An epoch the live
 * cron wrote (it has a header) is never touched, a file cut short is
 * finished by applying it again, and applying it twice changes nothing.
 * Rows are as saveSnapshot writes them (same columns, JSON and hash).
 */
export async function epochStatements(
  snapshot: EpochSnapshot,
): Promise<SqlStatement[]> {
  const { epoch } = snapshot
  const statements: SqlStatement[] = []
  for (const row of snapshot.gauges) {
    statements.push({
      sql: `INSERT INTO market_gauges (network, epoch_start, gauge_address, voter, vebtc_token_id, has_rewards, gauge, incentives, hash)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
WHERE NOT EXISTS (SELECT 1 FROM market_epochs WHERE network = ?1 AND epoch_start = ?2)
ON CONFLICT (network, epoch_start, gauge_address) DO NOTHING`,
      params: [
        epoch.network,
        epoch.epochStart,
        row.gauge.gaugeAddress,
        row.gauge.voter,
        vebtcTokenOf(row.gauge),
        row.incentives.rewards.length > 0 ? 1 : 0,
        JSON.stringify(row.gauge),
        JSON.stringify(row.incentives),
        await storedGaugeHash(row),
      ],
    })
  }
  statements.push({
    sql: `INSERT INTO market_epochs (network, epoch_start, block_number, as_of, total_weights, prices)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)
ON CONFLICT (network, epoch_start) DO NOTHING`,
    params: [
      epoch.network,
      epoch.epochStart,
      epoch.blockNumber,
      epoch.asOf,
      JSON.stringify(epoch.totalWeights),
      JSON.stringify(epoch.prices),
    ],
  })
  return statements
}

/**
 * The values compared with a stored epoch, per gauge: its weight and its
 * rewards (token and amount), which come from the chain alone. USD values
 * and APR also depend on the prices of the moment, so they are not.
 */
export function gaugeFingerprint(incentives: {
  weight: string | null
  rewards: readonly { token: string; amount: string }[]
}): string {
  const rewards = incentives.rewards
    .map((reward) => `${reward.token}:${reward.amount}`)
    .sort()
    .join(",")
  return `weight=${incentives.weight ?? "null"} rewards=[${rewards}]`
}
