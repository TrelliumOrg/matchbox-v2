# Matchbox indexer

The Mezo warehouse ingest: a scheduled Worker that reads `eth_getLogs` from
Mezo RPC and writes the decoded events into Postgres (Neon in production),
where the jobs Worker ([apps/jobs](../jobs)) builds the read models from
them. It replaces an earlier Goldsky subgraph, whose manifest the tests
still compare against.

Run it locally on your own Postgres with no other credentials (see
Commands: copy `.dev.vars.example`, which has a one-line `docker run`).
`pnpm --filter @matchbox/indexer test` needs nothing: it runs on PGlite and a
fake chain.

## How ingest works

- **Contracts.**
  - The explorer subgraph's static data sources (`src/ingest/static-contracts.ts`),
    including the 18 `Legacy*` reward contracts.
  - Children discovered from `PoolsVoter.GaugeCreated` (gauge, bribe and fee reward
    contracts) and `PoolFactory.PoolCreated` (pools).
  - Warehouse-only: the bribe reward contracts of BoostVoter, ValidatorsVoter and
    ThirdPartyVoter gauges (kind `voterBribeReward`, from their 3-argument
    `GaugeCreated`), and the mUSD `BorrowerOperations` and `TroveManager`
    (static, from their deployment at block 178,630).
  - All of them live in `matchbox.contracts`. A `GaugeCreated` links an
    already-registered pool to its gauge, but never registers a pool it only
    names (CL pools were never explorer templates).
- **Topics.**
  - Only the events a handler reads are stored, per contract kind
    (`src/ingest/topics.ts`), as one `eth_getLogs` filter per topic group.
  - Pools' `Sync`/`Fees`/LP `Transfer`/`Approval` alone would double the raw table.
  - Every filter lists its addresses, including the ~750 voter bribe
    contracts (their own group, eight address chunks a window). An
    address-less scan of their reward topics let any contract's look-alike
    logs fill a provider's result cap and stall ingest (audit MBX-02).
  - Widening a set is a config change plus a re-backfill.
  - `test/ingest/manifest.test.ts` fails if the explorer contracts or topics
    drift from the explorer manifest (a snapshot of the earlier subgraph's
    manifest in `test/fixtures/activity-subgraph`).
- **Windows.**
  - Logs are fetched in 10,000-block windows, at most 100 addresses per filter
    on `rpc-internal.mezo.org`. ValidationCloud (30) and Boar are fallbacks.
  - Failures retry with backoff, then fail over to the next endpoint.
  - A query no endpoint serves is split by block range, then within one block
    by address, and only that address chunk. One contract's logs in one block
    can't be split; that fails the window rather than drop logs.
  - Each address chunk may split 128 times, a window 512 times. When every
    endpoint is unreachable (network error, timeout, HTTP 429/5xx) a query
    splits at most four times in a row, then fails as an "RPC outage".
  - A child created mid-window has its logs from that same window fetched
    before the window commits.
- **Timestamps.**
  - Mezo's `eth_getLogs` returns `blockTimestamp: "0x0"`, so every timestamp
    comes from a batched `eth_getBlockByNumber` header.
  - A header whose hash differs from the log's `blockHash` fails the window.
  - `CHECK (block_timestamp > 0)` guards the table.
- **Transactions.** Every transaction that emitted a stored log is kept, with
  `from` and `to`. Its `input` is the 4-byte selector, except for
  `claimBribes` / `claimFees` / `claimFeesAndBribes` calls sent straight to a
  voter, which keep their full calldata so claims carry the lock's tokenId
  (`src/decode/calldata.ts`). Full calldata was about 80% of each row.
- **Commits.**
  - A window's logs, transactions, registry changes and checkpoint commit in one
    transaction. Re-ingesting is a no-op.
  - The `logs` checkpoint covers a contiguous prefix from the network start
    block (5,000,000). An out-of-order range never advances it past a gap.
    Windows below the start (the mUSD history) never move it.
- **Finality.** Mezo is CometBFT (instant finality, not independently verified).
  Ingest stays 2 blocks behind head and stores `block_hash`.
