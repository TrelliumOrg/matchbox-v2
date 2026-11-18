import { EPOCH_SECONDS } from "@matchbox/domain"
import {
  activityOverlapSeconds,
  blockOverlap,
  contractsLookback,
  contractsRecheckRows,
  type DayCount,
  enclaveSweepKey,
  type NeonActivityRow,
  type NeonContractRow,
  type NeonDepositRow,
  type NeonEnclaveRow,
  type NeonLockRow,
  type NeonMorphoRow,
  type NeonTroveRow,
  neonActivityRowSchema,
  overlapRows,
  type ScanReadPlan,
  type ScanRows,
  type ScanTable,
  type ScanWarehouseReader,
} from "../neon"

// Neon rows (as the scan reader returns them) for the copy tests: two
// epochs on one pool and two gauges. Epoch E: locks 100 and 101 are created
// and vote for gauge G (pool P), two swaps, a savings deposit, an incentive
// and a fee deposit, a trove opened, Morpho supply and borrow, an Enclave
// position. Epoch E+1: the minter's EpochProcessed for E+1, lock 101 resets
// and votes for G2, lock 100 adds to its lock and keeps its carried vote, an
// incentive on G2, a trove repayment.

export const epochE = 1_765_411_200 + 47 * EPOCH_SECONDS // Thu 5 Nov 2026
export const epochE1 = epochE + EPOCH_SECONDS
export const dayE = "2026-11-05"
export const dayE1 = "2026-11-12"

export const veBTC = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"
export const poolsVoter = "0x48233ccc97b87ba93bca212cbee48e3210211f03"
export const btc = "0x7b7c000000000000000000000000000000000000"
export const mezo = "0x7b7c000000000000000000000000000000000001"
export const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
export const poolP = `0x${"1".repeat(40)}`
export const gaugeG = `0x${"2".repeat(40)}`
export const gaugeG2 = `0x${"3".repeat(40)}`
export const factory = `0x${"4".repeat(40)}`
export const bribeG = `0x${"5".repeat(40)}`
export const ownerA = `0x${"a".repeat(40)}`
export const ownerB = `0x${"b".repeat(40)}`
export const marketM = `0x${"6".repeat(64)}`
export const enclaveA = "0x4da9e77114ee66d64ca9457da1fca94d4b06fb99"

function tx(n: number): string {
  return `0x${n.toString(16).padStart(64, "0")}`
}

type ActivityInput = Partial<NeonActivityRow> & {
  n: number
  block: number
  log: number
  ts: number
  action: string
  source: string
  contract: string
}

export function activity(input: ActivityInput): NeonActivityRow {
  return neonActivityRowSchema.parse({
    id: `${tx(input.n)}-${input.log}-${input.action}`,
    tx_hash: tx(input.n),
    tx_from: input.actor ?? ownerA,
    log_index: String(input.log),
    block_number: String(input.block),
    timestamp: String(input.ts),
    action_type: input.action,
    source: input.source,
    contract_address: input.contract,
    actor: input.actor ?? null,
    recipient: input.recipient ?? null,
    token_id: input.token_id ?? null,
    amount: input.amount ?? null,
    token: input.token ?? null,
    raw_gauge: input.raw_gauge ?? input.gauge ?? null,
    gauge: input.gauge ?? null,
    pool: input.pool ?? null,
    reward_contract: input.reward_contract ?? null,
    weight: input.weight ?? null,
    extra: input.extra ?? "{}",
  })
}

