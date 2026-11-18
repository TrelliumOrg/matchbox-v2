import { CONTRACTS } from "@matchbox/chain"
import {
  demoGaugeDirectory,
  demoGaugeProfile,
} from "@matchbox/contracts/read-models/fixtures"
import { EPOCH_SECONDS, epochStartOf } from "@matchbox/domain"
import { currentKey, writeReadModels } from "../read-models/store"

// Fixture rows for the /internal/scan tests, in both databases, with the
// shapes the jobs Worker writes (apps/jobs/scan-migrations,
// apps/jobs/migrations). Test-only; never imported by the Worker.

/** "Now" for every scan test: two days into an epoch. */
export const scanNow = epochStartOf(1_794_000_000) + 2 * 86_400
export const currentEpoch = epochStartOf(scanNow)
export const lastEpoch = currentEpoch - EPOCH_SECONDS

export const vebtc = CONTRACTS.mainnet.veBTC.toLowerCase()
export const vemezo = CONTRACTS.mainnet.veMEZO.toLowerCase()

function address(tail: string): string {
  return `0x${tail.padStart(40, "0")}`
}

function hash(tail: string): string {
  return `0x${tail.padStart(64, "0")}`
}

export const people = {
  alice: address("a11ce"),
  bob: address("b0b"),
  carol: address("ca401"),
  nobody: address("dead"),
}

export const gauge = address("9a09e")
export const otherGauge = address("9a09f")
export const pool = address("900l")
export const musd = CONTRACTS.mainnet.mezoToken.toLowerCase()
export const market = hash("aa")
export const positionId = "1"

/** Activity: 30 rows over 15 blocks; two rows share each (block, log). */
export const activityCount = 30
export const txHash = hash("7c")

export const gaugeVoterCount = 30
export const troveBorrower = people.carol

function sortKey(value: bigint): string {
  return value.toString().padStart(40, "0")
}

type Statement = D1PreparedStatement