- **Retention.** Raw logs and transactions are deleted once projected and more
  than 160,000 blocks (about 7 days) behind ingest (`src/maintenance.ts`).
  Nothing outside the indexer reads `matchbox_raw`; a replay re-ingests
  history from RPC (`rebuild:history -- --replay`). This keeps the warehouse
  inside Neon Free's 1 GB.

## Decoder

`src/decode` projects raw logs into `matchbox.activity_events` (the explorer's
`ActivityEvent`, field for field), `lock_positions`, `votes`, `bribe_to_pool`,
and the warehouse-only `reward_deposits` and `trove_updates`. Rows the explorer
would not have produced have `explorer_parity = false`. The rest matched
`matchbox-explorer` 3.4.0 row for row (last run 2026-10-24); that subgraph was
deleted on 2026-10-25, so the decoder fixture tests, recorded from it, are the
remaining check (they run as decoder v2, the explorer's semantics).

Pool gauges created before 7,739,500 are decoded only through the legacy
tables in `src/decode/handlers/rewards.ts`, because the decoder skips
`PoolsVoter.GaugeCreated` before that block. `LEGACY_POOL_REWARDS` is the
explorer's table (9 gauges). `WAREHOUSE_LEGACY_POOL_REWARDS` adds the sMUSD
gauge, which that table missed (its rows are warehouse-only).
`test/decode/legacy-gauges.test.ts` checks both against every `GaugeCreated`
before that block, recorded from chain.

`DECODER_VERSION` is 3 (`src/decode/version.ts`). The Worker projects with
the version the tables were built with, while it is in
`SUPPORTED_DECODER_VERSIONS` (2 and 3), so deploying a new decoder never
halts projection; `/health` shows `upgradeAvailable: true` until a
`rebuild:history -- --replay` builds the tables with v3. A database built
by an unsupported version halts projection until that replay. v3 over v2:

- the escrows project from the network start (5,000,000) instead of the
  explorer's 7,739,500, so the 5,346 veBTC and 57 veMEZO locks created
  before that block have their real history (their rows before it are
  warehouse-only);
- each escrow's own MAXTIME (veBTC 28 days, veMEZO 208 weeks;
  `ESCROW_MAXTIME` in `@matchbox/chain`) where v2 used the explorer's 4 x
  365 days for both: the end `UnlockPermanent` sets and the durations of
  permanent locks. On chain it is `maxLockTime` in storage slot 82 of both
  proxies, written only by the initializer, so it changes only through an
  upgrade; each tick reads the slot (`src/escrow-maxtime.ts`) and a
  difference logs "ESCROW MAXTIME CHANGED" and stops the heartbeat;
- a warehouse-only `LOCK_BOOST_UPDATED` activity row per `UpdateBoost`,
  not counted in the lock's `activity_count`.

A replay is a maintainer operation on the live warehouse; the commands are
under Commands (`rebuild:history -- --replay`).

## Borrow stream

`src/borrow` indexes the two borrowing systems besides mUSD troves
(`docs/research/mezo-borrow-markets.md`): Morpho Blue and Enclave debt. It is
warehouse-only and runs beside the warehouse ingest, not inside it, so
nothing the live tables or the explorer-parity decoder depend on changes.

- **Contracts.** Morpho Blue, the EnclaveDebtManager and both Enclaves
  (`BORROW_STATIC_CONTRACTS` in `@matchbox/chain`), in
  `matchbox.borrow_contracts`. There is no Enclave factory: governance grants
  `ENCLAVE_ROLE` on the EnclaveDebtManager. A `RoleGranted` for that role
  registers the new Enclave, and its earlier logs (it may lock veBTC weeks
  before the grant) are fetched from block 8,199,414 before the window
  commits.
- **Events.** Morpho `CreateMarket`, `Supply`, `Withdraw`,
  `SupplyCollateral`, `WithdrawCollateral`, `Borrow`, `Repay`, `Liquidate`,
  `AccrueInterest` and `SetFee`. EnclaveDebtManager position events
  (`PositionOpened`, `DebtIncreased`, `DebtRepaid`, `PositionClosed`, pledged
  veBTC added or removed, rate and threshold changes). Enclave `VeBTCLocked`,
  `VeBTCIncreased`, `VeBTCMerged` and `VeBTCWithdrawn`. `Upgraded` on any of
  the proxies logs "BORROW CONTRACT UPGRADED".