export const activityFixture: NeonActivityRow[] = [
  activity({
    n: 1,
    block: 100,
    log: 0,
    ts: epochE + 100,
    action: "POOL_CREATED",
    source: "POOL_FACTORY",
    contract: factory,
    actor: ownerA,
    token: btc,
    recipient: musd,
    pool: poolP,
    extra: '{"boost_context":"UNKNOWN","metadata":"volatile"}',
  }),
  activity({
    n: 2,
    block: 101,
    log: 0,
    ts: epochE + 200,
    action: "LOCK_CREATED",
    source: "VOTING_ESCROW",
    contract: veBTC,
    actor: ownerA,
    token_id: "100",
    amount: "5000000000000000000",
  }),
  activity({
    n: 3,
    block: 101,
    log: 3,
    ts: epochE + 200,
    action: "LOCK_CREATED",
    source: "VOTING_ESCROW",
    contract: veBTC,
    actor: ownerB,
    token_id: "101",
    amount: "2000000000000000000",
  }),
  activity({
    n: 4,
    block: 102,
    log: 0,
    ts: epochE + 300,
    action: "BOOST_VOTE",
    source: "POOLS_VOTER",
    contract: poolsVoter,
    actor: ownerA,
    token_id: "100",
    raw_gauge: poolP,
    gauge: gaugeG,
    pool: poolP,
    weight: "4000000000000000000000",
  }),
  activity({
    n: 4,
    block: 102,
    log: 1,
    ts: epochE + 300,
    action: "BOOST_VOTE",
    source: "POOLS_VOTER",
    contract: poolsVoter,
    actor: ownerB,
    token_id: "101",
    raw_gauge: poolP,
    gauge: gaugeG,
    pool: poolP,
    weight: "1000000000000000000000",
  }),
  activity({
    n: 5,
    block: 103,
    log: 0,
    ts: epochE + 400,
    action: "SWAP",
    source: "POOL",
    contract: poolP,
    actor: ownerA,
    pool: poolP,
    amount: "1000000",
    extra:
      '{"first_recipient_amount":"1000","second_recipient_amount":"2000000","metadata":"in0=1000,in1=0,out0=0,out1=2000000"}',
  }),
  activity({
    n: 6,
    block: 104,
    log: 0,
    ts: epochE + 500,
    action: "SWAP",
    source: "POOL",
    contract: poolP,
    actor: ownerB,
    pool: poolP,
    amount: "3000",
    extra:
      '{"first_recipient_amount":"3000","second_recipient_amount":"6000000","metadata":"in0=0,in1=6000000,out0=3000,out1=0"}',
  }),
  activity({
    n: 7,
    block: 105,
    log: 0,
    ts: epochE + 600,
    action: "SAVINGS_DEPOSIT",
    source: "MUSD_SAVINGS_RATE",
    contract: "0xb4d498029af77680cd1ef828b967f010d06c51cc",
    actor: ownerA,
    amount: "700",
  }),
  activity({
    n: 8,
    block: 200,
    log: 0,
    ts: epochE1 + 10,
    action: "EPOCH_PROCESSED",
    source: "MEZO_MINTER",
    contract: `0x${"7".repeat(40)}`,
    actor: ownerA,
    extra: `{"period":"${epochE1}","emission":"1000000","rebase":"100","rewards":"900000","total_supply":"5000000000"}`,
  }),
  activity({
    n: 9,
    block: 201,
    log: 0,
    ts: epochE1 + 100,
    action: "BOOST_ABSTAIN",
    source: "POOLS_VOTER",
    contract: poolsVoter,
    actor: ownerB,
    token_id: "101",
    raw_gauge: poolP,
    gauge: gaugeG,
    pool: poolP,
    weight: "1000000000000000000000",
  }),
  activity({
    n: 9,
    block: 201,
    log: 1,
    ts: epochE1 + 100,
    action: "BOOST_VOTE",
    source: "POOLS_VOTER",
    contract: poolsVoter,
    actor: ownerB,
    token_id: "101",
    gauge: gaugeG2,
    weight: "1500000000000000000000",
  }),
  activity({
    n: 10,
    block: 202,
    log: 0,
    ts: epochE1 + 200,
    action: "LOCK_AMOUNT_INCREASED",
    source: "VOTING_ESCROW",
    contract: veBTC,
    actor: ownerA,
    token_id: "100",
    amount: "1000000000000000000",
  }),
]

function lock(tokenId: string, owner: string, amount: string): NeonLockRow {
  return {
    contract_address: veBTC,
    token_id: tokenId,
    owner,
    amount,
    unlock_at: "1919980800",
    created_at: String(epochE + 200),
    last_extended_at: null,
    withdrawn_at: null,
    is_permanent: false,
    is_withdrawn: false,
    is_merged: false,
    merged_into_token_id: null,
    merged_at: null,
    boost: null,
    activity_count: "2",
  }
}

/** lock_positions after the whole fixture. */
export const lockFixture: NeonLockRow[] = [
  lock("100", ownerA, "6000000000000000000"),
  lock("101", ownerB, "2000000000000000000"),
]

function deposit(
  n: number,
  block: number,
  ts: number,
  epoch: number,
  type: "Bribe" | "Fee",
  gauge: string,
  token: string,
  amount: string,
): NeonDepositRow {
  return {
    tx_hash: tx(n),
    log_index: "5",
    block_number: String(block),
    timestamp: String(ts),
    tx_from: ownerA,
    reward_contract: bribeG,
    reward_type: type,
    voter_source: "POOLS_VOTER",
    gauge,
    pool: gauge === gaugeG ? poolP : null,
    token,
    epoch_start: String(epoch),
    amount,
    depositor: ownerA,
  }
}

