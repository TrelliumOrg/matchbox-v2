# matchbox-jobs

Cron Worker that fills `READ_DB` (D1) and the `PRICES` KV namespace with the
data Matchbox Pro reads through the API's `/internal/pro` routes. It never
serves user traffic, and nothing on a request path reads Neon.

## Jobs

| Trigger                                     | Job                | Writes                                                                                      |
| ------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `* * * * *`                                 | prices             | `price_samples` (each minute), `PRICES` `prices:v1` (every other minute)                    |
| `* * * * *`, beside the prices              | validator uptime   | `SCAN_DB`: `uptime_blocks`, `uptime_hourly`, `uptime_daily` ("Validator uptime")            |
| `* * * * *`, after the prices               | MUSD market price  | `SCAN_DB`: `market_quotes`, `market_price_daily` ("Cross-chain data")                       |
| `*/5 * * * *`                               | live RPC snapshot  | `morpho_markets`, `morpho_positions`, `troves`, `stability_pool`, `escrow_supply`           |
| `*/5 * * * *`, hourly                       | cross-chain parts  | `SCAN_DB`: `token_supply_daily`, `pool_daily`, `bridge_*` ("Cross-chain data")              |
| indexer service call, `3,18,33,48 * * * *`  | warehouse snapshot | `read_models`: wallet overview, rewards, activity per wallet, and protocol                  |
| after the price and live runs               | scan daily writers | `SCAN_DB`: `price_daily`, closing values and once-a-day counters in `daily`                 |
| same run, right after                       | scan copy step     | `SCAN_DB`: explorer rows, `epoch_totals`, `gauge_epoch`, copy-derived `daily`               |
| `*/5 * * * *`, after the scan daily writers | governance         | `SCAN_DB`: `gauge_emissions`, `epoch_sources`, `lock_distribution` ("Governance summaries") |

- **Prices.** BTC from the Chainlink-style BTC/USD feed on Mezo
  (`latestRoundData`), MEZO from CoinGecko (`simple/price`, id `mezo`),
  using the readers in `@matchbox/api/market/prices`. The 24h change comes
  from the D1 samples (kept three days). KV is written every other minute
  because the free plan allows 1,000 KV writes a day. A failed read keeps a
  last-known price for up to 10 minutes. See "MEZO's price" below.
- **Live snapshot.** One block, read with Multicall3: Morpho Blue markets
  (totals, borrow rate, oracle price) and every known account's position,
  MUSD troves (TroveManager owners array, `Troves`, `getEntireDebtAndColl`),
  Stability Pool totals and MUSD's own BTC price (`PriceFeed.fetchPrice()`).
  Morpho accounts are discovered from Supply, Borrow and SupplyCollateral
  logs and Morpho markets from CreateMarket logs, in one log scan of
  `MORPHO_LOG_WINDOWS_PER_RUN` windows of 10,000 blocks per run (one
  getLogs per window for all four events), so the first scan from
  deployment spreads over a few runs. Upserts only rewrite rows whose
  values changed. See "Morpho markets" below.
- **Warehouse snapshot.** Reads the Neon projections (`matchbox.*`) in READ
  ONLY transactions and writes wallet and protocol documents. Documents are
  only rewritten when an amount changes; the API reprices current USD values
  on read. Gauge documents come from the API's market cron, and the
  warehouse snapshot reads them for gauge names, pictures, votes and
  incentives (projected rewards and the Overview suggestion).
- **Wallet coverage.** Each run rebuilds everyone touched since the last
  run, up to 100 wallets the API had to serve live (`wallet_requests`,
  cleared once built), and a rotating sweep over every wallet with on-chain
  activity: anyone who ever owned a lock or acted in Mezo Earn, in address
  order, about 4,000 wallets. The zero address and burn addresses are
  excluded everywhere. The sweep size adapts to keep a run near 20 s (smaller
  after a slow run, 25 more after a fast one, never over
  `WAREHOUSE_SWEEP_WALLETS`), so the whole set cycles in about seven hours.
  The cap is the D1 budget, not time: a run takes about 5 s for 150 wallets,
  but swept wallets whose voting power decays rewrite their overview on
  every visit, about 450 row writes a run (45,000 of the free 100,000 a
  day).
- **Locks.** Each wallet's locks come from the warehouse, corrected by
  escrow `locked(tokenId)` at the snapshot: the chain's amount, end and
  permanence win, and locks the chain says are empty are dropped. The
  warehouse's escrow history starts at block 7.74M (locks created earlier
  carry only later deposits, e.g. veBTC #1048 at 0.0071 instead of 5.01
  BTC) and misses splits, so its sums undercount veBTC and overcount veMEZO.
  The protocol's locked totals use the escrows' `supply()`, read by the live
  snapshot into `escrow_supply` (rewritten only on change).
- **Gauge history.** Each run writes one `gauge-history` document per gauge
  (every epoch from its first vote or deposit: votes as of the epoch's last
  vote event, carried forward, and the incentives deposited) and the
  `gauge-funding` summary (funded epochs of the last 8, ever, and the
  current streak). Only changed documents are written.
- **Protocol history.** `protocol` charts every epoch from Epoch 0 (Thu 11
  Dec 2025). Each run
  also writes `protocol-history` (one row per epoch) and one
  `protocol-epoch` document per epoch. The current epoch carries today's
  stats; a past epoch keeps the stats its document had when it ended, and
  epochs that ended before snapshots were kept have null stats.

## Scheduling the warehouse snapshot

Neon's free plan has 100 CU-hours a month and the indexer's 15-minute tick
already uses about 62, because compute stays awake 5 minutes after the last
query. The warehouse snapshot therefore never wakes Neon on its own:

1. **Primary: chained after ingest.** The indexer binds this Worker as a
   service and calls it at the end of each tick, inside the same wake window:

   ```jsonc
   // apps/indexer/wrangler.jsonc
   "services": [
     { "binding": "JOBS", "service": "matchbox-jobs", "entrypoint": "default" }
   ]
   ```

   ```ts
   // after ingest and projection
   ctx.waitUntil(env.JOBS.warehouseSnapshot());
   ```

2. **Fallback: `3,18,33,48 * * * *`.** Three minutes after each indexer tick
   (`*/15`), still inside the 5-minute wake window. It does nothing when a
   chained run finished in the last 10 minutes (`snapshot_runs`), so it only
   runs if the indexer did not call.

## Bindings and secrets

| Name                         | Kind    | Notes                                                          |
| ---------------------------- | ------- | -------------------------------------------------------------- |
| `READ_DB`                    | D1      | `matchbox-read-models`, shared with the API. Schema below.     |
| `PRICES`                     | KV      | `matchbox-prices`, read by the API.                            |
| `WAREHOUSE_DATABASE_URL`     | secret  | Neon, role `matchbox_api_ro` (read only).                      |
| `MEZO_RPC_URLS`              | var     | Optional, comma-separated, primary first.                      |
| `BASE_RPC_URL`               | secret  | Optional preferred Base RPC; public Base RPCs follow it.       |
| `COINGECKO_API_KEY`          | secret  | Optional CoinGecko key; unset calls the keyless API.           |
| `ETHEREUM_RPC_URL`           | secret  | Optional preferred Ethereum RPC (cross-chain reads).           |
| `BSC_RPC_URL`                | secret  | Optional preferred BNB Chain RPC (MEZO supply there).          |
| `COINGECKO_API_PLAN`         | var     | `demo` (default) or `pro`: which host and header the key uses. |
| `COINGECKO_REFRESH_SECONDS`  | var     | Reuse a reading this long. Default 90; Demo key 360, min 300.  |
| `WAREHOUSE_SWEEP_WALLETS`    | var     | Most wallets swept per run (adaptive below it). 150.           |
| `MORPHO_LOG_WINDOWS_PER_RUN` | var     | Default 20.                                                    |
| `UPTIME_*`                   | var     | Community CometBFT nodes ("Validator uptime").                 |
| `SCAN_DB`                    | D1      | `matchbox-scan`, Matchscan's read models. Schema below.        |
| `API`                        | service | The API Worker's `InternalApi` entrypoint (Blockscout proxy).  |

## READ_DB schema