- **Tables** (`db/migrations/matchbox/0012_borrow.sql`, additive):
  - `morpho_events`: one row per log, classified (`SUPPLIED`, `BORROWED`,
    `REPAID`, `LIQUIDATED`, `INTEREST_ACCRUED` and so on).
  - `morpho_markets`: each market's parameters and totals, replayed from
    events. They equal `Morpho.market(id)` on chain, and collateral is
    summed from the collateral events.
  - `enclave_events`: debt and veBTC collateral history with a veBTC token
    id on every row. Debt rows carry the position's lowest pledged veBTC.
    Collateral rows have one row per veBTC that moved. Every row has the
    pledged set after the event. The EnclaveDebtManager has no liquidation
    path (no function sets `closedByLiquidation`), so there is no
    liquidation action.
  - `borrow_contracts` and `borrow_state` (the borrow decoder version).
  - Amounts are `numeric(78,0)` base units, like `trove_updates`, and exact
    bigints in TypeScript; select them `::text`.
- **Commits.** No raw rows: each 10,000-block window's rows, market totals,
  new contracts and the `borrow` checkpoint commit in one transaction under
  an advisory lock, and only if the checkpoint has not moved since the
  window started. A window that can't be fetched or decoded is never skipped.
- **Decoder version.** `BORROW_DECODER_VERSION` is 1, kept in
  `matchbox.borrow_state`. Another version halts the stream ("BORROW HALTED")
  until `backfill:borrow -- --replay`, which re-reads RPC (about three
  minutes from the first block).
- **Before the migration.** Without `0012_borrow.sql` the stream logs "Borrow
  tables missing" and stays idle, and `/health` reports `borrow` as null, so
  this Worker can still replace the live one before the migration runs.

## Scan stream

`src/scan-stream` fills two tables for Matchscan, beside the warehouse and
the borrow stream, on its own checkpoint (stream `scan`), with no raw rows
(`db/migrations/matchbox/0015_scan_stream.sql`):

- **`token_transfer_days`**: ERC-20 `Transfer` per token and UTC day for
  MEZO, mUSDC, mUSDT, mSolvBTC, mcbBTC and mbhBTC (`SCAN_STREAM_TOKENS` in
  `@matchbox/chain`, symbol and decimals read on chain): count, summed
  value, and the value of Transfers from (minted) and to (burned) the zero
  address. Supply cannot be replayed from these rows for MEZO (genesis
  supply) or the four bridged tokens: their first supply appears in a block
  with no log at all. mbhBTC's first supply was exactly a Transfer from
  0x0, a candidate only until a full replay matches `totalSupply()`.
- **`musd_fees`**: `BorrowingFeePaid`, `RefinancingFeePaid` (MUSD),
  `Redemption`'s collateral fee (BTC), and the MUSD minted to PCV by its
  minter: `INTEREST` (trove interest: the mints beyond the fees in a
  transaction where the ActivePool's debt changed) and `ENCLAVE` (Enclave
  interest and originator fees: the mints in a transaction where
  EnclaveDebtManager accrued them or moved debt). Other mints to PCV, the
  100M MUSD bootstrap loan at block 179,091, are not fees.