export const depositFixture: NeonDepositRow[] = [
  deposit(20, 102, epochE + 310, epochE, "Bribe", gaugeG, mezo, "500"),
  deposit(21, 150, epochE + 1_000, epochE, "Fee", gaugeG, btc, "40"),
  deposit(22, 202, epochE1 + 210, epochE1, "Bribe", gaugeG2, musd, "800"),
]

function trove(
  n: number,
  block: number,
  ts: number,
  action: string,
  debtChange: string,
  collChange: string,
): NeonTroveRow {
  return {
    tx_hash: tx(n),
    log_index: "2",
    block_number: String(block),
    timestamp: String(ts),
    tx_from: ownerA,
    contract_address: "0x44b1bac67dda612a41a58aaf779143b181dee031",
    emitter: "BORROWER_OPERATIONS",
    borrower: ownerA,
    operation: action === "LOAN_OPENED" ? 0 : 2,
    action,
    principal: "1000",
    interest: "0",
    coll: "5",
    stake: "5",
    interest_rate: 100,
    prev_principal: null,
    prev_interest: null,
    prev_coll: null,
    accrued_interest: null,
    debt_change: debtChange,
    coll_change: collChange,
  }
}

export const troveFixture: NeonTroveRow[] = [
  trove(30, 103, epochE + 410, "LOAN_OPENED", "1000", "5"),
  trove(31, 210, epochE1 + 500, "LOAN_REPAID", "-400", "0"),
]

function morphoEvent(
  log: number,
  action: string,
  assets: string,
): NeonMorphoRow {
  return {
    tx_hash: tx(40),
    log_index: String(log),
    block_number: "104",
    timestamp: String(epochE + 500),
    tx_from: ownerB,
    market_id: marketM,
    action,
    caller: ownerB,
    on_behalf: ownerB,
    receiver: ownerB,
    assets,
    shares: "1",
    seized_assets: null,
    bad_debt_assets: null,
    bad_debt_shares: null,
    prev_borrow_rate: null,
    fee_shares: null,
    fee: null,
  }
}

export const morphoFixture: NeonMorphoRow[] = [
  morphoEvent(1, "SUPPLIED", "1000"),
  morphoEvent(2, "BORROWED", "300"),
]

export const enclaveFixture: NeonEnclaveRow[] = [
  {
    tx_hash: tx(50),
    log_index: "0",
    ve_btc_token_id: "100",
    block_number: "106",
    timestamp: String(epochE + 700),
    tx_from: ownerA,
    contract_address: "0x2c5e9afbb670c4a61ac2dcad62c258ee2391389a",
    enclave: enclaveA,
    position_id: "7",
    borrower: ownerA,
    action: "POSITION_OPENED",
    amount: "250",
    principal: "250",
    interest_rate: 500,
    originator_fee_rate: null,
    warning_cr: null,
    minimum_cr: null,
    lock_duration: null,
    other_ve_btc_token_id: null,
    pledged_ve_btc: '["100"]',
  },
]

export const contractFixture: NeonContractRow[] = [
  {
    address: poolP,
    kind: "pool",
    template: "Pool",
    pool: poolP,
    gauge: null,
    token0: btc,
    token1: musd,
    pool_type: "volatile",
    discovered_at: "2026-11-05T00:01:40.000000Z",
  },
  {
    address: gaugeG,
    kind: "gauge",
    template: "Gauge",
    pool: poolP,
    gauge: gaugeG,
    token0: btc,
    token1: musd,
    pool_type: "volatile",
    discovered_at: "2026-11-05T00:01:40.000000Z",
  },
  {
    address: bribeG,
    kind: "bribeVotingReward",
    template: "BribeVotingReward",
    pool: poolP,
    gauge: gaugeG,
    token0: btc,
    token1: musd,
    pool_type: "volatile",
    discovered_at: "2026-11-05T00:01:41.000000Z",
  },
]

/** Rows past a checkpoint, capped, completing the last position. */
export function window<Row>(
  rows: readonly Row[],
  position: (row: Row) => bigint,
  checkpoint: string,
  cap: number,
): Row[] {
  const after = rows
    .filter((row) => position(row) > BigInt(checkpoint))
    .sort((a, b) => (position(a) < position(b) ? -1 : 1))
  const last = after[cap - 1]
  if (last === undefined) return after
  const bound = position(last)
  return after.filter((row) => position(row) <= bound)
}

/** The warehouse rows a fixture reader serves; tests may change them. */
export type FixtureSource = {
  activity: NeonActivityRow[]
  locks: NeonLockRow[]
  deposits: NeonDepositRow[]
  troves: NeonTroveRow[]
  morpho: NeonMorphoRow[]
  enclave: NeonEnclaveRow[]
  contracts: NeonContractRow[]
}