Migrations in `migrations/` (the API's Workers tests apply them too):
`read_models` (one validated JSON document per read model, keyed by
network, kind and wallet or gauge address, or epoch number), `price_samples`,
`morpho_markets`, `morpho_positions`, `morpho_accounts`, `troves`,
`stability_pool`, `escrow_supply`, `morpho_known_markets`, `job_cursors` and `snapshot_runs`, plus `watch_items`
(written by the API's watch list routes) and `wallet_requests` (written by
the API's live wallet path, drained here). Apply new migrations with
`pnpm exec wrangler d1 migrations apply matchbox-read-models --remote`. Amounts are TEXT:
`_raw` columns hold base-unit integers, the rest whole-unit decimals.

### MEZO's price

Most MEZO trading is on exchanges (Coinbase, Gate, Kraken, KuCoin: about
$790k a day on 12 Nov 2026) against about $22k on Aerodrome, and the legacy
Aerodrome pool (`0xef45…8b1f`) was left with about $1.9k after Aerodrome
moved to new contracts in October. So:

1. **CoinGecko** `simple/price?ids=mezo` (the aggregate market price; the id
   is checked against MEZO's addresses on Mezo, Ethereum and Base). Source
   `coingecko`. A quote CoinGecko last updated more than 30 minutes ago, or
   at $1M or more, is rejected.
2. **Fallback:** the new Aerodrome Slipstream MEZO/MUSD pool on Base
   (`0x7507…6943`, `slot0`, MUSD taken at $1), source `aerodrome-cl`. It is
   thin (about $4k deep, $22k a day) but deeper and busier than Tigris
   MEZO/MUSD on Mezo (about $3.9k, $3k a day). A rate limit or outage at
   CoinGecko shows as `aerodrome-cl` in `prices:v1` and Matchscan's token
   rows (`price_source`).

**Rate limits.** Keyless CoinGecko calls share an IP-based pool of about 5
a minute. This Worker reuses its own KV reading for
`COINGECKO_REFRESH_SECONDS`, and the API's 5-minute market cron reuses the
same KV reading for 8 minutes, so it adds no calls of its own while this
Worker runs. Keyless, the default is 90 s: a call every other minute, about
21,600 a month. A Demo key shares 10,000 calls a month with the keyed pool
reads, so its default and floor are set by `COINGECKO_API_PLAN` ("CoinGecko
call budget" below). The key goes in a header, never the URL, and is never
logged.

### CoinGecko call budget

A Demo key allows 10,000 calls a month and every call counts, errors
included. Two jobs spend from it: the MEZO price (above) and the
cross-chain pool depth ("Cross-chain data"). `src/coingecko-budget.ts`
derives both from `COINGECKO_API_PLAN`, for a 31-day month, and plans at
most 9,000 calls. The other 1,000 are margin for MUSD's CoinGecko fallback
(only when all three venues fail), repeats after errors, and manual runs.

- **When a price call happens.** KV is written on even minutes only, and
  each run reuses the reading in KV. A call on an odd minute would never
  reach KV, so the next even minute would call again. The job therefore
  calls only on even minutes: the refresh rounds up to an even number of
  minutes. Both 300 s and 360 s mean a call every 6 minutes. The reuse age
  passed to the reader is a minute short of that on even minutes and a
  minute past it on odd ones, so start-time jitter cannot move or double a
  call.
- **Price.** With a Demo key the refresh defaults to 360 s and is never
  below 300 s, whatever `COINGECKO_REFRESH_SECONDS` says. That is a call
  every 6 minutes: 44,640 minutes ÷ 6 = **7,440 calls**.
- **Pools.** One keyed call per chain (Mezo, Ethereum, Base; each takes up
  to 30 pools), so 3 per read. Hourly reads would cost 744 × 3 = 2,232, and
  9,672 in total leaves under 4% margin. Reads every **2 hours** cost
  372 × 3 = **1,116**.
- **Total: 8,556 a month**, 1,444 under the allowance (14%). In a 30-day
  month it is 7,200 + 1,080 = 8,280.
- **Guards.**
  - The pool interval is the shortest of 1, 2, 3, 4, 6, 8, 12 or 24 hours
    that fits within 9,000 beside the price job. If none fits, keyed pool
    reads are off and GeckoTerminal keyless is used.
  - One run makes at most 3 keyed pool calls (`maxKeyedPoolCallsPerRun`).
    A run that would need more reads the rest keyless.
  - Only the first run of a pool period (its first 5 minutes) may use the
    key. A partial run is retried every 5 minutes, and those retries read
    keyless, so they never multiply keyed calls.
  - Nothing is stored for this: the guards are a count per run and the
    clock.
- **A paid key** (`COINGECKO_API_PLAN=pro`) keeps the 90 s default (a call
  every 2 minutes, 22,320 a month) and reads pools hourly (2,232). Check
  the plan's allowance before setting a lower refresh.
- **Keyless** keeps 90 s and GeckoTerminal for pools, and spends nothing
  from a monthly allowance.

**Attribution.** CoinGecko's free and Demo terms require "Data provided by
CoinGecko" (or "Price data by CoinGecko"), linking to
https://www.coingecko.com, next to a figure that uses it: every page that
shows a MEZO dollar value whose `source` is `coingecko`.

**Deploy order.** `coingecko` is a new value of the KV's `source`. Deploy
the API (and Stuart) before this Worker, or an older reader rejects the
whole `prices:v1` value until it is redeployed.

### MUSD's protocol price (`stability_pool.musd_btc_price_*`)

MUSD prices every trove (ICR, liquidation, recovery mode) with its own
`PriceFeed.fetchPrice()`, not the market price. The live snapshot reads it
(a view call, one more in the multicall that already reads the pool
totals, at the same block) and stores it on the network's
`stability_pool` row (`migrations/0005_musd_price.sql`):

| Column                 | Meaning                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `musd_btc_price_raw`   | USD per BTC as an integer string at `musd_btc_price_scale` decimals: `74665554160000000000000` is 74,665.55416. NULL when `fetchPrice()` reverted |
| `musd_btc_price_scale` | 18 (PriceFeed scales the oracle to 18 digits); NULL with the price                                                                                |
| `musd_btc_price_block` | The block of the last live run that read the price (written every run, changed or not)                                                            |

ICR in the protocol's terms is `coll_raw * musd_btc_price_raw /
(principal_raw + interest_raw)`, an 18-decimal ratio (coll is 18-decimal
BTC, debt 18-decimal MUSD), which is exactly `TroveManager.getCurrentICR`:
the `troves` amounts come from `getEntireDebtAndColl`, pending
redistribution included; a trove's liquidation price is
`(principal_raw + interest_raw) * MCR / coll_raw` at the same scale (MCR
1.1e18), in integer arithmetic. Each `troves` row carries its own `block`
(rows are rewritten only on a change); both come from the same live run
when their blocks are equal. NULL means the oracle is older than PriceFeed's
`MAX_PRICE_DELAY`, so at that block the protocol itself cannot open,
adjust or liquidate troves: show that, or fall back to the market price
labelled as an estimate. The price columns are written by every live run
(every 5 minutes) right after its main batch, changed or not, so
`musd_btc_price_block` is the block of the last run that read the price.
The `troves` rows and the pool totals are rewritten only when they change,
so their `block` is never newer than the latest live run's: a price is
current for a trove or the pool when `musd_btc_price_block >= block` of
that row, and stale (its write failed after the main batch) when it is
older. Rows from before the migration's first live run have all three NULL.

### Morpho markets

Every Morpho market is read, not only the two configured in
`@matchbox/chain` (`MORPHO_MARKETS`): the log scan that finds accounts
also asks for `CreateMarket` (no extra request), and each market found is
stored in READ_DB `morpho_known_markets` (migration `0006`) before the
scan's cursor moves, so a market in a scanned window is never lost. The
store is READ_DB, not the warehouse's `matchbox.morpho_markets`: the live
snapshot runs every 5 minutes from RPC and READ_DB only and must not wake
Neon, and the markets advance with the same cursor as the accounts they
are read for.

- **Backfill.** The scan's cursor was already past the markets created
  before this change (the third, `0x4bff245d...`, at block 13,118,789), so
  a one-time backfill (`morpho-markets-backfill` in `job_cursors`) scans
  `CreateMarket` only from Morpho's deploy block (9,206,917) to where the
  scan was, within the same window budget, then marks itself `done`. On
  11 Nov 2026 that is about 394 windows: about 20 runs (100 minutes) at 20
  windows a run, after which it costs nothing.
- **Unknown tokens.** Each market's loan and collateral tokens' ERC-20
  `decimals()` are read when it is found and stored as `loan_decimals` and
  `collateral_decimals`; NULL when the token did not answer, and a reader
  must then not assume 18. Amounts stay base-unit integers (`_raw`), so no
  amount is ever scaled with a guessed precision; the API already resolves
  a series token's decimals from its registry and answers null when it does
  not know the token.
- **Without migration `0006`.** A found market cannot be stored: the run
  logs `MORPHO MARKETS NOT STORED`, still reads that market, writes
  everything else, and leaves both cursors where they were, so the same
  windows are scanned again once the migration is applied.
- **Cost per run.** RPC: the head, one getLogs per scan window (one at the
  head, as before), the backfill's windows until it is done, and four
  multicalls for the markets (state, parameters, rates with oracle prices,
  positions) whatever their number: two fewer requests than before, when
  each market's rate and price were separate calls. Positions are one call
  per account and market in those multicalls: 17 accounts x 3 markets = 51
  today (34 with two markets). One more multicall for token decimals, only
  on a run that finds a market. D1: two more reads per run (the known
  markets and the backfill cursor), one cursor write per run until the
  backfill is done, one insert per new market, and the new market's
  `morpho_markets` and `morpho_positions` rows, rewritten only on change.

## SCAN_DB schema (Matchscan)

Matchscan's explorer read models live in their own D1 database,
`matchbox-scan`, so Scan's reads and writes never share capacity with Pro's
`READ_DB` (`docs/scan-plan.md`, efficiency rule 9). Migrations are in
`scan-migrations/`. Mainnet only. Rows, not documents: every list is one
indexed range scan with a keyset cursor, never an offset. Amounts, weights
and token ids are base-unit integers as TEXT; `*_key` columns hold the same
integer zero-padded to 40 digits so TEXT order is numeric order. USD is
never stored: it is applied at read time from `price_daily` and the live
prices. Row schemas: `@matchbox/contracts/scan` (`rows.ts`).

| Table                                     | From                                         | Indexes (all newest first)                                                                                                                                                                  | Serves                                                                                         |
| ----------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `activity`                                | Neon `activity_events`                       | `id`; (tx_hash, log); (actor \| recipient \| gauge \| tx_from, block, log); (lock_escrow, token_id, block, log); (epoch_start, block, log); (action_type, ts, block, log); (ts, block, log) | A transaction's rows, an address's, a gauge's, a lock's, an epoch's, one action type, the feed |
| `locks`                                   | Neon `lock_positions`                        | (escrow, token_id); (owner, escrow, token_id), also as the unique `locks_owner_lock`; live locks by (escrow, amount_key) and (escrow, unlock_at); (escrow, created_at)                      | Lock detail, locks by owner, lock lists by amount, unlock or age                               |
| `lock_votes`                              | vote and abstain rows of `activity_events`   | (epoch_start, gauge, escrow, token_id); (epoch_start, gauge, weight_key); (escrow, token_id, epoch_start)                                                                                   | Voters of a gauge in an epoch (by weight), a lock's votes by epoch                             |
| `incentive_deposits`                      | Neon `reward_deposits`                       | (tx_hash, log); (gauge, epoch, block, log); (epoch, block, log); (depositor, block, log); (timestamp)                                                                                       | A gauge's or an epoch's incentives and fees, a depositor's history, deposits by day            |
| `trove_events`                            | Neon `trove_updates`                         | (tx_hash, log); (borrower, block, log); (action, block, log); (ts, block, log)                                                                                                              | A borrower's trove history, liquidations and redemptions, the feed                             |
| `morpho_events`                           | Neon `morpho_events`                         | (tx_hash, log); (market_id, block, log); (on_behalf, market_id, block, log); (action, block, log); (ts, block, log)                                                                         | Market activity, position history, liquidations, the feed                                      |
| `enclave_events`                          | Neon `enclave_events`                        | (tx_hash, log, ve_btc_token_id); (position_id, ...); (borrower, ...); (ve_btc_token_id, ...); (ts, ...)                                                                                     | Enclave position and veBTC collateral history                                                  |
| `labels`                                  | Neon `contracts` plus the curated seed       | `address` (prefix range); (name_lower, address) (prefix range); (kind, name_lower)                                                                                                          | Address names, contract kinds, search by name or address prefix                                |
| `pools`                                   | PoolCreated rows, Mezo's earn-pools subgraph | `pool`                                                                                                                                                                                      | Basic and CL pools and their tokens (pool balances, names)                                     |
| `epoch_totals`                            | computed from the tables above               | `epoch_start`                                                                                                                                                                               | Epoch list and detail                                                                          |
| `gauge_epoch`                             | computed from the tables above               | (gauge, epoch_start); (epoch_start, source, rank)                                                                                                                                           | Gauge history, rankings per epoch (killed gauges unranked)                                     |
| `daily`                                   | copy step, live snapshot, daily reads        | (metric, dimension, day); (metric, day, dimension); partial rows by day                                                                                                                     | Every chart on Network, Tokens, Locks and Borrow: one range scan per series                    |
| `price_daily`                             | the price job                                | (token, day)                                                                                                                                                                                | Historical USD, kept forever                                                                   |
| `scan_status`                             | every copy run                               | `id` (one row)                                                                                                                                                                              | How complete the data is (below)                                                               |
| `scan_quarantine`                         | the copy step                                | (source, row_key)                                                                                                                                                                           | Rows the copy could not transform                                                              |
| `scan_cursors`, `scan_dirty`, `scan_runs` | the copy step                                | name; (kind, key); (job, started_at)                                                                                                                                                        | Checkpoints, epochs and days to recompute, the run log (a week)                                |

Lists over a whole table or one action type are ordered by (timestamp,
block, log), which is the same order as (block, log) and also serves day
ranges; filtered lists by (block, log). `lock_votes` holds every epoch: a
lock's votes carry into the next epoch (`carried = 1`) until it re-votes or
resets, so "voters of gauge G in epoch E" is one prefix scan. `daily` keys
are `metric`, `dimension` and `day` (YYYY-MM-DD, UTC). The metrics, their
dimensions, units and definitions are one registry shared with the API:
`scanMetrics` and `scanMetricNotes` in `@matchbox/contracts/scan`
(`series.ts`); a jobs test fails if a writer produces a metric or a
dimension the registry would reject.

### Scan status

`scan_status` (one row, id 1, rewritten by every copy run):

| Column                               | Meaning                                                                                                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `last_run_status`, `last_run_at`     | The last run: `ok`, `skipped` (nothing advanced, or another run started under 10 minutes ago) or `failed`                                                                                                                                |
| `last_ok_at`                         | The last ok copy run that left no table halted (a halted table's rows stop at its checkpoint, so the data is not current). Not a change signal: key caches on `data_version`                                                             |
| `data_version`                       | Rises with every write that changed a served row (below)                                                                                                                                                                                 |
| `consecutive_failures`, `last_error` | Failed runs in a row, crashed ones included (0 after any ok or skipped run), and the last error                                                                                                                                          |
| `failed_runs_24h`                    | Copy runs that failed or crashed (left `running` over 15 minutes, marked failed by the next run) in the last 24 hours                                                                                                                    |
| `copied_through`                     | Newest activity second copied; copy-derived days up to here are complete                                                                                                                                                                 |
| `dirty_epochs`, `dirty_days`         | Epochs and days waiting for their aggregates (`scan_dirty`)                                                                                                                                                                              |
| `aggregates_complete`                | 1 when nothing is waiting                                                                                                                                                                                                                |
| `history_filled`                     | 1 once the first-fill SQL has been applied (`fill:neon` in `scan_cursors`)                                                                                                                                                               |
| `refill_required`, `refill_reason`   | 1 when the decoder version changed (a warehouse replay) or the daily count check found a day whose counts differ (the reason names table and day): re-fill                                                                               |
| `quarantined_rows`                   | Rows in `scan_quarantine`                                                                                                                                                                                                                |
| `halted_tables`                      | JSON `{table: reason}` of the tables halted now; null when none. Set by the run that halts a table, kept through skipped and failed runs, cleared per table only by a run that reads that table and copies it with no halt. Page someone |
| `enclave_full_diff`                  | 1 when the last run's rotating Enclave diff covered the whole table (under 1,000 rows); 0 when the table is larger and the diff rotates over several runs                                                                                |
| `change_mark`                        | Internal to the writers                                                                                                                                                                                                                  |

### data_version (the cache contract)

`data_version` is an integer that only rises. Every writer of served rows
(the copied tables, `labels`, `pools`, `epoch_totals`, `gauge_epoch`,
`lock_votes`, `daily`, `price_daily`) runs its writes in one D1 batch that
first sets `change_mark = total_changes()`, then the writes, then
`data_version = data_version + 1` only if any write changed a row. So:

- equal `data_version` means every served row is identical: a reader may
  key every scan answer (lists, aggregates, series) on it alone;
- a batch that changed nothing (an unchanged upsert counts no change)
  leaves it alone, and a rolled-back batch leaves it alone too;
- it moves in the same transaction as the rows, so a reader never sees the
  new version with old rows or the reverse.

Status, runs, cursors and quarantine writes never move it. `last_ok_at`
keeps its meaning (the last successful copy run) and is no longer a cache
key. The mark costs one row write per served batch (about 400 a day), and
each bump one more.
Migration `0003` adds the columns with defaults, so an older reader is
unaffected.

Backward compatible for readers: `scan_runs` keeps job `scan-copy` and
status `ok` for a run that copied (a `skipped` run is recorded with status
`skipped`, so a reader keyed on the newest `ok` row's `finished_at` sees no
change), `scan_cursors` keeps `copy:activity`, and `scan_dirty` keeps
(kind, key) with an added `generation`.

The deploy config does not bind `SCAN_DB` until the database exists, so
this Worker deploys and runs without it: every scan step logs "SCAN_DB not
bound" and skips. `src/wrangler-config.test.ts` fails on a placeholder or
all-zero D1 id, so a placeholder can never block a deploy again. To turn the
scan steps on (once, by a human):

0. Run the pre-turn-on checklist below; stop if any check fails.
1. Apply the READ_DB migrations first, before any jobs deploy:
   `pnpm exec wrangler d1 migrations apply matchbox-read-models --remote`
   (`0006_morpho_known_markets` for Morpho market discovery: without it a
   found market is still read but not stored, and the log scan repeats)
   (`0004_troves_status` and `0005_musd_price` are pending in production as
   of 10 Nov 2026). The live snapshot writes the MUSD price in its own
   statement, so a missing `0005` loses only the price (logged as `MUSD PRICE
NOT STORED`), but apply it before deploying anyway. `0004` is an index
   only: nothing fails without it, the API's open-troves list is just slower.
2. `pnpm exec wrangler d1 create matchbox-scan` and note the database_id.
3. Paste this into `d1_databases` in `apps/jobs/wrangler.jsonc` (and the
   same id on the API's `SCAN_DB` binding). This comes before the next step:
   `wrangler d1 migrations apply` finds the database and its
   `migrations_dir` through this binding.

   ```jsonc
   {
     "binding": "SCAN_DB",
     "database_name": "matchbox-scan",
     "database_id": "<the id wrangler d1 create printed>",
     "migrations_dir": "scan-migrations",
   }
   ```

4. From `apps/jobs`: `pnpm exec wrangler d1 migrations apply matchbox-scan
--remote` (applies `0001` to `0004`; `0003` adds `data_version` and the
   halt and failure columns, `0004` the unique `locks_owner_lock` index the
   API's owner-votes route uses when present).
5. Run the Neon first fill and apply its files (Scan history backfill,
   below) before the copy step first runs. The fill exits non-zero and
   writes nothing of a chunk that halts; fix the rows it names first.
6. Deploy (the API first, then this Worker). "The API" is env `v2preview`
   (`matchbox-api-v2-preview`), which this Worker's `API` binding names:
   `matchbox-developer-api` is still the Classic API at api.matchbox.markets
   and has no `InternalApi` entrypoint, so binding it would fail this deploy.
7. Over the first day, check the checklist's last item (Neon time) and
   that `scan_status` shows `halted_tables` null, `failed_runs_24h` 0,
   `refill_required` 0 and `data_version` rising.

Locally: `pnpm db:migrate:scan:local` (`wrangler.scan-local.jsonc`, a
Miniflare D1 that is never deployed).

D1 read replication must stay off on this database unless every reader and
writer uses the Sessions API: the copy reads its checkpoints and dirty
markers back right after writing them, which needs read-your-writes.

### Pre-turn-on checklist

Run these with the read-only Neon role and on a STAGING D1, never on
production D1. Each must give the stated answer.

1. Activity seconds that span blocks. The copy reads activity by whole
   seconds; this is how many seconds hold more than one block (any count
   is fine, but note it: the 300-second overlap re-read covers rows of
   such a second that commit late):

   ```sql
   SELECT count(*) FROM (SELECT timestamp FROM matchbox.activity_events
     WHERE network='mezo' GROUP BY 1 HAVING count(DISTINCT block_number)>1) s;
   ```

2. Rows the copy would quarantine: every field a Neon schema, the
   transform or the API's row schemas can reject (addresses, base-unit
   integers that must be whole, non-negative and at most 40 digits for
   their sort keys, and `extra` values, which must be strings or
   booleans). Each such row is quarantined; 50 of one table in one Worker
   run (500 in one first-fill chunk) halt that table. Expect 0 from each:

   ```sql
   -- activity_events
   SELECT count(*) FROM matchbox.activity_events e WHERE e.network='mezo' AND (
     e.amount<0 OR e.amount<>trunc(e.amount) OR length(e.amount::text)>40
     OR e.weight<0 OR e.weight<>trunc(e.weight) OR length(e.weight::text)>40
     OR e.token_id<0 OR e.token_id<>trunc(e.token_id)
     OR e.contract_address !~ '^0x[0-9a-fA-F]{40}$'
     OR e.tx_from !~ '^0x[0-9a-fA-F]{40}$'
     OR e.actor !~ '^0x[0-9a-fA-F]{40}$'
     OR e.recipient !~ '^0x[0-9a-fA-F]{40}$'
     OR e.token !~ '^0x[0-9a-fA-F]{40}$'
     OR e.gauge !~ '^0x[0-9a-fA-F]{40}$'
     OR e.pool !~ '^0x[0-9a-fA-F]{40}$'
     OR e.reward_contract !~ '^0x[0-9a-fA-F]{40}$'
     OR EXISTS (SELECT 1 FROM jsonb_each(jsonb_strip_nulls(jsonb_build_object(
          'boost_context', e.boost_context, 'metadata', e.metadata,
          'reward_type', e.reward_type, 'poke_method', e.poke_method))) kv
        WHERE jsonb_typeof(kv.value) NOT IN ('string', 'boolean')));
   -- reward_deposits (every address is required here)
   SELECT count(*) FROM matchbox.reward_deposits WHERE network='mezo' AND (
     tx_from IS NULL OR depositor IS NULL OR token IS NULL OR gauge IS NULL
     OR reward_contract IS NULL
     OR tx_from !~ '^0x[0-9a-fA-F]{40}$' OR depositor !~ '^0x[0-9a-fA-F]{40}$'
     OR token !~ '^0x[0-9a-fA-F]{40}$' OR gauge !~ '^0x[0-9a-fA-F]{40}$'
     OR reward_contract !~ '^0x[0-9a-fA-F]{40}$'
     OR pool !~ '^0x[0-9a-fA-F]{40}$'
     OR amount<0 OR amount<>trunc(amount) OR length(amount::text)>40);
   -- lock_positions
   SELECT count(*) FROM matchbox.lock_positions WHERE network='mezo' AND (
     amount<0 OR amount<>trunc(amount) OR length(amount::text)>40
     OR owner !~ '^0x[0-9a-fA-F]{40}$');
   ```

   If a query fails because a column has another name in production, the
   names to check are the ones the copy selects (`src/scan/neon.ts`).

3. The original reviewer's deposit check (kept for comparison). Expect 0:

   ```sql
   SELECT count(*) FROM matchbox.reward_deposits
     WHERE tx_from IS NULL OR depositor IS NULL;
   ```

4. Lock positions, for the first-fill estimate and the lock sweep's cycle
   (500 a run; at 96 runs a day every lock is re-read about every
   count / 2,000 hours):

   ```sql
   SELECT count(*) FROM matchbox.lock_positions WHERE network='mezo';
   ```

5. The quarantine batch at D1's limits, on STAGING: `pnpm exec tsx
scripts/scan-backfill/quarantine-batch-check.ts`, then apply the two
   files it writes to the staging database (`wrangler d1 execute <staging>
--remote --file ...`, insert then cleanup). 600 rows of 4 KB (far past a
   run's 50 rows a source of 1 KB) go in 29 statements of at most about
   90 KB. Expect both files to apply without a size error.
6. Confirm that a D1 `batch()` counts as one query toward the 1,000
   queries per invocation (Workers Paid), on Cloudflare's D1 limits page
   or with support, and note the answer here. The call budget below (216 per
   chained invocation, measured) counts each `batch()` once; if a batch
   counts per statement, stop and re-measure before turning on.
7. After turn-on, over one day: the `neon N ms` in each `scan_runs.detail`
   (`SELECT started_at, detail FROM scan_runs WHERE job='scan-copy'
ORDER BY started_at DESC LIMIT 96`)
   should stay under 1,000 ms; the budget below assumes 0.3 to 0.65 s.

## Scan copy step

`src/scan/copy.ts` copies Neon rows into `SCAN_DB` inside the warehouse
snapshot's invocation (chained from the indexer's tick, or the
`3,18,33,48` fallback), so it adds no wake window, trigger, Durable Object
or queue.

- **Skip.** The indexer passes its tick summary to `warehouseSnapshot`. The
  copy reads only the streams that advanced (`projection`: activity,
  deposits, troves, contracts; `borrow`: Morpho and Enclave). When neither
  did, it queries no Neon at all and records a `skipped` run, which still
  advances the aggregates unless a copy run is in progress. The cron
  fallback has no summary; it stays off Neon whenever a scan run (ok,
  skipped or still running) started in the last 10 minutes. A chained run
  is skipped too while another run started in the last 10 minutes is still
  `running`, so two invocations never copy at once; a run left `running`
  over 15 minutes (its invocation died) is marked `failed` by the next run
  and counted in `failed_runs_24h`.
- **Neon.** One READ ONLY, repeatable-read transaction (one HTTP round
  trip, up to 15 queries, plus 5 day counts once a day), started right
  after the Pro snapshot's last Neon query and before either step's D1
  work, so it extends Neon's awake time by its own duration only. The read
  is raced against a 10-second timeout: a hung read fails the scan run and
  never holds up the Pro snapshot. Each table is read past its own
  checkpoint in `scan_cursors`: activity by whole seconds (the indexed
  `activity_events_timestamp_idx`; a second is never split, since a
  vote and the abstain before it in one transaction must stay in order),
  the event tables by whole blocks, contracts by `(discovered_at,
address)`. Locks touched by the activity window are read by primary key
  (`escrow || '-' || token_id`).
- **Re-reads.** Some state changes behind a checkpoint or without an
  activity row, so it is re-read on its own schedule, and an unchanged row
  costs no writes: `enclave_events` by a rotating diff, 1,000 rows a run
  in key order (`copy:enclave-sweep`), so a table under 1,000 rows is
  diffed whole every run and a larger one every ceil(N / 1,000) runs: rows
  back-filled behind the checkpoint (a newly granted Enclave) are caught at
  any size, with no cliff. 500 lock positions a run in
  primary key order (every lock about every 3.5 hours; catches boost
  updates, which have no activity row), the contracts registered in the
  hour behind the checkpoint every run, and every contract once a day
  (pool and gauge links set later).
- **Overlap.** Rows can commit in Neon behind a checkpoint (a later block
  with an earlier or equal timestamp, a late-committing block). Every run
  also re-reads activity with `timestamp > checkpoint - 300` and the block
  tables' last 100 blocks behind their checkpoints (at most 1,000 rows
  each); already-copied rows cost no writes, a late row is inserted, and
  lock votes are rebuilt in (block, log) order, so an abstain and a vote
  in one transaction keep their order.
- **Count check.** Once a day per table (`verify:counts:<table>` in
  `scan_cursors`) the read adds per-day row counts of the last 7 days for
  activity, deposits, troves, Morpho and Enclave, but only for tables this
  run reads (their stream advanced). A table is compared only when the run
  read it to its end (not capped, not halted), so SCAN_DB holds every row
  Neon had at the read's snapshot, and only for complete UTC days. Neon's
  count must equal SCAN_DB's plus the rows quarantined for that day; any
  difference is noted (`verify:pending:<table>`, a JSON list of days) and
  sets `refill_required` only when the next daily check finds the same day
  short again; then the reason names the table and day, and the run logs
  `SCAN COUNT CHECK FAILED`. Only an operator's re-fill clears that flag,
  while a real loss never heals itself, so waiting a day costs one day of
  notice and avoids a flag for a difference that was gone by the next
  check. A table not read or capped is checked on a later run that day.
  Enclave is compared only on a run whose rotating diff read the whole
  table (under 1,000 rows); past that a row back-filled behind the
  checkpoint is copied when the sweep reaches it, so a count taken before
  then would differ with nothing lost, and the sweep does the repair.
- **Bounded.** Per run at most 2,000 activity rows and 1,000 of each other
  table (500 Enclave), always completing the last block or second. A gap
  catches up over several ticks.
- **Atomic and resumable.** The copied rows, lock votes, dirty markers,
  quarantined rows and new checkpoints commit in one D1 batch. A failure
  before that batch leaves every checkpoint where it was (`failed`,
  "checkpoints unchanged"); the next run reads the same rows. A failure
  after it (the count check, the aggregates, recording the run) leaves the
  run `ok` with the error in `last_error` and the run's detail: the copy
  stands, and dirty markers are retried next run.
  Checkpoints only move forward: a cursor upsert with an older value
  writes nothing, so a slow run can never move one back.
- **Repairing.** Every upsert rewrites a row whose copied values differ and
  writes nothing otherwise, so re-reading or re-filling rows repairs them.
- **Quarantine.** Three gates, each per row, never failing the run: the
  Neon row's own schema (a NULL where a value is required, an amount
  printed `12.0`), the transform (an amount too long for its sort key,
  malformed JSON), and the API's row schemas in `@matchbox/contracts/scan`
  (so no stored row can fail an API list). A failed row goes to
  `scan_quarantine` keyed by its primary key, with its UTC day and its
  payload cut to 1,000 characters, and its table's checkpoint moves past
  it. At most 50 rows a table a run are recorded (chunked like every
  upsert); a table reaching 50 is a systematic failure: it is **halted**
  (writes nothing, keeps its checkpoint and its rotating sweep cursor, the
  run logs `SCAN COPY HALTED`) until a fix, while the other tables go on.
  The halt is kept as `halt:<table>` in `scan_cursors` and shown in
  `halted_tables` until a run reads that table and copies it cleanly; a
  halted table is read on every run, its stream advanced or not, so a fix
  in the warehouse clears it on the next tick. `last_ok_at` does not move
  while any table is halted. A halted daily full contracts re-read is not
  marked done, so it is repeated. A bad row read twice in one run (the
  Enclave window and its diff) counts once toward the halt. A halted lock
  position halts activity (they are written together).
  Unknown enum values (a new reward type) pass through as strings.
- **Lock votes.** Built from vote and abstain rows in (block, log) order.
  Before the first event of a new epoch (or once the copy has read past the
  epoch start), every vote of the previous epoch is carried forward; then
  the epoch's last event per (gauge, lock) decides.
- **Aggregates.** `epoch_totals`, `gauge_epoch` and the copy-derived
  `daily` metrics are recomputed from `SCAN_DB` for the epochs and days in
  `scan_dirty`: the current epoch and day first, then newest first, within
  200 D1 calls a run, on skipped runs too. A marker is cleared only if its
  generation did not change meanwhile (another run re-marked it). Killed
  gauges (GaugeKilled until GaugeRevived, as of the epoch's end) are
  unranked and never the top gauge; their weight stays in `vote_weight`, as
  the voters keep it in `totalWeight`, and is also in `killed_weight`.
- **Logs and runs.** `Scan copy written` or `Scan copy skipped`, one
  `scan_runs` row per run (kept a week) and the status row.

### Re-fill runbook

The copy follows rows appended in block order. These indexer events add or
change rows behind its checkpoints, so the scan tables need a re-fill:

| Indexer event                                                                                   | What to run                                                                                   |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `rebuild:history -- --replay` (projection truncated and rebuilt, new `DECODER_VERSION`)         | `neon-first-fill.ts --fresh --replace --write`; apply every file. `refill_required` flags it. |
| `backfill:borrow -- --replay` (borrow tables deleted and rebuilt, new `BORROW_DECODER_VERSION`) | the same                                                                                      |
| `rebuild:history --from N` below the copy's checkpoints (trove history below block 5,000,000)   | `neon-first-fill.ts --fresh --write` (no `--replace`): new rows are inserted, others repaired |
| A widened contract or topic set and its re-backfill                                             | the same                                                                                      |
| The re-read of the 57 locks created before block 7.74M                                          | the same (the lock sweep alone repairs lock_positions within hours)                           |
| A newly granted Enclave (earlier logs back-filled), a boost update                              | nothing: the Enclave diff and the lock sweep pick them up                                     |

Deletes: the warehouse deletes projected rows only in a replay
(`resetProjection` truncates the projection; the borrow replay deletes its
tables). The copy never deletes, so after a replay `--replace` empties the
copied tables, their checkpoints and the re-fill flag before the first
chunk; readers see the tables refill over the files' application.

### Budget

At today's chain (about 1,000 transactions and 1,500 activity rows a day,
96 indexer ticks):

| Per tick                        | Estimate                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extra Neon awake time           | the scan round trip alone, about 0.3 to 0.65 s: 0.3 to 0.6 s before, plus 10 to 50 ms for the four overlap re-reads (a few rows each, in the same round trip); once a day 50 to 200 ms more for the 7-day counts; none on a skipped tick. Not yet measured on Neon |
| Neon CU-hours a month           | 2,880 ticks x 0.65 s x 0.25 CU, about 0.13; the cron fallback no longer reads Neon after a chained run                                                                                                                                                             |
| D1 calls per chained invocation | measured in a backlog: Pro snapshot 73 (about 100 at 150 swept wallets) plus scan 216 (215 measured on a run with the daily count check, plus the halt-marker read; about 206 on other runs), of 1,000 allowed, counting each `batch()` once                       |
| D1 row writes (copy)            | an activity row writes the table, its TEXT primary key index and up to 9 secondary indexes: about 160 a tick; overlap rows already copied write nothing                                                                                                            |
| D1 row writes (aggregates)      | about 80: the current epoch's changed gauge rows and today's changed `daily` rows                                                                                                                                                                                  |
| D1 row writes (data_version)    | one `change_mark` write per served batch, and one bump when it changed something: about 400 batches a day (96 copies, up to 200 aggregate keys, 49 closes, 25 price closes, a few daily reads), so up to about 800 a day                                           |

Per day that is about 31,000 row writes in all: about 15,000 for activity,
6,000 for `daily` rollups, 2,000 for epoch aggregates, 1,300 for lock votes
(9,000 once a week when votes carry into a new epoch), 1,500 for runs,
status and cursors, 800 for `data_version`, 3,000 for closing values and
200 for prices and the once-a-day reads. Quarantine writes are 0 normally
and at most 50 rows a table a run. Workers Paid includes 50 million a
month.

Some Neon reads are sequential scans: the block windows on
`reward_deposits`, `trove_updates`, `morpho_events` and `enclave_events`
have no `(network, block_number)` index. They are small today (a few
thousand rows, a few milliseconds each); the indexer should add those
indexes before they grow (the request is in the review report).

The existing Pro snapshot still ignores the summary. It could skip its
Neon reads on a tick where nothing advanced only by also skipping the
rotating wallet sweep, whose rebuilds pick up voting power that decays
without any event; that changes Pro's freshness, so it is left as is.

## Scan daily series

`daily` is the single home for every time series; the registry in
`series.ts` lists every metric. Besides the copy step's rollups it has
these writers, all on existing triggers. Rows of a day that is not over (or
not yet fully copied) have `partial = 1`.

- **Closing values** (`src/scan/closing.ts`), after the 5-minute live
  snapshot, on the :00 and :30 runs and the day's last run (23:55): pool
  token balances for every basic and CL pool in `pools` (`balanceOf` in one
  multicall), `token.total_supply` for BTC, MEZO, MUSD, mUSDC, mUSDT and
  the BTC wrappers, trove debt and collateral, the Stability Pool, Morpho
  market totals and the escrow supplies (the last four read back from what
  the live snapshot just wrote to `READ_DB`). All or nothing: a run whose
  live snapshot failed, or whose chain reads came back incomplete, writes
  no row, so a day's rows are always one consistent set. The chain reads
  are made at the live snapshot's block, and the run that supplied a
  day's close is recorded as `close:<day>` = `HH:MM block N` in
  `scan_cursors`. About 3,000 row writes a day.
- **Closing prices** (`price_daily`), after the minute price job, at minute
  :59 of each hour and at 00:00 for the day that just ended: about 50 row
  writes a day.
- **Once a day** (`src/scan/once-daily.ts`), from the live trigger, each
  source with its own marker in `scan_cursors`, set only when its reads
  succeeded (a failed source is retried after 30 minutes):
  - `daily:counters`: yesterday's closing Blockscout counters (total
    transactions and addresses; holders and transfers for the eight
    tracked tokens) through the API's proxy, in the first three hours of
    the UTC day only, stored as yesterday's close; `counters:<day>` in
    `scan_cursors` records when they were actually read (up to three hours
    into the next day). Levels only: no day-over-day differences.
  - `daily:validators`: blocks proposed per validator. In the same
    window, one read of recent blocks a day adds their miners to a seen
    set (`daily:validators:seen`); with the labels of kind `validator`
    that is the validator list (21 today). Each validator's Blockscout
    `validations_count` (every block it has proposed) is read once a day
    and stored as yesterday's close, `chain.blocks_proposed_total`; the
    day's `chain.blocks_proposed` is that minus the day before's read.
    A failed read is retried after 30 minutes for the missing validators
    only. No difference is written for a first read, a missed day (the
    gap covers several days whose split is unknown, and spreading it
    would invent a smooth series and hide the very downtime the series
    shows; both totals stay, so a reader can take the multi-day sum) or a
    counter that went down (a Blockscout re-index): those days have no
    row, never a spike or a negative. Accuracy: a day's edges are those
    of the reads, anywhere from 00:00 to 03:00 UTC (and up to about ten
    minutes older through the API's cached counters), so a day can gain or
    lose up to three hours of blocks to its neighbours; the totals over
    several days are exact. The series is only as right as Blockscout's
    count of blocks by miner. The same recent-blocks read gives the
    newest block height (`chain.block_height`, a level), that block's
    unix time (`chain.block_height_time`, since 14 Nov 2026; Matchscan's
    block time divides the blocks between two reads by the real seconds
    between their head blocks, never by a 24-hour day) and the day's
    `chain.blocks`, the height minus the day before's, by the same gap
    rules: the denominator for each validator's share, which also counts
    blocks of validators the list does not know. 22 Blockscout reads a day, nothing per page
    view.
  - `daily:chart`: `chain.transactions` from Blockscout's exact 30-day
    chart, every day of it rewritten where it changed, so a missed day is
    filled by the next run; the marker moves once the chart has yesterday.
  - `daily:dex`, `daily:fees`, `daily:bridge-in`, `daily:bridge-out`: Mezo's
    subgraphs (DEX volume and fees per pool, veBTC fees and the MEZO rebase,
    bridge flows), every day after the marker the subgraph has indexed to
    the end of (`_meta.block.timestamp`), up to 14 a run; a lagging
    subgraph is waited for, never recorded short. A list that comes back
    full (1,000 rows, the page limit) may continue on a page never read,
    so days are accepted only up to the day before its last row's day. The DEX read also fills
    `pools` with the basic and CL pools.

- **Market rollups** (`src/scan/market-rollups.ts`, since 15 Nov 2026):
  `pool.token_balance` is `pool.balance` summed over every pool per token,
  written by the closing values from the same reads, and
  `dex.token_volume_in` is `dex.volume_in` summed per token, written with
  the earn-pools subgraph's days. A chart of every pool together (Network's
  TVL and DEX volume, MUSD in DEX pools) then reads about ten token rows a
  day instead of two rows per pool (96 a day). Amounts stay base units,
  priced at read time. At most about 10 more rows per closing run and 10
  per subgraph day, written only when changed: under 1,000 row writes a
  day with their index.
- **MUSD borrowed and repaid** (copy step, `troveDebtFlow` in
  `src/scan/aggregates.ts`): each trove event's `debt_change` as
  `musd.borrowed` (a borrower's increase: opened, borrowed more,
  refinanced; borrowing fees and an opened loan's 200 MUSD gas
  compensation included), `musd.repaid` (a borrower's decrease:
  repayments, closed loans, the gas compensation burned on close
  included), `musd.redeemed` and `musd.liquidated` (the TroveManager's
  redemptions and liquidations; a liquidation is the trove's recorded
  debt, without its pending redistribution gains, whether the Stability
  Pool absorbed it or it was redistributed to other troves). Redistributed
  debt (pending rewards) and events with no known change are in
  `musd.debt_change` only. A day with no such event has no row (zero).
  Up to four rows a day.

Level series (holders, totals, balances) have a row only for days
their source was read; a missing day is unknown, not zero. Carrying the
last value forward is the reader's job (`scanLevelGaps` and
`scanMetricNotes` in `series.ts`).

A row from a backfill (`source` `backfill:...`) never replaces one a live
writer wrote, on `daily` and `price_daily`; a live row replaces a
backfilled one. The `API` binding needs the API Worker and its
`InternalApi` entrypoint deployed first; without it the Blockscout reads
are skipped and logged.

## Scan history backfill

One-time local scripts in `scripts/scan-backfill/` fill `SCAN_DB` before
launch; after that each day adds its rows from the writers above. Every
script is a dry run unless `--write` is passed, keeps its progress in
`scripts/scan-backfill/out/<script>/state.json` (gitignored) so an
interrupted run resumes (`--fresh` starts over), stops after
`--max-requests` (default 50, a sample), paces itself under its source's
rate limit, and with `--write` emits SQL files. Nothing writes to a
database: a human applies the files.

```sh
cd apps/jobs
# (a) first fill from Neon, with the read-only role only
DATABASE_URL=postgresql://matchbox_api_ro:...@.../neondb \
  pnpm exec tsx scripts/scan-backfill/neon-first-fill.ts --max-requests 100 --write
# (b) to (e)
pnpm exec tsx scripts/scan-backfill/blockscout-transactions.ts --max-requests 23500 --write
pnpm exec tsx scripts/scan-backfill/subgraphs.ts --series dex --max-requests 50 --write  # also fees, musd (--verify), bridge-in, bridge-out
pnpm exec tsx scripts/scan-backfill/erc20-logs.ts --max-requests 5000 --write
pnpm exec tsx scripts/scan-backfill/archive-reads.ts --from 2025-05-01 --max-requests 6000 --write
# (f) to (h): dry run first; --compare reads the target's present rows
# (one SELECT through wrangler, read only; CLOUDFLARE_ACCOUNT_ID picks the
# Mallard Labs account when the login has several)
pnpm exec tsx scripts/scan-backfill/daily-history.ts --from 2025-05-19 --max-requests 15000 --compare matchbox-scan --fresh
pnpm exec tsx scripts/scan-backfill/daily-history.ts --from 2025-05-19 --max-requests 15000 --write
pnpm exec tsx scripts/scan-backfill/price-history.ts --from 2025-05-19 --max-requests 15000 --compare matchbox-scan
pnpm exec tsx scripts/scan-backfill/price-history.ts --from 2025-05-19 --max-requests 15000 --write
pnpm exec tsx scripts/scan-backfill/gauge-epochs.ts --max-requests 6000 --compare matchbox-api-market-v2
pnpm exec tsx scripts/scan-backfill/gauge-epochs.ts --max-requests 6000 --write
# apply, in file order
for f in scripts/scan-backfill/out/neon/*.sql; do
  pnpm exec wrangler d1 execute matchbox-scan --remote --file "$f"
done
# the other scripts' files likewise, e.g. out/daily-history/*.sql and
# out/price-history/*.sql into matchbox-scan. gauge-epochs writes
# MARKET_DB, not SCAN_DB: apply out/gauge-epochs/*.sql to
# matchbox-api-market-v2 (the v2 API, which Matchbox Pro reads) and, if
# wanted, to matchbox-api-market (the live API); see (h) below.
```

Apply the Neon files before the Worker's copy step first runs: each chunk
ends with its checkpoints, so the copy continues where the fill stopped.
The fill marks every epoch and day dirty, and the copy step then computes
`epoch_totals`, `gauge_epoch` and the copy-derived `daily` rows within its
D1 budget, current epoch and day first (about 600 keys, a few hours; the
status row's `aggregates_complete` says when). The other scripts write
`daily` and `price_daily` only and can be applied at any time: a
backfilled row never replaces a row a live writer wrote (the upsert's
source guard), and a live writer later replaces a backfilled day.

`daily-history.ts` (f), `price-history.ts` (g) and `gauge-epochs.ts` (h)
are stricter: they only insert rows that are absent
(`ON CONFLICT DO NOTHING`), so they never change a row, live or
backfilled, and applying a file twice changes nothing. The (f) and (g)
files are each one `servedBatch`, so they bump `scan_status.data_version`
(which the API's series and borrow-totals caches are keyed on) only when
they inserted a row.
It reads each day at the block the live writer's last closing run reads
(the head at 23:55:00 UTC, `lastClosingMinute` in `src/scan/closing.ts`),
with the live snapshot's own readers (`src/live/`), and turns the reads
into points with the closing writer's own `readModelPointsOf`, so a
backfilled close is computed as a live one. The cron's start latency can
make a live run read a block or two later than 23:55:00.

What (f) writes, since 12 Nov 2026: besides `escrow.supply`,
`musd.trove_debt` and `morpho.total_borrow` (already applied on 11 Nov),
`morpho.total_supply` and `morpho.total_collateral` per market,
`musd.trove_coll`, `musd.stability_pool`, and `token.total_supply` for the
closing writer's 8 tokens (`supplyTokens`), read with
`createClosingChainReader` at the same block. `morpho.total_collateral`
sums `position(id, account).collateral` over the accounts the live
snapshot knows, which (f) finds with the same log scan
(`discoverMorphoAccounts`: every Supply, Borrow and SupplyCollateral
`onBehalf`; 17 accounts on 12 Nov 2026), one window at a time so an
account is only read from its first window on. A token whose
`totalSupply()` read fails after it had a supply on an earlier day fails
the day (retried); one with no earlier supply is not deployed yet. State
from before this change is refused: run once with `--fresh` (re-reading
the old series is harmless, the SQL skips their present rows). The
comparison on 12 Nov 2026 (9 to 11 Nov, `--compare matchbox-scan`): on 11
Nov, the one day both hold, every new series equals the live row exactly;
`musd.trove_debt` differs by interest accrued between the 23:55:00 block
and the block the live run read.

`price-history.ts` (g) writes `price_daily` for `btc` and `mezo` (source
`backfill:price-history`). The live job's last write of a day's close is
its 00:00 UTC run with the newest price (`runPriceClose`), so (g) reads
the head at 00:00:00 of the next day: BTC from the Skip oracle's
`latestRoundData` on Mezo, MEZO from the Aerodrome MEZO/MUSD pool's
`slot0` at Base's last block before that time, with the live reader's own
checks (`prices-at.ts`; the oracle's staleness is measured from the
block's time). A refused answer (stale round, no liquidity) is no price
that day, as live; a failed read of a source that answered before fails
the day. The pool was created on Base on 14 Apr 2026 (block 44,668,825),
so MEZO starts that day. The comparison on 12 Nov 2026: 11 Nov equals the
live close exactly for both tokens (BTC 73928.52896, MEZO
0.003974015656739017).

`gauge-epochs.ts` (h) fills `market_epochs` and `market_gauges` in
`MARKET_DB`, the store behind `listGaugeHistory`: Matchbox Pro's gauge
profile asks for 12 epochs, and on 12 Nov 2026 `matchbox-api-market-v2`
held two (5 and 12 Nov) and `matchbox-api-market` four (22 Oct to 12
Nov). The rows are chain reads, so (h) makes them as the market cron's
last run with each finished epoch as the current one did: the cron's own
`createMarketReader` (all four voters, every gauge's weight and reward
slots) at the last block at or before 23:55:00 UTC of the epoch's last
day, turned into rows by its own `buildSnapshot` and hashed by
`storedGaugeHash`, with the reference prices of that moment as in (g).
That reproduces the stored rows exactly, where a replay of the
warehouse's votes and deposits would only approximate them: against the
three finished epochs `matchbox-api-market` holds (22 Oct, 29 Oct, 5 Nov),
all 2,345 gauges' weights and rewards were equal. The SQL inserts into an
epoch only while it has no `market_epochs` row, and the header goes last,
so an epoch the cron wrote is never touched and a file cut short is
finished by applying it again. Epochs before 14 Apr 2026 have no MEZO
price (`prices.mezoUsd` null, so no USD or APR for MEZO-priced rewards and
veMEZO gauges), as the cron stores a missing price. The full run reads 39
epochs (12 Feb to 5 Nov 2026), about 100 requests and 13 s each: 23,055
rows, of which 22,273 (38 epochs) are absent from
`matchbox-api-market-v2` and 20,710 (36 epochs) from
`matchbox-api-market`.

```sh
cd apps/jobs
for f in scripts/scan-backfill/out/gauge-epochs/*.sql; do
  pnpm exec wrangler d1 execute matchbox-api-market-v2 --remote --file "$f"
done
```

A re-fill (`--fresh`, "Re-fill runbook") applied while the copy is running,
from the code (`scripts/scan-backfill/first-fill.ts`, `src/scan/copy.ts`
`planCopy`, `src/scan/aggregates.ts`):

- **Every day and epoch is marked dirty.** `--fresh` reads every row from
  checkpoint 0, and each chunk marks the epoch and day of every row it
  writes (`dirtyStatement`; re-marking a key bumps its generation, so an
  aggregate the copy computes meanwhile does not clear it). Each copy run
  then recomputes dirty keys within its D1 query budget, current epoch and
  day first, so all of `epoch_totals`, `gauge_epoch` and the copy-derived
  `daily` rows recompute over the following runs (about 600 keys, a few
  hours). `aggregates_complete` in the status row says when.
- **Checkpoints never go back.** Every copy checkpoint is written with
  `monotonicCursorStatement` (only a larger value replaces it), so the
  fill's chunks cannot move the copy's back; only `--replace` deletes them.
- **Rows the copy already has are untouched.** The upserts write only rows
  that differ, so the missing ones are inserted and the rest stay.
- **A row changed in Neon after the fill read it is set back** to the
  fill's version: the upserts have no newer-wins guard. That matters for
  lock positions, which the fill writes in full; a stale one stays until
  the lock sweep or the lock's next activity re-reads it. Apply the files
  soon after the fill.

| Script                                           | Source                                                                         | Writes                                                                                                                                                                                                              | Sample (9 and 10 Nov 2026)                                                                                                   | Full run                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `neon-first-fill.ts` (a)                         | Neon `matchbox.*`, READ ONLY, `DATABASE_URL`                                   | every copied table, checkpoints, dirty markers; `--replace` empties them first                                                                                                                                      | run against Neon on 10 and 11 Nov 2026: 49 files, applied in about 3 minutes with the copy running; counts then matched Neon | about 150k rows, 10 to 20 chunks of one round trip each, under a minute of Neon time            |
| `blockscout-transactions.ts` (b)                 | Blockscout `/api/v2/transactions`, 300 requests a window, `BLOCKSCOUT_API_KEY` | `chain.transactions`, `chain.active_addresses`; `chain.new_addresses`, `chain.addresses_cumulative` once complete                                                                                                   | 200 pages, 10,000 transactions back to 30 Oct, 3.8 requests/s, e.g. 9 Nov: 967 tx, 157 active                                | about 23,000 pages, about 100 minutes                                                           |
| `subgraphs.ts --series dex`                      | `earn-pools-mezo/v1` daily aggregations                                        | `dex.volume_in`, `dex.fees` per pool:token, basic and CL                                                                                                                                                            | complete: 4 requests, 9,373 rows, 492 days from 28 May 2025                                                                  | the sample is the full run                                                                      |
| `subgraphs.ts --series fees`                     | `earn-locks-mezo/v2` DistributedRewards                                        | `fees.chain_vebtc`, `emissions.rebase_distributed`                                                                                                                                                                  | complete: 1 request, 80 weekly rows from 11 Dec 2025                                                                         | the sample is the full run                                                                      |
| `subgraphs.ts --series musd`                     | `wormhole-token-bridge-mezo/v1` Transfers                                      | `token.transfers`, `token.transfer_volume`, `token.minted`, `token.burned`, `token.holders_replayed`                                                                                                                | `--verify`, 26 requests, 24,945 transfers: replayed supply equals `totalSupply()` at block 1,946,045                         | about 490k transfers, 490 requests, 9 minutes                                                   |
| `subgraphs.ts --series btc`                      | `btc-as-erc20-mezo/v1` Transfers                                               | nothing: BTC is the gas token, its Transfer replay cannot give holders, supply or transfers                                                                                                                         | 6 requests, about 6,000 transfers read, nothing written                                                                      | not worth running                                                                               |
| `subgraphs.ts --series bridge-in` / `bridge-out` | `mezo-bridge-mainnet/v1` (Ethereum), `mezo-bridge-out-mezo/v1`                 | `bridge.in` per Ethereum token, `bridge.out` per token and destination, and counts                                                                                                                                  | 6 requests each: 5,504 deposits to 25 May 2025; 5,995 withdrawals to 8 Apr 2026                                              | tens of requests each, a few minutes                                                            |
| `erc20-logs.ts` (d)                              | `eth_getLogs` Transfer on MEZO, mUSDC, mUSDT, mSolvBTC, mcbBTC, mbhBTC         | `token.transfers`, `token.transfer_volume` only (see below)                                                                                                                                                         | 23 windows (blocks 12.9M to head), 4,851 logs, 1.9 requests/s; `--verify` from block 0 failed for MEZO and mUSDC (see below) | about 1,313 windows, about 4,500 requests, about 40 minutes                                     |
| `archive-reads.ts` (e)                           | Mezo archive state (every listed RPC serves it), Base for MEZO                 | `pool.balance` (48 basic and CL pools), `token.total_supply` (8 tokens); `price_daily` btc and mezo                                                                                                                 | 1 to 7 Oct 2026: 8 requests a day; e.g. 7 Oct BTC 83278.27, MEZO 0.0057                                                      | about 560 days, about 4,500 requests, about 15 minutes                                          |
| `daily-history.ts` (f)                           | Mezo archive state at the 23:55 UTC closing block; Morpho logs                 | `escrow.supply`, `musd.trove_debt`, `musd.trove_coll`, `musd.stability_pool`, `morpho.total_supply`, `morpho.total_borrow`, `morpho.total_collateral` per market, `token.total_supply` (8 tokens), insert-if-absent | 9 to 11 Nov 2026: 3 days, 430 requests with the one-time log scan (17 accounts, 3 markets); 11 Nov equals every live row     | 541 days from 19 May 2025 to 10 Nov 2026; first run of 11 Nov: 3,650 requests, about 10 minutes |
| `price-history.ts` (g)                           | Skip oracle on Mezo, Aerodrome MEZO/MUSD on Base, at 00:00 UTC                 | `price_daily` btc and mezo, insert-if-absent                                                                                                                                                                        | 9 to 11 Nov 2026: 3 days, 347 requests (first block search from 0); 11 Nov equals both live closes                           | BTC 541 days from 19 May 2025, MEZO 211 days from 14 Apr 2026                                   |
| `gauge-epochs.ts` (h)                            | Mezo archive state at each epoch's last 23:55 run; prices as (g)               | `MARKET_DB` `market_epochs` and `market_gauges`, epochs without a header only                                                                                                                                       | 22 Oct to 5 Nov 2026: 3 epochs, 323 requests, 2,345 gauges equal to the stored rows                                          | 39 epochs from 12 Feb 2026, 3,595 requests, about 8 minutes                                     |

`market-rollups.ts` (batch 2, 15 Nov 2026) needs no outside source: it
reads the `pool.balance` and `dex.volume_in` rows the database already
holds (SELECTs through wrangler, read only, one month a query), sums them
per token per day with the live writers' own function, and with `--write`
emits insert-if-absent SQL for every day before today (source
`backfill:market-rollups`) plus `troves-dirty.sql`, which marks every day
with a trove event dirty so the copy step's aggregates write
`musd.borrowed`, `repaid`, `redeemed` and `liquidated` for it, about 28
days a run, current day first, then newest first. Each rollups file holds
whole days and is its own served batch: `wrangler d1 execute --file` runs
each file in its own session, and the `data_version` bump compares
`total_changes()` within one, so every file that inserted a row moves it.
A day whose stored `pool.balance` rows miss a pool-token that the days
before and after both have (an `archive-reads.ts` read that failed; it
lets single reads fail) gets no `pool.token_balance`; the script lists
those days, and re-running `archive-reads.ts` for them and then this
script fills them. Run it after `archive-reads.ts` and
`subgraphs.ts --series dex` were applied, dry run first:

```sh
cd apps/jobs
pnpm exec tsx scripts/scan-backfill/market-rollups.ts --source matchbox-scan
pnpm exec tsx scripts/scan-backfill/market-rollups.ts --source matchbox-scan --write
for f in scripts/scan-backfill/out/market-rollups/*.sql; do
  pnpm exec wrangler d1 execute matchbox-scan --remote --file "$f"
done
```

Expected size: about 560 days of `pool.token_balance` (about 10 tokens a
day) and 490 of `dex.token_volume_in`, about 10,000 rows inserted once,
about 20,000 row writes with the day index. The files hold about 2,500
rows each: with the warehouse's 45,000 and the scan's 31,000 a day, apply
at most two files a day. The trove days then cost up to four rows each
as the aggregates reach them. While they do, Matchscan's MUSD page says
"Borrowed since 12 Nov" (the first day the four series hold) instead of
"Borrowed 30d" until the history reaches 30 days back, one or two runs
after `troves-dirty.sql` is applied; the days still to recompute are
partial in `/series` for these copy-step metrics only (`scanMetricRecomputed`),
so the rollups, closes and Network's DEX figures stay whole meanwhile.
Network reads days more than three days old through `/internal/scan/markets`
under a cache key that changes once a UTC day, so rows a file adds to those
days (or a later `archive-reads.ts` or price backfill) show on Network from
the next UTC day; the series routes and the MUSD and pool pages show them on
their next read.
Until the rollups backfill is applied, Network's TVL history and the pool
pages' share of DEX start at the jobs deploy (no earlier day is drawn as
zero). Re-running `subgraphs.ts --series dex` also writes
`dex.token_volume_in` (the subgraph points include it), so either source
fills it; neither replaces a present row.

`--verify` (subgraphs `musd`, erc20-logs from block 0) compares the
replayed supply with `totalSupply()` at the last fully read block and stops
on a mismatch. Its first runs: MUSD matched; MEZO (a precompile) replayed 0
against a 1,000,000,000 genesis supply with no Transfer, and mUSDC first
held supply at block 402,234 with no log of any kind from the contract, so
Mezo's bridge mints these tokens without events. Replayed supply is
therefore never published, and replayed holders only for MUSD.

Series these sources cannot produce:

- **Bridge fees.** No bridge contract emits a fee (MezoBridge, the
  AssetsBridgeCaller precompile, the token contracts). The only fee-like
  signal is tBTC's minting fee, `initialAmount - tbtcAmount` in
  `BTCDepositFinalized` on Ethereum, which the subgraph does not expose
  per deposit.
- **MEZO price before the Base pool existed.** The price job's MEZO source
  is the Aerodrome MEZO/MUSD pool on Base, created on 14 Apr 2026 (Base
  block 44,668,825), so earlier days have no MEZO price from that source.
- **Token holder counts and `chain.addresses_total` before 10 Nov 2026.**
  Blockscout serves these only as today's figure (`/api/v2/stats`
  `total_addresses`, `/api/v2/tokens/{token}/counters`); Mezo's explorer
  runs no stats service (no `/stats-service`, no `STATS_API_HOST` in its
  config), and its only chart is the 30-day transaction count. Their
  history starts with the first live day. `token.holders_replayed`
  (subgraphs `musd`) is a different series, from the MUSD transfer replay.
- **Gauge epochs before 12 Feb 2026** (`gauge-epochs.ts`). From 25 Dec 2025
  to 5 Feb 2026 every Mezo RPC (rpc-internal, ValidationCloud, Boar)
  answers the ValidatorPool precompile's `validator(operator)` with
  "Missing or invalid parameters" at those blocks, which fails the cron's
  read; before that the four voters are not all deployed. Filling those
  seven epochs would need a reader that skips the validator voter's
  operator details, or the warehouse's votes and deposits, which do not
  give the stored rows' gauge fields.
- **Replayed holders, mints and burns for BTC, MEZO and the bridged
  tokens**: their supply moves without Transfer events (above). Their
  holders are Blockscout's `token.holders` from the first live day.
- **Daily active and new addresses after the backfill** (backfill-only
  series that end on their last backfilled day): no live writer reads a
  day's transactions. Live, `chain.addresses_total` is Blockscout's own
  level, never spliced with the backfill's first-seen counts. A live
  `chain.active_addresses` writer is not a small change: it is the distinct
  `from`, `to` and created-contract addresses of all of a day's
  transactions, which no counter or chart gives, so the once-daily step
  would page yesterday's transactions from Blockscout
  (`/api/v2/transactions?filter=validated`, 50 a page, newest first,
  through the API's `/internal/blockscout` proxy, which allows that path):
  about 20 to 35 pages a day now (760 to 1,722 transactions), growing with
  the chain. That needs its own `daily:active` marker, a keyset cursor and
  the day's partial address set carried across 5-minute runs in
  `scan_cursors` (a run's subrequests are shared with the live snapshot),
  and a check that paging reached the day's first transaction before the
  row is written. Until then the series ends where
  `blockscout-transactions.ts` (b) ends, and that script has not been
  applied yet (no `chain.active_addresses` rows on 12 Nov 2026).
- **Transfer counts and volume after the backfill** for MEZO, mUSDC,
  mUSDT and the wrappers need the indexer to ingest their Transfer logs
  (the request is in the review report).
- **Read-model closes before 19 May 2025** (`daily-history.ts`): the live
  readers batch through Multicall3, which Mezo did not have before then.
  On 19 May 2025 no trove was open and neither escrow nor Morpho Blue was
  deployed, so its series start later anyway (`musd.trove_debt` 22 May
  2025, veBTC 2 Dec 2025, veMEZO 8 Dec 2025, Morpho 25 May 2026).
- **MUSD fees by type and early veBTC locks** need indexer changes (a
  re-ingest of the fee events; a re-read of the 57 locks created before
  the warehouse's start block).

## Governance summaries

Matchscan's governance panels (`scan-migrations/0007_governance.sql`, read
by the API's governance routes, apps/api README "Governance"). Both steps
ride the 5-minute live trigger after the once-a-day reads, read no Neon,
and log `GOVERNANCE TABLES MISSING` and skip until the migration is
applied.

| Table               | Step                                   | Holds                                                                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gauge_emissions`   | `src/scan/governance.ts`, every run    | MEZO each voter distributed to each gauge per epoch: the voters' `DistributeReward` rows of `activity` (source `POOLS_VOTER`, `VALIDATORS_VOTER`, `BOOST_VOTER`, `THIRD_PARTY_VOTER`), summed; a pool gauge's own `ClaimRewards` (source `GAUGE`) is an LP claim and is left out |
| `epoch_sources`     | same                                   | Each voter's epoch: those emissions, and the incentives, fees, vote weight and gauge count of its `gauge_epoch` rows                                                                                                                                                             |
| `lock_distribution` | `src/scan/lock-distribution.ts`, daily | One document per escrow per UTC day: every lock id's `locked()` and the live ones' `votingPowerOfNFT()` at one block (`scanLockDistributionSchema`)                                                                                                                              |

- **Epochs.** A distribution belongs to the epoch it happened in (it pays
  the gauge for the votes of the epoch before, streamed over this one).
  Each run recomputes the current and the previous epoch and three older
  ones in rotation (`governance:sweep` in `scan_cursors`, wrapping at
  Epoch 0), so the first fill of every epoch takes about 85 minutes with
  no script, and a re-filled epoch heals within about 85 minutes too.
  Reads: the oldest `REWARD_DISTRIBUTED` row (one row of
  `activity_action`) and two indexed ranges per epoch (`activity_action`,
  a prefix of `gauge_epoch_rank`); writes only rows that changed, every
  epoch and the sweep cursor in one served batch per run (`data_version`
  moves at most once, only on a change). The warehouse's
  `DistributeReward` history starts on 9 Apr 2026: epochs before it, and
  the one it starts in (partial), have no gauge emission rows and
  `emissions` NULL in `epoch_sources` (unknown, never 0); incentives and
  fees go back to Epoch 0.
- **Lock distribution.** Once a UTC day (marker `daily:locks`, today's
  date), on the first live run whose head block is from that day and
  under an hour old: a run before the chain passes midnight, or while it
  is halted, costs one head read and writes nothing. A failed read is
  retried after 30 minutes, then 1, 2 and 4 hours, then every 6 hours
  (`daily:locks:attempt`, `<time>:<failures>`, cleared by a read that
  works; logged as an error from the third failure). Matchscan's lock
  panels say "Last read 12 Nov" when the newest read is older than
  yesterday. Both escrows at one block: `tokenId()` and `supply()`, then `locked(id)` for every id
  from 1 to `tokenId()` and `votingPowerOfNFT(id)` for the live ones, in
  sequential multicalls of 500. This is the chain's data, not the
  warehouse's lock rows (which start at block 7.74M and miss splits, so
  they undercount veBTC): the amounts read must add up to `supply()`
  exactly, else the read fails and nothing is written. Read on 15 Nov
  2026: veBTC 6,180 ids, 2,073 live locks, 789.31 BTC, equal to
  `supply()`, in 18 requests and 28 s; veMEZO 2,947 ids, 1,871 live,
  283.77M MEZO, 8 requests, 4.5 s. The document holds the live,
  permanent, timed and expired (past their end, not withdrawn) groups
  with amount and voting power, the largest and median lock, the
  amount-weighted time left, size buckets (veBTC from 0.01, 0.1, 1 and
  10 BTC; veMEZO from 1k, 10k, 100k and 1M MEZO), time-left buckets (a
  week each for veBTC, whose locks last 28 days at most; a year each for
  veMEZO's 208 weeks) and every unlock time ahead with its count and
  amount.
- **D1 row writes.** `lock_distribution`: 2 rows a day (plus the
  marker). Governance, one served batch per 5-minute run (288 a day):
  `change_mark` 288, the sweep cursor 288, `data_version` at most 288
  (only on a change), and the rows that changed: the current epoch's 4
  `epoch_sources` rows whenever its votes or incentives move (at most
  1,152), about 30 `gauge_emissions` rows and 4 voter rows when an
  epoch's emissions are distributed. At most about 2,050 a day, usually
  fewer (an unchanged run writes 2 rows).
- **History.** Emissions and voter totals come from rows SCAN_DB already
  holds, so the rotation fills every past epoch. The lock distribution
  starts on its first daily read; earlier days stay absent (the API
  answers the newest document and the ones nearest 30 and 90 days before
  it, null until they exist). Reading past days would need archive reads
  of every lock id at each day's block (about 26 requests a day); no
  backfill is written for it.

## Validator uptime

Mezo is CometBFT 0.38 with a PoA module and no `x/slashing` or
`x/staking`, so signing uptime exists only in each block's commit
signatures. Mezo's own RPCs serve EVM JSON-RPC only (`/status`,
`/commit` and `/mezo/poa/v1/validators` answer 204 or 404 there), so the
poller reads a community CometBFT node (`src/uptime/`, migration
`scan-migrations/0005_validator_uptime.sql`).

### Nodes

| Var                        | Default                                          | Notes                                                                    |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `UPTIME_RPC_URL`           | `https://comet.mezo-archive.pathrocknetwork.org` | CometBFT RPC, read first. Pathrock's public archive node (from height 1) |
| `UPTIME_REST_URL`          | `https://rest.mezo-archive.pathrocknetwork.org`  | Cosmos REST of the same node (`/mezo/poa/v1/validators`)                 |
| `UPTIME_FALLBACK_RPC_URL`  | `https://rpc.lavenderfive.com/mezo`              | Live fallback. Lavender Five's pruned node (from height 7,389,966)       |
| `UPTIME_FALLBACK_REST_URL` | `https://rest.lavenderfive.com/mezo`             |                                                                          |
| `UPTIME_HEIGHTS_PER_RUN`   | 120                                              | Most heights a run reads (about 16 are produced a minute)                |

Neither node has an SLA or published limits (Pathrock about 0.7 s a call,
CORS `*`; Lavender rate-limits without saying how much), and Pathrock's own
explorer hostname has already gone. Treat both as unreliable:

- **Health check, every run.** `/status` of the primary: healthy when not
  `catching_up` and within 40 blocks of the EVM head (`eth_blockNumber`
  on `MEZO_RPC_URLS`). Otherwise the fallback is asked, and used when it is
  healthy and still holds the next height (Lavender is pruned, so history
  before its earliest height only comes from Pathrock). With neither
  healthy, the node that answered and holds the next height is read anyway
  (its data is right, only late) and the status says `behind`; with none,
  `down`.
- **Calls.** Commits go 10 heights to a JSON-RPC batch (the nodes refuse
  more). Each call has an 8 s timeout and one retry after 0.5 s on a network
  error, 429 or 5xx; a batch that still fails is tried once on the other
  node, else the run stops and writes what it read. The run stops reading
  after 25 s, so a slow node cannot run into the next minute.

### The run

On the `* * * * *` trigger, beside the price job (neither waits for the
other), behind a 55-second lease in `uptime_status`. It reads every height
from the last one counted to the node's head minus one (the head's commit
is not final), at most `UPTIME_HEIGHTS_PER_RUN`; a first run starts 20
heights back. A gap (an outage) is caught up at about 100 heights a minute
more than the chain makes, never skipped. One `/status` request a run per
node asked, 2 batch requests a minute in the steady state, and one
`/validators` read only when the set changes or the proposer order has to
be re-read (and the PoA list with it, to name new members).

Per height (`uptime_blocks`, one row): the commit round, the proposer, and
which members signed (a bitmap against the set; a nil vote counts as
signed, as x/slashing counts liveness), with the set stored once per
`validators_hash` in `uptime_sets`: each member's consensus address,
operator and moniker. The operator is the PoA module's `operator_bech32`
decoded to 20 bytes, which is the EVM `miner` and the address Matchscan's
validators pages use; the consensus address is the first 20 bytes of
SHA-256 of the ed25519 key in `cons_pub_key_bech32` (after Amino's 5-byte
prefix). On 12 Nov 2026 all 21 members matched both ways, and the absent
signer was Imperator.co.

**Missed proposals are named.** A block committed in round r > 0 means
the proposers of rounds 0 to r - 1 did not get a block committed. The
poller works them out with CometBFT's own proposer selection
(`IncrementProposerPriority`, in `src/uptime/decode.ts`): the set's
priorities step once per height, and once more per round. Checked on 79
consecutive heights of real data: every stepped set equalled the node's
`/validators?height=h` priorities, the pick was the header's proposer on
all 75 round-0 blocks and, stepped once more, on all 4 round-1 blocks
(each time Imperator.co's turn, taken by arashaus). The poller keeps the
priorities between runs and checks every round-0 header against its pick;
a disagreement re-reads the set at that height. Right after a re-read,
the round-0 proposer of that one height is known only if the block is
round 0 (a round > 0 block then has `missed` NULL and counts as
`unattributed` on the chain's row). Rounds of 2 or more were not seen in
the sample; they are stepped one round at a time, as `enterNewRound` does.

Counts are added to `uptime_hourly` (per validator and UTC hour: blocks in
the set, signed, missed, proposed, proposals missed, expected proposals as
the sum of 1/N in millionths; the chain's own row `''`). The blocks, the
hourly additions and the new height are one D1 batch whose every write is
guarded on the height the run started from, so two runs can never count a
height twice. Once a UTC day is over, its hours are rolled into
`uptime_daily` (kept forever; `complete` is 1 when every height of the day
was counted, so not on the poller's first, partial day).

### D1 cost

About 22,700 blocks a day. Row writes: 22,700 block rows, about 32,000
hourly upserts (22 rows a run), 22,700 block deletes as rows pass 7 days,
22 daily rows and 1,440 status writes: about 80,000 a day, 2.4 million a
month (Workers Paid includes 50 million). Kept: `uptime_blocks` 7 days
(about 160,000 rows of about 40 bytes, 6.5 MB), `uptime_hourly` 14 days
(about 7,400 rows), `uptime_daily` forever (22 rows a day). Seven days of
blocks cover the recent-blocks strip and a re-count of the hourly rows if
the counting ever changes; the 24-hour and 7-day windows come from the
hourly rows, 30 days from the daily rows.

### Turning it on (a human)

1. Apply the migration to `matchbox-scan` (from `apps/jobs`):
   `pnpm exec wrangler d1 migrations apply matchbox-scan --remote`
   (applies `0005_validator_uptime`). Until then each run logs `UPTIME
TABLES MISSING` and skips, and the API answers uptime as not started.
2. Deploy the API, then this Worker. The poller starts on its own.
3. Backfill the past 30 days (optional; a dry run by default, resumable):

   ```sh
   cd apps/jobs
   pnpm exec tsx scripts/scan-backfill/uptime.ts --days 30 --max-requests 100000
   pnpm exec tsx scripts/scan-backfill/uptime.ts --days 30 --max-requests 0 --write
   pnpm exec wrangler d1 execute matchbox-scan --remote --file scripts/scan-backfill/out/uptime/uptime-0001.sql
   ```

   It reads every height of the past 30 complete UTC days from Pathrock's
   archive node with the poller's own decoder, one batch of 10 commits per
   750 ms or slower (`--interval-ms`): about 68,000 requests, a day or more
   of wall time at Pathrock's pace, so run it over several sittings. Its SQL inserts days that are absent and
   replaces only incomplete ones; a complete day never changes. Sample, 11
   Nov 2026: heights 13,142,787 to 13,165,421.

4. Check: `SELECT height, block_time, source, health, last_error FROM
uptime_status` shows `ok` and a height within a few blocks of the head.

### Dry run

`pnpm exec tsx scripts/uptime-dry-run.ts [--heights 200]` reads the last N
heights from the real nodes, decodes them with the poller's code and
prints what it would store per validator (nothing is written). On 12 Nov
2026 (heights 13,171,682 to 13,171,881): 21 members, all named;
Imperator.co absent from all 200 commits and the round-0 proposer of all
10 round-1 blocks; Simply Staking absent from 8; everyone else 100%.

## Cross-chain data (MUSD and MEZO beyond Mezo)

`src/crosschain/` reads MUSD and MEZO on Mezo, Ethereum and Base (and MEZO on
BNB Chain) into `SCAN_DB` (`scan-migrations/0006_crosschain_market.sql`),
for the API's `/internal/scan/crosschain/*` routes. It needs no indexer:
public RPCs and keyless public APIs only. The catalog (chains, NTT
managers, tracked pools, price venues) is `packages/chain/src/crosschain.ts`.
Every address there was checked on chain on 12 Nov 2026 (`getMode()`,
`token()`, `token0()`/`token1()`, `coins()`), never matched by symbol. The
impostor 9-decimal "MEZO" `0x423f…` on Ethereum, and the other "MUSD"
tokens in DefiLlama and Merkl (MetaMask USD `0xaca9…`, mStable mUSD
`0xe2f2…`), never match an address. The pure maths (tick and sqrt-price
prices, Curve metapool price, weighted median, spread, fee APR, circulating
supply) lives in `@matchbox/domain/market-price`. It works on bigints only.

| What                           | When                                           | Table                                         |
| ------------------------------ | ---------------------------------------------- | --------------------------------------------- |
| MUSD venue quotes and headline | every minute, after the price job              | `market_quotes` (one row per venue)           |
| MUSD daily closes (peg chart)  | the price-close minutes (:59 each hour, 00:00) | `market_price_daily` (per venue, `headline`)  |
| Supply by chain                | hourly, from the 5-minute live trigger         | `token_supply_daily` (today's row is current) |
| Pool depth, volume, APR split  | hourly; every 2 hours with a Demo key          | `pool_daily` (today's row is current)         |
| Bridge flows (Wormhole NTT)    | hourly, from the 5-minute live trigger         | `bridge_route_totals`, `bridge_daily`         |

### Sources

- **MUSD price.** The job reads three venues each minute:
  - **Curve MUSD/2pool on Ethereum** (`0xb557…955f`): `get_dy(0, 1, 1e18)` ×
    the 2pool's `get_virtual_price()`. Depth is MUSD plus the LP valued at
    the virtual price, about $3.36M.
  - **Aerodrome MUSD/USDC on Base** (`0xb02f…2ea5`): the 30-minute TWAP from
    `observe()`. About $820k.
  - **Tigris mUSDC/MUSD on Mezo** (`0xcc37…ac1a`): the 30-minute TWAP. About
    $215k.

  USDC, USDT and the 2pool's coins are taken at $1. mUSDC and mUSDT are fully
  backed bridged USDC and USDT, so they are priced as the underlying. The
  headline is the **liquidity-weighted median** of the quotes read in the same
  minute. `diverged` is set when the venues are more than 50 bps apart. A
  quote outside $0.50 to $1.50 is refused. Only when no venue answers does
  the job ask CoinGecko (`mezo-usd`).

  Why a per-venue table, not `price_daily`: a peg chart needs every venue,
  and `price_daily` is (token, day). Keeping MUSD out of `price_daily` also
  leaves its existing readers alone. `market_price_daily` keeps a `headline`
  row per day beside each venue's row.

- **MEZO price.** CoinGecko, unchanged, through the minute price job and the
  `PRICES` KV ("MEZO's price" above). The API's prices route reads it from
  there.
- **Supply.** `totalSupply()` on each chain, plus the Mezo NTT manager's
  balance. Mezo's managers lock (`getMode()` 0) and the other chains burn and
  mint (1), so Mezo's circulating supply is totalSupply minus that balance.
  On 12 Nov 2026 Mezo had 2.849M MUSD locked, against 2.841M MUSD on Ethereum
  and Base together.
- **Pools** (16, including the two legacy Aerodrome pools):
  - **TVL and 24h volume:** GeckoTerminal's data, from one of two
    endpoints that answer in the same shape (CoinGecko's
    `MultiPoolAddressData`):
    - With `COINGECKO_API_KEY`: CoinGecko's keyed
      `/api/v3/onchain/networks/{network}/pools/multi/{addresses}`. Demo
      uses `api.coingecko.com` with the `x-cg-demo-api-key` header, and
      `pro` uses `pro-api.coingecko.com` with `x-cg-pro-api-key`. The
      source is recorded as `coingecko`, which Matchscan shows as "Data
      provided by CoinGecko". Without a key this endpoint answers 401.
    - Keyless GeckoTerminal `api.geckoterminal.com/api/v2/.../pools/multi`
      (source `geckoterminal`). It is used without a key, as the second
      attempt when the keyed call fails, and on retries. A Worker's shared
      egress IPs often hit its per-IP limit (HTTP 429).

    Curve's volume comes from Curve's `getVolumes`, because GeckoTerminal
    misses metapool swaps that route through the base pool. sMUSD's TVL
    comes from DefiLlama. GeckoTerminal's token prices are never used: its
    Mezo prices are unreliable.

  - **Fee APR:** DefiLlama's `apyBase` where DefiLlama tracks the pool
    (Curve, Uniswap v4 USDC/MUSD, and sMUSD's savings rate). Otherwise an
    estimate from 24h volume × fee ÷ TVL on a fixed-fee pool, labelled as an
    estimate.
  - **Reward APR:** DefiLlama's `apyReward` (CRV). The API adds Tigris MEZO
    emissions from Pro's gauge documents.
  - **Merkl APR:** the live opportunity whose chain id and identifier are the
    pool's own, for holding the position directly (not Convex). On 12 Nov
    2026 these paid "veMEZO (wrapped)" on Mezo.
  - **Aerodrome APR:** null with a reason. The new gauges revert on
    `rewardRate`.
  - **Matchbox gauge APR:** null with a reason. The MEZO a gauge sends is not
    converted to an APR yet. The API links the gauge to its pool: through the
    pool-address suffix in the ThirdPartyVoter metadata, the owner's
    `mezo_gauge_destinations` URL, or Pro's pool gauges.
- **Bridge flows.** Wormholescan's NTT `activity` endpoint gives all-time
  totals per route, in transfers and USD. Each day's totals are stored, and
  the API reports a route's daily flow as the change from the day before.
  `transfer-by-time` gives transfers and USD per day across every route.
  Wormholescan answers "Unsupported token" for MEZO, so MEZO's flows are not
  available.

### Refresh, rate limits and failure behaviour

- **Price, every minute.**
  - Three RPC reads per venue, pinned to one block.
  - No CoinGecko call unless every venue fails. Then one call for MUSD,
    shared with the keyless budget in "MEZO's price".
  - A venue that fails keeps its last row, and the API marks it `stale` once
    it is 10 minutes old.
  - With no venue answering and no CoinGecko answer, the headline keeps its
    last row and goes stale.
- **Hourly parts.**
  - Each part has a marker in `scan_cursors` (`crosschain:supply`,
    `crosschain:pools`, `crosschain:bridge`), set to the UTC hour it
    completed and written in the same batch as its rows. A failed or partial
    part is retried on the next 5-minute run, so it runs at most 12 times an
    hour.
  - With a Demo key the pool part runs every 2 hours, and its marker is
    the period's first hour ("CoinGecko call budget"). The other parts stay
    hourly.
  - A chain whose depth sources both failed (`depth:{chain}` in the run's
    `failed`) leaves its pools out of that run, so today's earlier reading
    stands and is never overwritten with nulls or zero. The warning names
    the source that failed (`coingecko-onchain` or `geckoterminal`) and the
    HTTP status, never the URL or a header.
  - One run makes at most about 12 HTTP calls: 3 depth calls (keyed when
    allowed, otherwise or after a failure GeckoTerminal, limit about 30 a
    minute per IP), 3 DefiLlama charts, 1 Curve, 1 Merkl and 4
    Wormholescan.
- **Writes.** About 3 rows a minute in `market_quotes`, about 30 rows an hour
  in the other tables, and about 4 more rows at each close minute.
- **Caching.** None of these writes bump `scan_status.data_version`, because
  MUSD's quotes change every minute and would retire every Scan cache. The
  API keys these routes on time slots instead.
- **Before the migration.** Until `0006` is applied, each run logs one
  warning ("Cross-chain tables missing") and writes nothing. The API's token
  list keeps MUSD at $1 taken.

### Secrets and vars

| Name                | Kind   | Notes                                                                             |
| ------------------- | ------ | --------------------------------------------------------------------------------- |
| `ETHEREUM_RPC_URL`  | secret | Optional preferred Ethereum RPC. Public RPCs follow it (`src/crosschain/rpc.ts`). |
| `BASE_RPC_URL`      | secret | Existing. Also used here. Public Base RPCs follow it.                             |
| `BSC_RPC_URL`       | secret | Optional preferred BNB Chain RPC, for MEZO's supply there.                        |
| `MEZO_RPC_URLS`     | var    | Existing. Mezo's public RPCs by default.                                          |
| `COINGECKO_API_KEY` | secret | Existing (MEZO). Also MUSD's fallback and pool depth ("CoinGecko call budget").   |

Every other source is keyless. No key is needed for anything to work.

### Dry run

`pnpm --filter @matchbox/jobs crosschain:dry-run` (add `-- --sql` for the
statements) reads every real source once and prints what one run of each
job would store. It writes nothing. It also prints the CoinGecko budget and
the three keyed pool requests (URL and header name, never the key). With
`COINGECKO_API_KEY` set in the shell, it reads pools through them. `scripts/record-crosschain-fixtures.ts`
re-records `test/fixtures/crosschain.json`, the real answers the tests
replay.

### Applying the migration (a person, not an agent)

```sh
cd apps/jobs && pnpm exec wrangler d1 migrations apply matchbox-scan --remote
```

It only creates new tables and indexes, so it can be applied at any time.
`migrations apply` runs every pending file in order, so it also applies
`0005_validator_uptime.sql` if that is not applied yet. Both are additive.
Deploy the API and the jobs Worker after it.

## Local development

```sh
cp .dev.vars.example .dev.vars   # WAREHOUSE_DATABASE_URL: a Neon DEV branch only
pnpm db:migrate:local
pnpm dev                         # wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

`pnpm test` runs the unit tests in Node, then the Workers tests (D1 and KV
in Miniflare). The warehouse test replays `test/fixtures/warehouse.json`,
real projection rows recorded from the Neon dev branch with
`pnpm record:warehouse` (read-only queries, no chain reads).