- **Filters.** Two `eth_getLogs` per 10,000-block window: the tokens'
  `Transfer` with the fee events of BorrowerOperations and TroveManager,
  ActivePool's `ActivePoolDebtUpdated` and EnclaveDebtManager's interest,
  fee and debt events in one filter (none of them emits another's events),
  and MUSD `Transfer(0x0, PCV)` through the RPC client's topic 1 to 3
  matching.
- **Commits.** A window's day rollups (added to), fee rows and checkpoint
  commit in one transaction under an advisory lock, only if the checkpoint
  has not moved since the window was fetched, so a window never applies
  twice.
- **History.** From genesis: 1,313 windows at block 13.1M. The cron does
  200,000 blocks a tick (about 66 ticks), or `backfill:scan -- --apply`
  does it from a laptop; both use the same checkpoint. Before 0015 the
  stream logs "Scan stream tables missing" and stays idle.
- **Decoder version.** `SCAN_DECODER_VERSION` is 1, in
  `matchbox.scan_stream_state`; another version halts the stream ("SCAN
  HALTED") until `backfill:scan -- --apply --replay`.

## Change markers for incremental readers

`db/migrations/matchbox/0013_row_seq.sql` and `0014_row_seq_finish.sql`
let a reader (the jobs Worker's scan copy) copy tables incrementally
without overlap re-reads or full diffs, whatever order rows arrive in.

- **Stamps.** `activity_events`, `lock_positions`, `reward_deposits`,
  `trove_updates`, `morpho_events`, `enclave_events` and `contracts` (and
  the scan stream's tables, below) have `row_seq bigint`. A trigger sets it
  from the one sequence `matchbox.row_seq` on every insert and on every
  update that changes the row (`WHEN (OLD IS DISTINCT FROM NEW)`, so the
  projection's no-op upserts and the tick's static-contract re-seed keep
  their stamps). Code never writes it.
- **Commit-safe order.** The trigger takes advisory lock
  `0x6d626f78726f7773` (transaction-scoped) before `nextval`, so writers of
  tracked rows are serialized from their first tracked write to their
  commit. When a reader sees a stamp, every lower stamp that will ever
  commit is already visible: `row_seq > checkpoint` never skips a row that
  was in flight. `test/row-seq/concurrency.pg.test.ts` shows a bare
  sequence losing a row with two interleaved transactions and the trigger
  preventing it.
- **Tombstones.** Deleting a tracked row writes a `matchbox.deleted_rows`
  row (`kind 'row'`, its key as text). A replay that empties a table
  (`resetProjection`, the borrow replay) writes one `kind 'reset'` row per
  table instead (`src/row-seq.ts`, `deleteNetworkRows`), and so does
  `TRUNCATE` (network NULL: every network). Raw pruning writes none.
- **History.** Rows from before 0013 are stamped once by
  `backfill:row-seq`, from a range below 10^12, in block order. Live stamps
  start at 10^12.
- **Writers.** The cron tick (one connection), `backfill` and
  `rebuild:history` (`--concurrency` parallel windows), `backfill:borrow`,
  `project`, the new `backfill:row-seq`, and any manual SQL. The lock makes
  them safe together, but a writer that holds it long (a manual batch of
  minutes) stalls the tick's writes past the indexer role's 10 s statement
  timeout: commit in small batches.

Readers follow `row_seq` (see Commands for the migrations and backfills
that add it).

## Commands

Migrations, roles, the loads and projection need the direct
(non-pooler) `DATABASE_URL_UNPOOLED`. The linked Neon development branch puts it
in `apps/indexer/.dev.vars` or the repository-root `.env.local` (both
ignored). Point them at a Neon development branch, never production.
Without Neon access, copy `.dev.vars.example` to `.dev.vars`: it points at a
local Postgres (the file has a one-line `docker run`), and ingest reads the
public Mezo RPC. `pnpm --filter @matchbox/indexer test` needs neither.

```bash
pnpm --filter @matchbox/indexer migrate
pnpm --filter @matchbox/indexer roles   # re-run after new migrations
pnpm --filter @matchbox/indexer verify:warehouse
pnpm --filter @matchbox/indexer vacuum:raw   # after a migration that trims raw rows

# Apply migrations up to one file and stop (0013 before backfill:row-seq).
pnpm --filter @matchbox/indexer migrate -- --until 0013_row_seq.sql
# Stamp rows from before 0013. Dry run unless --apply.
pnpm --filter @matchbox/indexer backfill:row-seq -- [--apply] \
  [--batch 5000] [--vacuum-every 20000]

# Full load or replay: ingest, project and prune 500,000 blocks at a time, so
# raw never holds more than one chunk plus the retention tail. --from defaults
# to block 178,630 (mUSD); resumable after the projection checkpoint; stops
# before 90% of the storage cap. --replay truncates the projection first.
pnpm --filter @matchbox/indexer rebuild:history -- --network mezo \
  [--replay] [--from N] [--to N] [--chunk 500000] [--concurrency 4]

# Raw ingest alone, without projecting or pruning (the cron prunes what it
# projects later). Resumable, and stops cleanly over --max-db-mb.
pnpm --filter @matchbox/indexer backfill -- --network mezo \
  [--from N] [--to N] [--concurrency 4] [--max-db-mb 900] [--skip-discovery]

# Project raw logs. --replay refuses once raw is pruned: use rebuild:history.
pnpm --filter @matchbox/indexer project -- --network mezo [--replay]

# Once, on a database ingested before full claim calldata was kept.
pnpm --filter @matchbox/indexer refetch:claims -- --network mezo [--dry-run]

# Borrow stream catch-up (the cron also does 200,000 blocks a tick), or a
# full rebuild after a borrow decoder version bump with --replay.
pnpm --filter @matchbox/indexer backfill:borrow -- --network mezo \
  [--replay] [--to N] [--chunk 500000] [--concurrency 4]

# Scan stream history (token transfer days from genesis, mUSD fees). Dry run
# unless --apply; --probe N decodes the next N windows without writing.
pnpm --filter @matchbox/indexer backfill:scan -- --network mezo \
  [--apply] [--replay] [--to N] [--max-windows 400] [--concurrency 4] [--probe N]

# Re-record the borrow fixtures from mainnet RPC (read-only).
pnpm --filter @matchbox/indexer exec tsx scripts/record-borrow-fixtures.ts --to N

# Add the rows of Legacy* reward contracts the projection skipped, from RPC,
# up to the projection checkpoint. Dry run unless --apply; safe to re-run.
# Prints the database host first; --apply needs --expect-host <that host>.
# Aborts, writing nothing, if a replay or reset changes the projection
# meanwhile. Defaults to the sMUSD gauge's two contracts (the sMUSD gauge's
# missing incentives).
pnpm --filter @matchbox/indexer reproject:legacy-rewards -- --network mezo \
  [--contract 0x...] [--concurrency 4] [--apply --expect-host <host>]

# Re-record every voter GaugeCreated before block 7,739,500 (read-only), the
# fixture test/decode/legacy-gauges.test.ts checks the legacy tables with.
# Refuses to write it unless each voter's length() at block 7,739,499
# equals the logs found for it (10, 33, 1 and 21 on 11 Nov 2026).
pnpm --filter @matchbox/indexer exec tsx scripts/record-legacy-gauges.ts
```

`--skip-discovery` drops the factory pre-scan. Only use it when the range's
children are already in `matchbox.contracts`, because parallel windows need the
full address set up front.

## Worker

`src/index.ts` runs every 15 minutes (`wrangler.jsonc` cron; each tick wakes
the Neon compute, and Neon Free has 100 CU-hours a month). Each tick:

1. checks the storage guard: at 90% of `neon.max_cluster_size` it logs
   "WAREHOUSE NEAR STORAGE CAP" and writes nothing;
2. ingests from the `logs` checkpoint to head minus 2, at most 50,000 blocks;
   a window it can't fetch is never skipped: it logs "INGEST FAILED" with the
   lag and the cause, and the checkpoint waits there until someone fixes it;
3. projects what it ingested;
4. prunes raw past the retention window, at most 250,000 blocks per tick;
5. runs the borrow stream from the `borrow` checkpoint, at most 200,000
   blocks per tick ("BORROW INGEST FAILED" or "BORROW HALTED" otherwise; a
   borrow failure never stops steps 2 to 4, and the reverse), then the scan
   stream from the `scan` checkpoint the same way ("SCAN INGEST FAILED",
   "SCAN HALTED");
6. pings `HEARTBEAT_URL`, if set, while the checkpoint isn't stale,
   projection isn't halted or failing, and both escrows' MAXTIME slots hold
   `ESCROW_MAXTIME`;
7. calls the post-tick hook, if bound (below).

A failure in step 2, 3 or 5 (either stream) is thrown after step 7, so Cloudflare still
records the tick as failed.

`GET /health` (`src/health-report.ts`) reports head, last block, lag,
`stale` (lag over 700 blocks, about 45 minutes), projection state, `borrow`
and `scan` (last block, lag, decoder versions; null fields while a stream's
tables do not exist, so it answers at every migration step),
`escrowMaxTime` (`ok` and any drift) and `database` (`bytes`, `capBytes`,
`usedPercent`, `writable`), with status 503 only when stale. It queries the
database, so it wakes the compute: check it by hand, not from a monitor.
Alerts come from a dead man's switch on the heartbeat (`HEARTBEAT_URL`).

- `DATABASE_URL` is a secret: `wrangler secret put DATABASE_URL`. Use the
  direct URL for a login granted `matchbox_indexer`.
- `HEARTBEAT_URL` is an optional secret: a heartbeat monitor's ping URL.
- On an empty `logs` checkpoint the cron starts at the network start, so the
  mUSD history before it only arrives through `rebuild:history`.

## Post-tick hook for apps/jobs

Neon's free compute suspends five minutes after its last query, and every
tick wakes it. Anything else that reads Neon (the jobs Worker's warehouse
snapshot into D1) should run inside that same wake window, chained right
after the tick, instead of waking Neon again.

The contract is `src/hook.ts`, exported as `@matchbox/indexer/hook`
(types and `runTickHook` only):

- matchbox-jobs' default `WorkerEntrypoint` has
  `warehouseSnapshot(summary?: IndexerTickSummary)` (`apps/jobs/src/index.ts`).
- The indexer gets a service binding to it named `JOBS` (`wrangler.jsonc` has
  it commented out until matchbox-jobs is deployed).
- At the end of every tick, after its last query (and also when the storage
  guard paused the tick), the indexer awaits
  `JOBS.warehouseSnapshot(summary)`. A throwing snapshot is logged ("TICK
  HOOK FAILED") and never fails the tick or holds a checkpoint. Its result
  is ignored.
- `summary` is JSON-safe: the cron, start and end times, `neonAwakeUntil`
  (end of the tick plus five minutes), database usage and `writable`, and
  per stream (`ingest`, `projection`, `borrow`) a status (`advanced`,
  `at-head`, `failed`, `halted`) and last block as decimal strings.
- The jobs Worker uses its own Neon login (read-only `matchbox_api_ro` is
  enough for snapshots) and should skip the snapshot when no stream
  advanced. Each second it spends inside the window costs about 0.2 CU-hours
  a month.

The header of `src/hook.ts` shows a `warehouseSnapshot` that reads the
summary.

## Repairs

Production repairs (one-off backfills that write to the live warehouse) are run
by the maintainers and are not documented here. The tools they use are the
`backfill:*` scripts under Commands, which are dry runs unless `--apply`.

## Tests

`pnpm --filter @matchbox/indexer test` needs no database or network.

- The ported suite (decoder fixtures recorded from `matchbox-explorer`,
  ingest against a fake chain, manifest drift) plus `test/port`: every
  original ABI event decodes the same through `@matchbox/chain`, and every
  live migration keeps its checksum from Matchbox main.
- `test/borrow` replays all 2,405 borrow logs from mainnet (blocks 8,199,414
  to 13,098,469, `test/fixtures/borrow`, recorded by
  `scripts/record-borrow-fixtures.ts`) through the real ingest and RPC client,
  and checks the result against `Morpho.market(id)`, Morpho's BTC balance and
  `EnclaveDebtManager.getPosition` read on chain at the last block.
- `test/borrow/database.test.ts` applies every migration to PGlite (Postgres
  in WebAssembly, in process) and runs the Postgres borrow store on it.
- `test/row-seq` applies 0013 and 0014 on PGlite tables that already hold
  rows and checks stamps, the history backfill and tombstones under the
  real projection and ingest code. `concurrency.pg.test.ts` needs two
  connections, so it runs only on a real Postgres:
  `MATCHBOX_TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres`
  (it creates and drops a scratch database and two test logins there). It
  is skipped otherwise. CI runs it against a throwaway Postgres service.