const byContract = (a: NeonContractRow, b: NeonContractRow) =>
  a.discovered_at === b.discovered_at
    ? a.address.localeCompare(b.address)
    : a.discovered_at < b.discovered_at
      ? -1
      : 1

/**
 * An in-memory ScanWarehouseReader over the fixture, with the SQL's
 * semantics (neon.test.ts checks the SQL against PGlite): windows, the
 * touched and swept locks, the full Enclave diff and the contracts
 * lookback and daily full read.
 */
export function fixtureReader(
  overrides: Partial<FixtureSource> = {},
): ScanWarehouseReader & { reads: ScanReadPlan[]; source: FixtureSource } {
  const source: FixtureSource = {
    activity: [...activityFixture],
    locks: [...lockFixture],
    deposits: [...depositFixture],
    troves: [...troveFixture],
    morpho: [...morphoFixture],
    enclave: [...enclaveFixture],
    contracts: [...contractFixture],
    ...overrides,
  }
  const reads: ScanReadPlan[] = []
  const blockOrder = (
    a: { block_number: string; log_index: string },
    b: { block_number: string; log_index: string },
  ) =>
    Number(a.block_number) - Number(b.block_number) ||
    Number(a.log_index) - Number(b.log_index)
  function withRecheck<Row extends { block_number: string; log_index: string }>(
    rows: readonly Row[],
    checkpoint: string,
    cap: number,
    keyOf: (row: Row) => string,
  ): { rows: Row[]; window: number } {
    const fromWindow = window(
      rows,
      (row) => BigInt(row.block_number),
      checkpoint,
      cap,
    )
    const cp = BigInt(checkpoint)
    const recheck = rows
      .filter((row) => {
        const block = BigInt(row.block_number)
        return block > cp - BigInt(blockOverlap) && block <= cp
      })
      .sort(blockOrder)
      .slice(0, overlapRows)
    const byKey = new Map<string, Row>()
    for (const row of [...recheck, ...fromWindow]) byKey.set(keyOf(row), row)
    return {
      rows: [...byKey.values()].sort(blockOrder),
      window: fromWindow.length,
    }
  }
  return {
    reads,
    source,
    async read(plan) {
      reads.push(plan)
      const { checkpoints, caps, tables } = plan
      const windowCounts: Record<ScanTable, number> = {
        activity: 0,
        deposits: 0,
        troves: 0,
        morpho: 0,
        enclave: 0,
        contracts: 0,
      }
      const activityWindow = tables.has("activity")
        ? window(
            source.activity,
            (row) => BigInt(row.timestamp),
            checkpoints.activity,
            caps.activity,
          )
        : []
      windowCounts.activity = activityWindow.length
      const cp = BigInt(checkpoints.activity)
      const activityOrder = (a: NeonActivityRow, b: NeonActivityRow) =>
        blockOrder(a, b) || a.id.localeCompare(b.id)
      const activityRecheck = tables.has("activity")
        ? source.activity
            .filter((row) => {
              const ts = BigInt(row.timestamp)
              return ts > cp - BigInt(activityOverlapSeconds) && ts <= cp
            })
            .sort(activityOrder)
            .slice(0, overlapRows)
        : []
      const activityById = new Map(
        [...activityRecheck, ...activityWindow].map((row) => [row.id, row]),
      )
      const activity = [...activityById.values()].sort(activityOrder)
      const touched = new Set(
        activityWindow.flatMap((row) =>
          row.token_id === null ? [] : [row.token_id],
        ),
      )
      const lockId = (row: NeonLockRow) =>
        `${row.contract_address}-${row.token_id}`
      const sweep = plan.lockSweep
      const swept =
        sweep === null
          ? []
          : [...source.locks]
              .sort((a, b) => lockId(a).localeCompare(lockId(b)))
              .filter((row) => lockId(row) > sweep.after)
              .slice(0, sweep.rows)
      const lastSwept = swept.at(-1)
      const txKey = (row: { tx_hash: string; log_index: string }) =>
        `${row.tx_hash}-${row.log_index}`
      const none = { rows: [], window: 0 }
      const deposits = tables.has("deposits")
        ? withRecheck(
            source.deposits,
            checkpoints.deposits,
            caps.deposits,
            txKey,
          )
        : none
      const troves = tables.has("troves")
        ? withRecheck(source.troves, checkpoints.troves, caps.troves, txKey)
        : none
      const morpho = tables.has("morpho")
        ? withRecheck(source.morpho, checkpoints.morpho, caps.morpho, txKey)
        : none
      windowCounts.deposits = deposits.window
      windowCounts.troves = troves.window
      windowCounts.morpho = morpho.window
      const enclaveSorted = [...source.enclave].sort(
        (a, b) =>
          blockOrder(a, b) ||
          a.ve_btc_token_id.localeCompare(b.ve_btc_token_id),
      )
      const enclaveWindow = tables.has("enclave")
        ? window(
            source.enclave,
            (row) => BigInt(row.block_number),
            checkpoints.enclave,
            caps.enclave,
          )
        : []
      windowCounts.enclave = enclaveWindow.length
      // The rotating diff: rows after the sweep key, in key order.
      const enclaveSweep = tables.has("enclave")
        ? (plan.enclaveSweep ?? null)
        : null
      const sweepTuple = (key: string) =>
        key === ""
          ? [-1n, -1n, -1n]
          : key.split("|").map((part) => BigInt(part))
      const afterKey = (row: NeonEnclaveRow, after: string) => {
        const a = sweepTuple(enclaveSweepKey(row))
        const b = sweepTuple(after)
        for (let index = 0; index < 3; index += 1) {
          const x = a[index] ?? 0n
          const y = b[index] ?? 0n
          if (x !== y) return x > y
        }
        return false
      }
      const sweptEnclave =
        enclaveSweep === null
          ? []
          : enclaveSorted
              .filter((row) => afterKey(row, enclaveSweep.after))
              .slice(0, enclaveSweep.rows)
      const lastSweptEnclave = sweptEnclave.at(-1)
      const enclaveWrapped =
        enclaveSweep === null ||
        lastSweptEnclave === undefined ||
        sweptEnclave.length < enclaveSweep.rows
      const enclaveMode: ScanRows["enclaveMode"] = !tables.has("enclave")
        ? "none"
        : enclaveSweep === null
          ? "window"
          : enclaveSweep.after === "" && enclaveWrapped
            ? "full"
            : "sweep"
      const [at = "", address = ""] = checkpoints.contracts.split("|")
      const recheckFrom = contractsLookback(checkpoints.contracts)
      const sortedContracts = [...source.contracts].sort(byContract)
      const contracts = !tables.has("contracts")
        ? []
        : plan.fullContracts
          ? sortedContracts.slice(0, caps.contracts * 10)
          : sortedContracts
              .filter(
                (row) =>
                  row.discovered_at > at ||
                  (row.discovered_at === at && row.address > address),
              )
              .slice(0, caps.contracts)
      windowCounts.contracts = contracts.length
      const countsFrom = plan.countsFrom ?? null
      const dayCounts: DayCount[] = []
      if (countsFrom !== null) {
        const tablesOf: [string, readonly { timestamp: string }[]][] = [
          ["activity", source.activity],
          ["deposits", source.deposits],
          ["troves", source.troves],
          ["morpho", source.morpho],
          ["enclave", source.enclave],
        ]
        const counted = plan.countTables ?? tablesOf.map(([name]) => name)
        for (const [table, list] of tablesOf) {
          if (!counted.includes(table)) continue
          const byDay = new Map<number, number>()
          for (const row of list) {
            const ts = Number.parseInt(row.timestamp, 10)
            if (ts < countsFrom) continue
            const start = ts - (ts % 86_400)
            byDay.set(start, (byDay.get(start) ?? 0) + 1)
          }
          for (const [dayStart, rows] of [...byDay.entries()].sort(
            ([a], [b]) => a - b,
          )) {
            dayCounts.push({ table, dayStart, rows })
          }
        }
      }
      return {
        activity,
        locks: source.locks.filter((row) => touched.has(row.token_id)),
        sweptLocks: swept,
        sweepAfter:
          sweep !== null &&
          lastSwept !== undefined &&
          swept.length >= sweep.rows
            ? lockId(lastSwept)
            : null,
        deposits: deposits.rows,
        troves: troves.rows,
        morpho: morpho.rows,
        enclave: enclaveWindow,
        sweptEnclave,
        enclaveSweepAfter:
          enclaveWrapped || lastSweptEnclave === undefined
            ? null
            : enclaveSweepKey(lastSweptEnclave),
        enclaveMode,
        contracts,
        recheckedContracts:
          !tables.has("contracts") || plan.fullContracts || at === ""
            ? []
            : sortedContracts
                .filter(
                  (row) =>
                    row.discovered_at >= recheckFrom &&
                    (row.discovered_at < at ||
                      (row.discovered_at === at && row.address <= address)),
                )
                .slice(0, contractsRecheckRows),
        windowCounts,
        rejected: [],
        dayCounts,
      }
    },
  }
}