function insert(
  db: D1Database,
  table: string,
  row: Record<string, unknown>,
): Statement {
  const columns = Object.keys(row)
  return db
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
        .map((_, index) => `?${index + 1}`)
        .join(", ")})`,
    )
    .bind(...Object.values(row))
}

export async function clearScan(db: D1Database): Promise<void> {
  await db.batch(
    [
      "activity",
      "locks",
      "lock_votes",
      "incentive_deposits",
      "trove_events",
      "morpho_events",
      "enclave_events",
      "labels",
      "epoch_totals",
      "gauge_epoch",
      "daily",
      "price_daily",
      "scan_cursors",
      "scan_dirty",
      "scan_runs",
      "scan_status",
      "scan_quarantine",
      "pools",
    ].map((table) => db.prepare(`DELETE FROM ${table}`)),
  )
}

export async function seedScan(db: D1Database): Promise<void> {
  await clearScan(db)
  const statements: Statement[] = []
  for (let index = 0; index < activityCount; index += 1) {
    const block = 13_000_000 + Math.floor(index / 2)
    const action = index % 2 === 0 ? "BOOST_VOTE" : "LOCK_DEPOSIT"
    statements.push(
      insert(db, "activity", {
        id: `${index === 0 ? txHash : hash(`7d${index}`)}-0-${action}`,
        tx_hash: index < 2 ? txHash : hash(`7d${Math.floor(index / 2)}`),
        log_index: 0,
        block_number: block,
        timestamp: lastEpoch + 3_600 + Math.floor(index / 2) * 4,
        epoch_start: index < 20 ? lastEpoch : currentEpoch,
        action_type: action,
        source: "BOOST_VOTER",
        contract_address: CONTRACTS.mainnet.boostVoter.toLowerCase(),
        tx_from: people.alice,
        actor: people.alice,
        // Alice is also the recipient of a third, so merging must dedupe.
        recipient: index % 3 === 0 ? people.alice : people.bob,
        lock_escrow: vemezo,
        token_id: index % 2 === 0 ? "7" : "8",
        amount: "1000000000000000000",
        token: musd,
        gauge: index % 2 === 0 ? gauge : otherGauge,
        pool: null,
        reward_contract: null,
        weight: index % 2 === 0 ? "500000000000000000" : null,
        extra: JSON.stringify({ note: `row ${index}`, flag: index % 2 === 0 }),
      }),
    )
  }
  const locks: [string, bigint, number, number][] = [
    ["1", 5n * 10n ** 18n, scanNow + 86_400 * 300, scanNow - 86_400 * 50],
    ["2", 2n * 10n ** 18n, scanNow + 86_400 * 30, scanNow - 86_400 * 40],
    ["3", 9n * 10n ** 18n, 0, scanNow - 86_400 * 30],
    ["4", 2n * 10n ** 18n, scanNow + 86_400 * 60, scanNow - 86_400 * 20],
  ]
  for (const [tokenId, amount, unlock, created] of locks) {
    statements.push(
      insert(db, "locks", {
        escrow: vebtc,
        token_id: tokenId,
        owner: tokenId === "4" ? people.bob : people.alice,
        amount: amount.toString(),
        amount_key: sortKey(amount),
        unlock_at: unlock,
        created_at: created,
        last_extended_at: null,
        withdrawn_at: null,
        is_permanent: unlock === 0 ? 1 : 0,
        is_withdrawn: 0,
        is_merged: 0,
        merged_into_token_id: null,
        merged_at: null,
        boost: null,
        activity_count: 3,
        updated_at: scanNow,
      }),
    )
  }
  // A withdrawn lock: never in the live lists.
  statements.push(
    insert(db, "locks", {
      escrow: vebtc,
      token_id: "5",
      owner: people.alice,
      amount: "0",
      amount_key: sortKey(0n),
      unlock_at: scanNow - 10,
      created_at: scanNow - 86_400 * 90,
      last_extended_at: null,
      withdrawn_at: scanNow - 5,
      is_permanent: 0,
      is_withdrawn: 1,
      is_merged: 0,
      merged_into_token_id: null,
      merged_at: null,
      boost: null,
      activity_count: 2,
      updated_at: scanNow,
    }),
  )
  for (let index = 0; index < gaugeVoterCount; index += 1) {
    // Two voters per weight, so paging must break ties by token id.
    const weight = BigInt(1_000 - Math.floor(index / 2) * 10) * 10n ** 15n
    statements.push(
      insert(db, "lock_votes", {
        epoch_start: currentEpoch,
        gauge,
        escrow: vemezo,
        token_id: String(100 + index),
        source: "BOOST_VOTER",
        pool: null,
        weight: weight.toString(),
        weight_key: sortKey(weight),
        voted_at: currentEpoch + 3_700,
        carried: index % 5 === 0 ? 1 : 0,
      }),
    )
  }
  for (const epoch of [lastEpoch, currentEpoch]) {
    for (const [index, target] of [gauge, otherGauge].entries()) {
      statements.push(
        insert(db, "lock_votes", {
          epoch_start: epoch,
          gauge: target,
          escrow: vemezo,
          token_id: "7",
          source: "BOOST_VOTER",
          pool: null,
          weight: "1",
          weight_key: sortKey(1n),
          voted_at: epoch + 3_600 + index,
          carried: 0,
        }),
      )
    }
  }
  for (let index = 0; index < 6; index += 1) {
    statements.push(
      insert(db, "incentive_deposits", {
        tx_hash: hash(`1c${index}`),
        log_index: index,
        block_number: 13_000_100 + index,
        timestamp: lastEpoch + 10_000 + index,
        epoch_start: index < 3 ? lastEpoch : currentEpoch,
        tx_from: people.bob,
        reward_contract: address("bbbe"),
        reward_type: index === 5 ? "Fee" : "Bribe",
        voter_source: "BOOST_VOTER",
        gauge,
        pool: null,
        token: musd,
        amount: `${index + 1}000000000000000000`,
        depositor: people.bob,
      }),
    )
  }
  for (const [epoch, rank, target, weight] of [
    [lastEpoch, 1, gauge, 30n],
    [lastEpoch, 2, otherGauge, 20n],
    [currentEpoch, 1, otherGauge, 50n],
    [currentEpoch, 2, gauge, 40n],
    [currentEpoch - 2 * EPOCH_SECONDS, 1, gauge, 10n],
  ] as const) {
    statements.push(
      insert(db, "gauge_epoch", {
        epoch_start: epoch,
        gauge: target,
        source: "BOOST_VOTER",
        pool: null,
        vote_weight: (weight * 10n ** 18n).toString(),
        weight_key: sortKey(weight * 10n ** 18n),
        voters: 3,
        incentives: JSON.stringify({ [musd]: "1000" }),
        fees: "{}",
        rank,
        updated_at: scanNow,
      }),
    )
  }
  for (const epoch of [lastEpoch, currentEpoch]) {
    statements.push(
      insert(db, "epoch_totals", {
        epoch_start: epoch,
        emission: epoch === lastEpoch ? "1000000" : null,
        rebase: null,
        gauge_rewards: null,
        total_supply: null,
        vote_transactions: 4,
        voters: 3,
        vote_weight: JSON.stringify({ BOOST_VOTER: "70000000000000000000" }),
        gauges: 2,
        incentives: JSON.stringify({ [musd]: "6000000000000000000" }),
        fees: "{}",
        top_gauge: JSON.stringify({ BOOST_VOTER: gauge }),
        updated_at: scanNow,
      }),
    )
  }
  const troveActions = [
    "LOAN_OPENED",
    "LOAN_BORROWED",
    "LOAN_LIQUIDATED",
    "LOAN_REDEEMED",
  ]
  for (const [index, action] of troveActions.entries()) {
    statements.push(
      insert(db, "trove_events", {
        tx_hash: hash(`70${index}`),
        log_index: index,
        block_number: 12_900_000 + index,
        timestamp: lastEpoch + index,
        tx_from: troveBorrower,
        contract_address: address("70e"),
        emitter:
          action === "LOAN_LIQUIDATED" || action === "LOAN_REDEEMED"
            ? "TROVE_MANAGER"
            : "BORROWER_OPERATIONS",
        borrower: troveBorrower,
        operation: index,
        action,
        principal: "1000000000000000000000",
        interest: "0",
        coll: "20000000000000000",
        stake: "20000000000000000",
        interest_rate: 100,
        prev_principal: null,
        prev_interest: null,
        prev_coll: null,
        accrued_interest: null,
        debt_change: index === 2 ? "-1000000000000000000000" : null,
        coll_change: null,
      }),
    )
  }
  for (let index = 0; index < 3; index += 1) {
    statements.push(
      insert(db, "morpho_events", {
        tx_hash: hash(`3f${index}`),
        log_index: index,
        block_number: 12_950_000 + index,
        timestamp: lastEpoch + index,
        tx_from: people.alice,
        market_id: market,
        action: ["SUPPLIED", "COLLATERAL_SUPPLIED", "BORROWED"][index] ?? "",
        caller: people.alice,
        on_behalf: people.alice,
        receiver: people.alice,
        assets: "1000000",
        shares: "1000000000000",
        seized_assets: null,
        bad_debt_assets: null,
        bad_debt_shares: null,
        prev_borrow_rate: null,
        fee_shares: null,
        fee: null,
      }),
    )
  }
  for (const [index, token] of ["11", "12"].entries()) {
    statements.push(
      insert(db, "enclave_events", {
        tx_hash: hash("e9"),
        log_index: 4,
        ve_btc_token_id: token,
        block_number: 12_960_000 + index,
        timestamp: lastEpoch + index,
        tx_from: people.alice,
        contract_address: address("e9c"),
        enclave: address("e9c"),
        position_id: positionId,
        borrower: people.alice,
        action: index === 0 ? "POSITION_OPENED" : "COLLATERAL_PLEDGED",
        amount: "5000000000000000000000",
        principal: "5000000000000000000000",
        interest_rate: 100,
        originator_fee_rate: null,
        warning_cr: null,
        minimum_cr: null,
        lock_duration: null,
        other_ve_btc_token_id: null,
        pledged_ve_btc: JSON.stringify(["11", "12"]),
      }),
    )
  }
  for (const [target, name, kind] of [
    [people.alice, "Alice Treasury", "eoa"],
    [gauge, "Gauge MUSD Boost", "gauge"],
    [musd, "MEZO", "token"],
    [address("70e"), "Trove Manager", "contract"],
  ] as const) {
    statements.push(
      insert(db, "labels", {
        address: target,
        name,
        name_lower: name.toLowerCase(),
        kind,
        tags: JSON.stringify([kind]),
        source: "curated",
        pool: null,
        gauge: null,
        updated_at: scanNow,
      }),
    )
  }
  for (let day = 0; day < 10; day += 1) {
    const date = new Date((scanNow - (10 - day) * 86_400) * 1000)
      .toISOString()
      .slice(0, 10)
    statements.push(
      insert(db, "daily", {
        metric: "chain.transactions",
        dimension: "",
        day: date,
        value: String(800 + day),
        source: "blockscout",
        updated_at: scanNow,
      }),
      insert(db, "price_daily", {
        token: "btc",
        day: date,
        price: `${74_000 + day}.25`,
        source: "mezo-oracle",
        updated_at: scanNow,
      }),
    )
  }
  statements.push(
    insert(db, "scan_runs", {
      job: "scan-copy",
      trigger: "chained",
      started_at: scanNow - 120,
      finished_at: scanNow - 100,
      status: "ok",
      rows_read: 10,
      rows_written: 10,
      detail: null,
    }),
    insert(db, "scan_cursors", {
      name: "copy:activity",
      value: String(scanNow - 100),
      updated_at: scanNow,
    }),
  )
  await db.batch(statements)
}

/** Records another successful copy run (a new `run` cache version). */
export async function recordRun(db: D1Database, finishedAt: number) {
  await insert(db, "scan_runs", {
    job: "scan-copy",
    trigger: "chained",
    started_at: finishedAt - 10,
    finished_at: finishedAt,
    status: "ok",
    rows_read: 1,
    rows_written: 1,
    detail: null,
  }).run()
}

/** Writes the jobs Worker's status row (id 1), as its copy step does. */
export async function writeStatus(
  db: D1Database,
  row: Partial<{
    last_run_status: "ok" | "skipped" | "failed"
    last_run_at: number
    last_ok_at: number | null
    consecutive_failures: number
    last_error: string | null
    copied_through: number | null
    aggregates_complete: 0 | 1
    history_filled: 0 | 1
    refill_required: 0 | 1
    refill_reason: string | null
    updated_at: number
  }> = {},
): Promise<void> {
  const full = {
    id: 1,
    last_run_status: "ok",
    last_run_at: scanNow - 100,
    last_ok_at: scanNow - 100,
    consecutive_failures: 0,
    last_error: null,
    copied_through: scanNow - 200,
    dirty_epochs: 0,
    dirty_days: 0,
    aggregates_complete: 1,
    history_filled: 1,
    refill_required: 0,
    refill_reason: null,
    quarantined_rows: 0,
    updated_at: scanNow - 100,
    ...row,
  }
  const columns = Object.keys(full)
  await db
    .prepare(
      `INSERT OR REPLACE INTO scan_status (${columns.join(", ")}) VALUES (${columns
        .map((_, index) => `?${index + 1}`)
        .join(", ")})`,
    )
    .bind(...Object.values(full))
    .run()
}

/** Morpho: 86% LLTV, oracle price 74,000 mUSDC per BTC (6 vs 18 dp). */
export const lltv = 860_000_000_000_000_000n
/** MUSD's PriceFeed BTC price in the fixtures: 80,000 USD (1e18). */
export const musdFeedPrice = 80_000n * 10n ** 18n
export const oraclePrice = (74_000n * 10n ** 6n * 10n ** 36n) / 10n ** 18n

export async function seedRead(db: D1Database): Promise<void> {
  await db.batch(
    [
      "read_models",
      "morpho_markets",
      "morpho_positions",
      "troves",
      "stability_pool",
    ].map((table) => db.prepare(`DELETE FROM ${table}`)),
  )
  await db.batch([
    insert(db, "morpho_markets", {
      network: "mezo",
      market_id: market,
      loan_token: CONTRACTS.mainnet.mezoToken,
      collateral_token: address("b7c"),
      oracle: address("0e"),
      irm: address("1e"),
      lltv_raw: lltv.toString(),
      total_supply_assets_raw: "1000000000000",
      total_supply_shares_raw: "1000000000000000000",
      total_borrow_assets_raw: "500000000000",
      total_borrow_shares_raw: "500000000000000000",
      fee_raw: "0",
      last_update: scanNow - 60,
      borrow_rate_raw: "1000000000",
      oracle_price_raw: oraclePrice.toString(),
      block: 13_000_000,
      updated_at: scanNow - 60,
    }),
    insert(db, "morpho_positions", {
      network: "mezo",
      market_id: market,
      account: people.alice,
      supply_shares_raw: "0",
      // 30,000 mUSDC borrowed against 1 BTC.
      borrow_shares_raw: "30000000000000000",
      collateral_raw: "1000000000000000000",
      block: 13_000_000,
      updated_at: scanNow - 60,
    }),
    insert(db, "morpho_positions", {
      network: "mezo",
      market_id: market,
      account: people.bob,
      supply_shares_raw: "100000000000000000",
      borrow_shares_raw: "0",
      collateral_raw: "0",
      block: 13_000_000,
      updated_at: scanNow - 60,
    }),
    insert(db, "troves", {
      network: "mezo",
      owner: troveBorrower,
      status: "active",
      // 1 BTC against 50,000 MUSD.
      coll_raw: "1000000000000000000",
      principal_raw: "49000000000000000000000",
      interest_raw: "1000000000000000000000",
      interest_rate: 100,
      block: 13_000_000,
      updated_at: scanNow - 60,
    }),
    insert(db, "troves", {
      network: "mezo",
      owner: people.bob,
      status: "closedByOwner",
      coll_raw: "0",
      principal_raw: "0",
      interest_raw: "0",
      interest_rate: 100,
      block: 12_000_000,
      updated_at: scanNow - 600,
    }),
    insert(db, "stability_pool", {
      network: "mezo",
      total_musd_deposits_raw: "12000000000000000000000000",
      total_collateral_raw: "3000000000000000000",
      // MUSD's PriceFeed price (apps/jobs/migrations/0005), apart from the
      // market price the harness serves, so tests see which one is used.
      musd_btc_price_raw: musdFeedPrice.toString(),
      musd_btc_price_scale: 18,
      // Written by every live run, after the pool: at or after its block.
      musd_btc_price_block: 13_000_000,
      block: 13_000_000,
      updated_at: scanNow - 60,
    }),
  ])
  const base = {
    network: "mezo" as const,
    block: 13_000_000,
    source: "warehouse" as const,
    updatedAt: scanNow - 300,
  }
  await writeReadModels(db, [
    { ...base, kind: "gauges", key: currentKey, data: demoGaugeDirectory },
    {
      ...base,
      kind: "gauge-profile",
      key: demoGaugeProfile.card.gauge.address,
      data: demoGaugeProfile,
    },
  ])
}
