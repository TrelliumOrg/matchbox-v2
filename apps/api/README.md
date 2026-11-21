# Matchbox API (`api.matchbox.markets`)

The Matchbox API: a Hono Worker serving the public `/v1` API (gauges,
gauge profiles, incentives, epochs and networks, read with an API key from
Matchbox Developer) and the internal read routes Matchbox Pro, Matchscan and
Stuart use. Worker `matchbox-developer-api`, custom domain
`api.matchbox.markets`. The public API's reference and changelog are on the
docs site ([packages/docs/content/developer](../../packages/docs/content/developer)),
and the TypeScript client is [`@matchbox-dev/sdk`](../../packages/sdk).

Locally it runs with no credentials on an in-memory store with sample data
(`pnpm dev:memory`, below). Tests need nothing:
`pnpm --filter @matchbox/api test`. Real data needs your own Supabase
project (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and, for the
`/internal/pro` and `/internal/scan` read models, D1 databases the jobs
Worker ([apps/jobs](../jobs)) has filled.

## Routes

| Route                                             | Auth                                           |
| ------------------------------------------------- | ---------------------------------------------- |
| `GET /v1/health`                                  | none                                           |
| `GET /openapi.json`                               | none (from `@matchbox/contracts/openapi.json`) |
| `GET /v1/networks`                                | API key                                        |
| `GET /v1/gauges?network=…`                        | API key                                        |
| `GET /v1/gauges/{network}/{gaugeAddress}`         | API key                                        |
| `GET /v1/gauges/{network}/{gaugeAddress}/epochs`  | API key                                        |
| `GET /v1/vebtc/{network}/{tokenId}/gauge`         | API key                                        |
| `GET /v1/gauge-profiles?network=…`                | API key                                        |
| `GET /v1/gauge-profiles/{network}/{gaugeAddress}` | API key                                        |
| `GET /v1/vebtc/{network}/{tokenId}/gauge-profile` | API key                                        |
| `GET /v1/incentives?network=…`                    | API key                                        |
| `GET /v1/epochs/current`                          | API key                                        |

## Local development

```sh
cp .dev.vars.example .dev.vars
pnpm dev:memory     # http://localhost:8787, sample data + fixed dev keys, no Supabase
pnpm dev:seed-keys  # prints the memory-mode keys and their origins
pnpm dev            # Supabase-backed; needs .dev.vars secrets
```

Memory-mode publishable test keys accept origins `http://localhost:3000` and
`http://localhost:5173`.

### Local read models (`pnpm db:seed:local`)

The internal read routes (`/internal/pro/*`, `/internal/scan/*`) read the
`READ_DB` and `SCAN_DB` D1 bindings and the `PRICES` KV namespace. Locally
those live in `apps/api/.wrangler/state` and start empty, so every read
fails with `no such table: read_models`. One command fills them, with no
credentials:

```sh
pnpm db:seed:local   # from the repo root, or here
pnpm dev:memory
```

It applies every migration with `wrangler d1 migrations apply --local`
(`../jobs/migrations` and `read-db-migrations` on `READ_DB`,
`../jobs/scan-migrations` on `SCAN_DB`, `migrations` on `MARKET_DB`; a new
migration in those directories is picked up with no change to the seed),
then writes the fixture world in `src/local-seed/world.ts`. Read models
and the stored history go through the same store code the jobs Worker
writes with, so every document and row is validated against its
read-model schema. The scan rows are the `/internal/scan` test fixtures,
which the scan route tests keep in step with the migrations:

- `READ_DB`: the shared Epoch 47 read models
  (`@matchbox/contracts/read-models/fixtures`, the data Pro, Matchscan and
  Stuart use in their fixture modes): the gauge directory, one gauge profile,
  the protocol documents (current, activity, history, epoch 47), the demo
  wallet's overview, rewards and activity, and its watch list. Stored with
  `source` `fixture`. The demo wallet's stored history
  (`wallet_activity_rows`, `wallet_history_state`) holds its mined rows,
  and its `wallet-activity` document leaves out the two oldest, so its
  Activity ends with "Show earlier epochs" and pages into the history as a
  busy wallet's does. Also the trove, Morpho and Stability Pool rows of the
  `/internal/scan` tests (`src/scan/fixtures.ts`).
- `SCAN_DB`: the `/internal/scan` test rows (activity, locks, votes,
  incentives, epochs) with a finished copy run and a healthy status row.
- `PRICES`: the demo BTC and MEZO prices under `prices:v1`.

It only touches local state, and `src/local-seed/guard.ts` (tested in
`guard.test.ts`) checks that before anything runs: the script takes no
arguments, every wrangler command is a `--local` migrate into
`apps/api/.wrangler/state` and never `--remote`, it refuses when
`CLOUDFLARE_ENV` is set or `ENVIRONMENT` or `NODE_ENV` names production,
and wrangler gets no Cloudflare credentials. The bindings come from a
Miniflare proxy with remote bindings off. Each run clears what it writes first, so running
it again resets to the same state (rows the jobs Worker wrote to other
tables stay). It works while `dev:memory` is running.
`src/local-seed/world.workers.test.ts` runs the same seed on freshly
migrated databases and fails if a migration or a read-model contract change
breaks it.

To call `/internal/*` yourself, set `INTERNAL_TOKEN` (32 characters or
more) in `.dev.vars` and send it as a bearer:

```sh
curl -H "Authorization: Bearer $INTERNAL_TOKEN" http://127.0.0.1:8787/internal/pro/summary
curl -H "Authorization: Bearer $INTERNAL_TOKEN" "http://127.0.0.1:8787/internal/pro/gauges?limit=2"
curl -H "Authorization: Bearer $INTERNAL_TOKEN" http://127.0.0.1:8787/internal/scan/borrow/troves
```

Wallet routes read the chain as in production: a wallet's locks and
claimable are read live from public Mezo RPCs and laid over the stored
documents. The demo wallet is made up, so the chain reports no locks for
it. A real wallet with no stored document is built live, which needs the
migrated `READ_DB`. Leave `MEZO_MAINNET_RPC_URL` unset locally: it goes
first in the RPC list, and with the endpoint in `.dev.vars.example` live
wallet builds did not finish within their deadline (19 Nov 2026).

The jobs Worker's dev scripts persist to the same directory
(`--persist-to ../api/.wrangler/state`), so a local jobs run writes into
the databases this Worker reads. Pro reads this API with `PRO_DATA=api`,
`API_ORIGIN=http://127.0.0.1:8787` and the same `INTERNAL_TOKEN` in
`apps/pro/.dev.vars`. Matchscan cannot yet: its config binds `API` to
`matchbox-api-v2-preview`, and under `vite dev` that binding is used
instead of `API_ORIGIN`.

Other scripts: `pnpm test` (Node unit tests, then the Workers runtime tests in
`vitest.workers.config.ts`), `pnpm typecheck`.

`PLATFORM_STORE=memory` is refused when `ENVIRONMENT=production` (the
checked-in default). Memory mode also logs the dev keys once per isolate.

The sample store backs only `/v1`. The `/internal/pro` and `/internal/scan`
read models come from the `READ_DB` and `SCAN_DB` D1 bindings, which
locally live in `apps/api/.wrangler` and start empty until
`pnpm db:seed:local` fills them (above).

## Deploy

```sh
pnpm turbo run build --filter=@matchbox/api...   # from the repo root
pnpm --filter @matchbox/api exec wrangler deploy
```

Secrets (`wrangler secret put`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`API_KEY_PEPPER` (same value as the developer console, ≥ 32 chars),
`MEZO_MAINNET_RPC_URL`, `MEZO_TESTNET_RPC_URL`; optional `INTERNAL_TOKEN`
(opens `/internal/*` to a public caller with that bearer; leave unset in
production), `BLOCKSCOUT_API_KEY` (the Blockscout proxy's upstream key),
`BASE_RPC_URL` (MEZO's fallback pool) and `COINGECKO_API_KEY` (MEZO's
price; unset calls the keyless API, var `COINGECKO_API_PLAN` `demo` or
`pro` picks the host). The market cron reuses the jobs Worker's CoinGecko
reading from `PRICES` while it is under 8 minutes old, so it adds no
CoinGecko calls of its own (apps/jobs README, "MEZO's price").
Missing or invalid bindings make every request return 500 `internal_error`
and log the problem names.

Vars: `ENVIRONMENT` (`production`), `API_VERSION`,
`GAUGE_PROFILE_API_ENABLED` (kill switch, default `"false"`: `/v1/*` except
`/v1/health` and `/openapi.json` returns 503 `service_disabled`),
`PUBLISHABLE_QUOTA_SHARE` (publishable keys' share of the environment quota,
`(0, 1]`, default `0.5`), `HEALTH_API_URL` / `HEALTH_ID_URL` (health probe
targets; blank skips that probe).

Compatibility flag `global_fetch_strictly_public`: the health cron fetches this
Worker's own custom domain through the public front door (a Custom Domain
Worker fetching its own hostname otherwise gets a 522).

Durable Object `RATE_LIMITER` → `RateLimiter` from
`@matchbox/server/rate-limiter`. Migration `v2` deletes the beta
`ApiQuotaLimiter` class and adds `RateLimiter`.

## Internal routes (`/internal/*`)

Only Matchbox's own Workers (Pro, Stuart, Scan) reach `/internal/*`, through
a service binding. Every other caller gets the same `404 not_found` as an
unknown route, with `Cache-Control: no-store` and no CORS headers
(`src/internal/access.ts`, mounted before `securityHeaders` and `cors`; the
`/internal/heads` WebSocket upgrade, which bypasses the app, checks the same
rule in `src/heads/upgrade.ts`). A request is let through when one holds:

1. **Its hostname is one a binding caller uses.** Cloudflare invokes this
   Worker from the internet only for hostnames routed to it (the custom
   domain, the workers.dev subdomain), and the request URL carries that
   hostname. A binding call carries the URL its caller built. Exactly two
   hostnames are trusted (`bindingHostnames` in `src/internal/access.ts`):
   `api.internal` (Pro, Scan) and `matchbox-developer-api` (Stuart).
   `.internal` is reserved by ICANN for private use and never delegated,
   and a single-label name has no zone, so neither can be routed here from
   the internet. Every other name, including other `*.internal` and
   single-label names, `localhost` and IP literals, is denied. Local
   development needs no extra name: `wrangler dev` bindings carry the same
   URLs, and a direct call uses the token.
2. **It came through the `InternalApi` named entrypoint.** Routes and
   workers.dev invoke only the default export, so a caller that binds with
   `"entrypoint": "InternalApi"` is trusted whatever URL it builds and does
   not rely on rule 1. Callers should move to it; once all have, empty
   `bindingHostnames`.
3. **Development escape.** `Authorization: Bearer <INTERNAL_TOKEN>`, compared
   in constant time (both sides hashed first), only when the
   `INTERNAL_TOKEN` secret is at least 32 characters and `ENVIRONMENT` is
   not `production`. Otherwise the escape is closed. Pro already sends this
   header when it has the token.

Not checked: whether anything (Classic, scripts, a Pro build without a
binding such as the default `matchbox-pro-v2` env, which reads
`API_ORIGIN=https://api.matchbox.markets`) still calls `/internal/*` on the
public origin. Check the request log (`routeTemplate` `/internal/*` with
status 404) after deploying.

## Blockscout proxy (`/internal/blockscout/api/v2/*`)

An allowlisted, cached proxy in front of Mezo's Blockscout
(`https://api.explorer.mezo.org/api/v2`, v12). Internal callers only (above).
`/internal/blockscout/api/v2/<path>` reads `<path>` upstream, so Stuart's
existing client (`apps/stuart/src/query/providers/blockscout.ts`) works
unchanged. GET only. Before any upstream read, an unknown path is a 404 and
an unknown, repeated, malformed or partial query parameter a 400. Not a
passthrough: each route's zod schema (`@matchbox/contracts/blockscout`)
validates the body and trims it to the fields an explorer needs, keeping
Blockscout's field names. Amounts stay decimal strings. A body that fails
its schema is logged (route and issue paths, never the body) and answered
with a generic 503. Answers carry no CORS headers.

Code: `src/blockscout/routes.ts` (allowlist, schemas, classes),
`proxy.ts` (storage, freshness, coalescing, budgets), `endpoint.ts` (Hono),
`head.ts` (head and last active block), `trace.ts` (raw trace summary).
Fixtures recorded from the live upstream on 9 Nov 2026 are in
`src/blockscout/fixtures`.

### Queries

- Filters (`type`, `filter`, `token`, `topic`, `q`) are optional, each on its
  own.
- A keyset cursor is the route's `next_page_params` and must be complete:
  every field or none. `items_count` is accepted only with a complete
  cursor. Holders and search take no cursor (first page only).
- Hash and address values (`hash`, `token`, `topic`,
  `contract_address_hash`) are lower-cased, and parameters sorted, before
  keying and forwarding, so case and order cannot fork the cache.

### Cache classes and freshness

One stored answer per resource (path plus canonical query), in this
isolate's memory (an LRU of 8 MiB; bodies over 256 KiB are not held) and in
the Cache API (its own `blockscout` namespace). Each answer records its
class, when it was read and at which head; freshness is decided from that,
not from the key. Immutable, final, search and slow answers are served
without reading the head. Otherwise the head comes from BlockHub's plain GET
(`height` and `lastActiveBlock`, remembered per isolate for a second,
waited on for at most 300 ms; without it, 3.8 s time buckets stand in and
nothing is treated as final).

| Class       | Kept fresh                                                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `immutable` | A year. Final and settled chain data (rules below).                                                                                                                                                             |
| `final`     | A day. Final chain data whose Blockscout enrichment may still change.                                                                                                                                           |
| `per-block` | Until the head moves. Block lists re-read every block. Transaction lists and not-yet-final chain data are also kept over idle blocks: once read two blocks after the last block that may have had transactions. |
| `swr`       | Address views, below.                                                                                                                                                                                           |
| `search`    | 45 seconds.                                                                                                                                                                                                     |
| `slow`      | The route's TTL, 5 to 15 minutes.                                                                                                                                                                               |

**Final** means our RPC head is at least `BLOCKSCOUT_FINALITY_DEPTH`
(default 30) blocks past the item, Blockscout's own `confirmations` (counted
from its latest indexed block, where the response has them: transactions
and block transaction pages) are past the same depth, Blockscout no longer
marks it pending, and for internal transactions its indexing meta says the
range is processed. An empty block transaction page is never final, by
height or by hash.

**Settled** (immutable rather than final) means Blockscout's enrichment can
no longer change: every embedded address is either not a contract or a
verified one (so its name and implementations are final); for a
transaction, `has_error_in_internal_transactions` is set, and the input is
decoded unless it is empty, the target is not a contract, or it creates a
contract; for logs, every log is decoded; for token transfers, every token
has a name, symbol and decimals; for block transaction pages, no contract
call still shows a raw method selector. Raw traces carry no enrichment.
Anything final but not settled is kept a day, so a contract verified later
shows up within a day.

**Address views** (`swr`: address, counters, transactions, token transfers,
tokens, logs, and token transfers by token) are answered from the stored
copy at once (`X-Cache: revalidating`, `Cache-Control: no-store`) and
refreshed behind the answer when stale, at most once per N blocks
(`BLOCKSCOUT_REVALIDATE_BLOCKS`, default 4, about 15 s). A copy is fresh
while it is under N blocks old; or, when it was read N blocks after the last
activity, for up to ten minutes; or, while the latest activity is under N
blocks old, for up to 8N blocks (Blockscout's balance and token fetchers
settle a block a few blocks after it). Activity therefore costs one read, N
blocks after it, or two when the copy is over 8N blocks old (activity more
than two minutes apart); a chain busy every block costs one read per 8N
blocks (about two minutes).

**History pages.** A page past the first of an address's transactions,
token transfers or logs, or of a token's transfers (the keyset cursor
given), holds only items older than the cursor. Once every item on it and
the cursor's own block are final, and Blockscout's
`main-page/indexing-status` reports `finished_indexing_blocks` (read at
most once a minute per isolate, beside the page rather than after it, and
spending neither bucket; a failure, a read over 500 ms or an odd body
counts as not finished for that minute), it is kept a day (`final`), never
a year. Blockscout reports `finished_indexing_blocks` from 99% indexed, so
on Mezo's 13M blocks a gap of up to about 130k blocks (six days) can sit
behind it: a page spanning a gap that Blockscout backfills later heals
within a day. Until then, and always for the first page, it is an address
view. Deep reads such as Stuart's
follow-the-money questions therefore cost upstream reads once per page, not
once per question.

A 404 is believed for one block on chain routes and for a minute on search
and slow routes, under the same key, so repeated lookups of a missing hash
or token cost one read.

**Answers.** `X-Cache` is `memory` (isolate), `edge` (Cache API), `miss`
(read now), `coalesced` (shared a concurrent read), `revalidating` or
`stale` (the stored copy because the upstream could not be read).
`X-Blockscout-Class` is the class, `X-Blockscout-Head` the head freshness
was judged at (`unknown`, or `not-read` when the class did not need it).
`Cache-Control`: immutable `public, max-age=31536000, immutable`; final up
to an hour; per-block and swr `public, max-age=3`; search and slow the TTL
left; revalidating and stale `no-store`. Every answer not from memory is
logged (`Blockscout proxy answer` with `route`, `cache`, `cacheClass`).

### The routes

| Path (below `api/v2/`)                      | Filters                   | Cursor (all or none)                                                                         | Class           |
| ------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- | --------------- |
| `blocks`                                    | `type`                    | `block_number`                                                                               | per-block       |
| `blocks/{height or hash}`                   |                           |                                                                                              | chain           |
| `blocks/{height or hash}/transactions`      |                           | `block_number`, `index`                                                                      | chain           |
| `transactions`                              |                           | `block_number`, `index`                                                                      | per-block, idle |
| `transactions/{hash}`                       |                           |                                                                                              | chain           |
| `transactions/{hash}/logs`                  |                           | `block_number`, `index`                                                                      | chain           |
| `transactions/{hash}/token-transfers`       | `type`                    | `block_number`, `index`                                                                      | chain           |
| `transactions/{hash}/internal-transactions` |                           | `block_number`, `index`, `transaction_index`                                                 | chain           |
| `transactions/{hash}/raw-trace` (summary)   |                           |                                                                                              | chain           |
| `addresses/{address}`                       |                           |                                                                                              | swr             |
| `addresses/{address}/counters`              |                           |                                                                                              | swr             |
| `addresses/{address}/transactions`          | `filter`                  | `block_number`, `index`, `value`, `hash`, `inserted_at`, `fee`                               | swr             |
| `addresses/{address}/token-transfers`       | `type`, `filter`, `token` | `block_number`, `index`                                                                      | swr             |
| `addresses/{address}/tokens`                | `type`                    | `value`, `id`, `fiat_value`                                                                  | swr             |
| `addresses/{address}/logs`                  | `topic`                   | `block_number`, `index`                                                                      | swr             |
| `tokens`                                    | `q`, `type`               | `name`, `contract_address_hash`, `holders_count`, `fiat_value`, `market_cap`, `is_name_null` | slow, 10 min    |
| `tokens/{address}`                          |                           |                                                                                              | slow, 10 min    |
| `tokens/{address}/counters`                 |                           |                                                                                              | slow, 5 min     |
| `tokens/{address}/holders` (first page)     |                           |                                                                                              | slow, 10 min    |
| `tokens/{address}/transfers`                |                           | `block_number`, `index`                                                                      | swr             |
| `search` (first page)                       | `q` (required)            |                                                                                              | search, 45 s    |
| `search/quick`                              | `q` (required)            |                                                                                              | search, 45 s    |
| `stats`                                     |                           |                                                                                              | slow, 5 min     |
| `stats/charts/transactions`                 |                           |                                                                                              | slow, 15 min    |
| `stats/charts/market`                       |                           |                                                                                              | slow, 15 min    |
| `main-page/blocks`                          |                           |                                                                                              | per-block       |
| `main-page/transactions`                    |                           |                                                                                              | per-block, idle |
| `smart-contracts/{address}` (ABI, status)   |                           |                                                                                              | slow, 15 min    |

"chain" is immutable, final or per-block (idle-skipping) by the rules
above. The cursors of `blocks`, `transactions`, address transactions,
address token transfers, address logs, `tokens` and token transfers match
recorded `next_page_params`; the others (block and transaction sub-lists,
address tokens) follow Blockscout's keyset fields and were not seen paged
on Mezo. `tokens/{address}` is slow because it carries holders, supply and
price; embedded token metadata is classed with the body it sits in.
Transactions never carry `confirmations` or the current `exchange_rate`
(derive confirmations from the head). The raw trace is a flat list of calls
(`frames`: depth, type, from, to, value, gas used, error; at most 500); a
malformed value or gas fails the schema rather than reading as zero.

### Budgets

Blockscout allows 300 requests a minute per IP (its docs), shared by all our
traffic.

- **Shared bucket** `blockscout:upstream` in the `RateLimiter` Durable
  Object: 200 upstream reads a minute, 150,000 a day. Hits spend nothing.
- **Caller buckets**, spent first, so one end user cannot drain the shared
  one. The calling Worker sends `X-Matchbox-Client` (its name, `scan`,
  `stuart`) and `X-Matchbox-End-User` (the visitor's IPv4 /24 or IPv6 /48
  prefix hashed with a salt the caller keeps, base64url, 22 to 64
  characters; never a raw IP or address). Contract and schemas:
  `@matchbox/contracts/blockscout` (`callers.ts`). Each end user gets 30
  upstream reads a minute and 3,000 a day (about eight new pages, or 30
  distinct searches, a minute); a Stuart visitor (`X-Matchbox-Client:
stuart`) gets 90 a minute and the same 3,000 a day, since one cold
  follow-the-money question reads 20 to 35 history pages at once. All of
  Stuart's reads also spend `blockscout:client:stuart`, 120 a minute and
  60,000 a day, so Stuart's visitors together leave at least 80 a minute
  of the shared bucket to Scan, Pro and the home page. Calls without an
  end-user key share one bucket per client, 60 a minute. A malformed
  header is a 400. Every bucket fails open if the limiter is down. A read
  one bucket refuses gives back what the buckets before it spent (caller,
  then Stuart's, then the shared one), so a refusal costs nothing: a Scan
  surge that empties the shared bucket does not spend Stuart's daily
  quota. The daily caps still add up: about 20 Stuart visitors (distinct
  IP prefixes) reading their full 3,000 a day spend Stuart's 60,000, and
  Stuart's uncached reads stop until UTC midnight (its cached pages still
  answer).
- A 429, or `x-ratelimit-remaining` at 25 or below, stops upstream reads in
  that isolate until `x-ratelimit-reset` (read as milliseconds, clamped to
  1 to 60 s; Blockscout does not document the unit).
- One deadline of 4 s covers every upstream attempt and the retry delay;
  one retry after 200 ms, only for an upstream 5xx and only with at least
  1 s of the deadline left. With the 300 ms head wait an answer stays inside
  Stuart's 5 s client timeout.
- An upstream error, a 401 or 403 (our key refused: logged at error level),
  a 429, a backoff, a spent bucket or a schema failure serves the stored
  copy (`stale`, kept a day) when there is one; without one, 503
  `service_disabled` (429 `rate_limited` when limited) with `Retry-After`.

**Expected upstream reads.** Inputs: 15.8 blocks a minute; 750 to 1,170
transactions a day (Blockscout's chart, 1 to 8 Nov 2026), so at most 0.82
blocks a minute with transactions (the worst case, every transaction alone
in its block; real activity clusters). Load: 200 concurrent viewers on the
home page, 30 address pages and 30 transaction pages, each refetching what
is on screen at every head. Per cache domain:

| Resource                                                      | Count | Reads each per minute                         | Reads/min |
| ------------------------------------------------------------- | ----- | --------------------------------------------- | --------- |
| `main-page/blocks`                                            | 1     | 15.8 (every block)                            | 15.8      |
| `main-page/transactions`                                      | 1     | 3 per active block                            | 2.5       |
| `stats`                                                       | 1     | one per 5 min                                 | 0.2       |
| Address views (summary, counters, the visible list; 30 pages) | 90    | at most 1, plus 1 per 10 idle minutes (below) | 99        |
| Transaction pages over 30 blocks old (27 pages, 3 resources)  | 81    | once; unsettled ones once a day               | about 0   |
| Transaction pages under 30 blocks old (3 pages, 3 resources)  | 9     | 3 per active block                            | 22        |
| Total                                                         |       |                                               | 139.5     |

Address views: activity s minutes apart costs one read each when s is under
two minutes (at most 0.82 a minute at today's rate) and two when it is more
(at most one a minute), so never more than one a minute, plus 0.1 for the
ten-minute cap: 90 × 1.1 = 99. The total is 70% of the 200 a minute shared
bucket and 47% of Blockscout's 300, leaving room for the API's other
Blockscout reads. A chain with transactions in every block (about 50 times
today's) would cost address views one read per 8N blocks (90 × 0.5 = 45 a
minute) but young transaction pages 15.8 each; the shared bucket then caps
the total and the overflow is served from stored copies.

**A cache domain** is one data center when the Cache API works, and one
isolate when it does not (each isolate has only its memory). Without the
Cache API, multiply each resource by the isolates its viewers reach: home
resources by I, the isolates serving the home page; page resources by k,
about 1 to 2 for a page with one or two viewers. With I = 5 and k = 1.5 the
table above becomes 18.5 × 5 + 121 × 1.5 = 274 a minute: over the bucket,
so stored copies fill the gap. If Scan renders its latest-blocks row from
BlockHub head messages (they carry height, hash, time, transaction count,
gas used and proposer) instead of `main-page/blocks`, it is 2.7 × 5 +
181.5 = 195 a minute, 98% of the bucket. So on a host where the Cache API
does nothing the budget still holds (the buckets enforce it, and answers
stay correct, served from stored copies when it is spent) but there is no
headroom at this load; a zone route, where the Cache API is documented to
work, or a Blockscout API key restores the margin.

**API key.** `BLOCKSCOUT_API_KEY` (secret, optional) is sent as the
`apikey` query parameter: Blockscout's docs show no header form for API v2
keys. The proxy's own logs carry only the route template, never the URL,
and the request log records the incoming route, not subrequests. This
Worker has Workers traces on (`observability.traces`, sampling 1), and a
trace of the subrequest may record its full URL, key included (not
verified). Before setting the key, check one trace in the dashboard; if the
URL is there, turn trace sampling off for this Worker or ask Mezo to
allowlist our traffic instead of issuing a key.

### Is the Cache API live on our hosts?

Cloudflare's Cache API page (developers.cloudflare.com/workers/runtime-apis/cache/),
read on 9 Nov 2026, says: "The Cache API is available globally but the
contents of the cache do not replicate outside of the originating data
center."; "Workers deployed to custom domains have access to functional
`cache` operations."; "any Cache API operations in the Cloudflare Workers
dashboard editor and Playground previews will have no impact."; of
`cache.put` redirects, "This restriction does not apply on .workers.dev
domains, which include the query string in the cache key by default."; and
"The `stale-while-revalidate` and `stale-if-error` directives are not
supported when using the `cache.put` or `cache.match` methods." The
how-the-cache-works page describes "how Workers interact with a zone's
Cloudflare Cache". Neither page, nor the service bindings page, says
anything about Workers invoked through a service binding. So production
(`api.matchbox.markets`, a custom domain) is documented to work; the
`v2preview` Worker on workers.dev, which Pro and Stuart bind to, is not
documented either way. The proxy is correct without it (memory, coalescing
and the budgets above), only less efficient.

**Post-deploy test** (needs a deploy; not run):

1. Pick a slow route nobody else is reading, e.g.
   `stats/charts/market`, and wait out its TTL (15 min) or redeploy so no
   isolate holds it.
2. Run `wrangler tail matchbox-api-v2-preview --format json --search
"Blockscout proxy answer"` (add `--env` as needed) in one terminal.
3. Public path (workers.dev): with `INTERNAL_TOKEN` set on the preview, run
   30 requests in parallel, e.g.
   `seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -D - -H "Authorization: Bearer $TOKEN" https://matchbox-api-v2-preview.mallard.workers.dev/internal/blockscout/api/v2/stats/charts/market | grep -i x-cache`.
4. Read the result: exactly one `miss` and the rest `edge` or `memory`
   means the Cache API works. Several `miss`, one per isolate, and no
   `edge` means it is a no-op on that host.
5. Binding path: do the same through a bound Worker (Scan or Stuart
   calling the proxy) and count `cache` values in the tail. Same reading.
6. Repeat on `api.matchbox.markets` once the proxy is deployed there.

## Scan read routes (`/internal/scan/*`)

Matchscan's reads (`src/scan/`), behind the `/internal` gate like every
internal route; answers carry no CORS headers. Rows come from `SCAN_DB`
(`matchbox-scan`, schema in `apps/jobs/scan-migrations`, written by
matchbox-jobs); live Borrow state and Pro's gauge documents come from
`READ_DB`. Response schemas: `@matchbox/contracts/scan` (`api.ts`, series
registry `series.ts`, row schemas `rows.ts`).

Every handler is primary-key lookups or one range scan of a named index,
from one statement registry (`src/scan/queries.ts`). A test runs `EXPLAIN
QUERY PLAN` on each against the real schemas and fails on a full scan or a
temporary sort (`src/scan/queries.workers.test.ts`). Amounts are base-unit
integer strings, summed in code with bigint where summed at all; nothing
casts an amount in SQL, and no route adds two series together except
`/borrow/totals`, which adds MUSD closes day by day (Borrow totals).

### For the Scan frontend

- **Lists** are `{ data, nextCursor, meta: { skipped } }`. Pass
  `nextCursor` back as `cursor`; `limit` is 1 to 100 (default 25). Cursors
  are opaque, name their list and are checked against its key shape: a
  cursor from another list, a tampered or partial one is a 400. There are
  no offsets. `skipped` counts stored rows of the page that failed their
  schema: they are left out and logged (table and primary key) instead of
  failing the list. A page whose every row is bad ends the list there.
- **Documents** are `{ data }`; aggregates and series add `meta: { complete, asOf, aggregatesComplete, historyFilled, stale, refillPending, skipped }`
  (below; `complete` is false while any row was skipped).
- **Errors** are the platform error body: 400 `invalid_request` (unknown,
  repeated or malformed query parameter, bad cursor, oversized page), 404
  `not_found` (malformed path parameter or no such entity), 429
  `rate_limited` with `Retry-After`, 503 `service_disabled` (database not
  bound), 500 `internal_error` (a single-row read whose row failed its
  schema; logged).
- **Headers**: `X-Cache` (`memory`, `edge`, `miss`), `X-Scan-Class` (the
  cache class), `Cache-Control` from the class, a strong `ETag` and 304 on
  `If-None-Match`.
- **Caller identity**: the same `X-Matchbox-Client` and
  `X-Matchbox-End-User` headers as the Blockscout proxy
  (`@matchbox/contracts/blockscout`, `callers.ts`). A malformed one is a 400.
- **Composed documents** degrade per part: each part is
  `{ status: "ok", data }` or `{ status: "unavailable", reason }` with
  `reason` one of `not_found`, `rate_limited`, `upstream`, `schema`,
  `invalid`, `disabled`. The document itself always answers 200, SCAN_DB
  unbound or failing included (its parts are then `disabled` or
  `upstream`).
- **Orderings**: `/locks?order=unlock` is timed locks soonest first, then
  permanent locks, then live locks with no unlock time, each by token id;
  `order=created` is newest first, then the locks with no creation time
  (the early locks) by token id; `order=amount` is largest first, ties by
  token id. A gauge's voters are by weight, then token id, then escrow.

### Routes

| Route                                                                | Source                                                                                       | Index (plan)                                                                                                     | Class                                      |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `GET /activity`                                                      | `activity`                                                                                   | `activity_time`                                                                                                  | run                                        |
| `GET /activity/tx/{hash}`                                            | `activity`                                                                                   | `activity_tx`                                                                                                    | run                                        |
| `GET /activity/address/{address}?role=actor\|recipient\|sender\|any` | `activity`                                                                                   | `activity_actor`, `activity_recipient`, `activity_tx_from` (three range scans, merged, each row once)            | run                                        |
| `GET /activity/gauge/{gauge}`                                        | `activity`                                                                                   | `activity_gauge`                                                                                                 | run                                        |
| `GET /activity/lock/{escrow}/{tokenId}`                              | `activity`                                                                                   | `activity_lock`                                                                                                  | run                                        |
| `GET /activity/epoch/{start}`                                        | `activity`                                                                                   | `activity_epoch`                                                                                                 | run                                        |
| `GET /activity/action/{ACTION}`                                      | `activity`                                                                                   | `activity_action`                                                                                                | run                                        |
| `GET /locks?escrow=vebtc\|vemezo&order=amount\|unlock\|created`      | `locks`                                                                                      | `locks_by_amount`, `locks_by_unlock` (live locks), `locks_by_created`                                            | run                                        |
| `GET /locks/{escrow}/{tokenId}`                                      | `locks`; Mezo RPC (one lock, once a minute per data centre)                                  | primary key                                                                                                      | brief (1 min)                              |
| `GET /locks/{escrow}/{tokenId}/votes`                                | `lock_votes`                                                                                 | `lock_votes_lock`                                                                                                | run                                        |
| `GET /owners/{address}/locks`                                        | `locks`                                                                                      | `locks_owner`                                                                                                    | run                                        |
| `GET /owners/{address}/votes?epoch=`                                 | `locks` joined to `lock_votes`                                                               | `locks_owner` then `lock_votes_lock` (a per-lock sort until `locks_owner_lock` exists)                           | run (aggregate version)                    |
| `GET /gauges`                                                        | READ_DB `read_models` `gauges`                                                               | primary key                                                                                                      | doc                                        |
| `GET /gauges/{gauge}`                                                | READ_DB `read_models` `gauge-profile`                                                        | primary key                                                                                                      | doc                                        |
| `GET /gauges/{gauge}/voters?epoch=`                                  | `lock_votes`                                                                                 | `lock_votes_gauge_weight`                                                                                        | run                                        |
| `GET /gauges/{gauge}/incentives`                                     | `incentive_deposits`                                                                         | `incentive_deposits_gauge`                                                                                       | run                                        |
| `GET /gauges/{gauge}/epochs`                                         | `gauge_epoch`                                                                                | primary key (gauge, epoch)                                                                                       | run                                        |
| `GET /depositors/{address}/incentives`                               | `incentive_deposits`                                                                         | `incentive_deposits_depositor`                                                                                   | run                                        |
| `GET /epochs`                                                        | `epoch_totals`                                                                               | integer primary key                                                                                              | run                                        |
| `GET /epochs/{start}`                                                | `epoch_totals`, `gauge_epoch`, deposits                                                      | primary key; `gauge_epoch_rank` (5 per source); `incentive_deposits_epoch`                                       | long when sealed, else run                 |
| `GET /epochs/{start}/gauges?source=`                                 | `gauge_epoch`                                                                                | `gauge_epoch_rank` (ranked rows; killed gauges, unranked, in `killed` from the same index)                       | long when sealed, else run                 |
| `GET /epochs/{start}/incentives`                                     | `incentive_deposits`                                                                         | `incentive_deposits_epoch`                                                                                       | long when sealed, else run                 |
| `GET /borrow/markets`, `/borrow/markets/{id}`                        | READ_DB `morpho_markets`                                                                     | primary key                                                                                                      | live                                       |
| `GET /borrow/markets/{id}/positions`                                 | READ_DB `morpho_positions`                                                                   | primary key (network, market, account)                                                                           | live                                       |
| `GET /borrow/markets/{id}/events`                                    | `morpho_events`                                                                              | `morpho_events_market`                                                                                           | run                                        |
| `GET /borrow/markets/{id}/positions/{account}/events`                | `morpho_events`                                                                              | `morpho_events_position`                                                                                         | run                                        |
| `GET /borrow/owners/{address}`                                       | READ_DB positions, markets, troves; `enclave_events`                                         | `morpho_positions_account`; primary keys; `enclave_events_borrower`                                              | live + run                                 |
| `GET /borrow/enclave/positions/{id}/events`                          | `enclave_events`                                                                             | `enclave_events_position`                                                                                        | run                                        |
| `GET /borrow/enclave/borrowers/{address}/events`                     | `enclave_events`                                                                             | `enclave_events_borrower`                                                                                        | run                                        |
| `GET /borrow/enclave/positions`                                      | `enclave_events`                                                                             | `enclave_events_position` (one range: a page of positions with their events)                                     | run                                        |
| `GET /borrow/enclave/locks/{tokenId}`                                | `enclave_events`                                                                             | `enclave_events_lock`, then `enclave_events_position` per position (up to 5)                                     | run                                        |
| `GET /borrow/troves`                                                 | READ_DB `troves` (open)                                                                      | `troves_status` (apps/jobs/migrations/0004)                                                                      | live                                       |
| `GET /borrow/troves/{owner}`                                         | READ_DB `troves`                                                                             | primary key                                                                                                      | live                                       |
| `GET /borrow/troves/{owner}/events`                                  | `trove_events`                                                                               | `trove_events_borrower`                                                                                          | run                                        |
| `GET /borrow/liquidations`                                           | `trove_events`, `morpho_events`                                                              | `trove_events_action`, `morpho_events_action` (two range scans, merged; items carry `kind`: `trove` or `morpho`) |
| `GET /borrow/redemptions`                                            | `trove_events`                                                                               | `trove_events_action`                                                                                            | run                                        |
| `GET /borrow/events?limit=` (1 to 25, default 10)                    | `trove_events`, `morpho_events`, `enclave_events`                                            | `trove_events_time`, `morpho_events_time`, `enclave_events_time` (three range scans, merged; items carry `kind`) | run                                        |
| `GET /borrow/stability-pool`                                         | READ_DB `stability_pool`                                                                     | primary key                                                                                                      | live                                       |
| `GET /borrow/totals`                                                 | READ_DB troves, markets; `enclave_events`; `daily`                                           | `troves_status`; primary keys; `enclave_events_position` (one row per position); `daily` primary key             | live + data version                        |
| `GET /series?metric=&dimension=&from=&to=`                           | `daily`                                                                                      | primary key (metric, dimension, day); first and last day by the same key                                         | long for past ranges, else 30-minute slot  |
| `GET /series/split?metric=&from=&to=`                                | `daily`, every dimension                                                                     | `daily_by_day` (metric, day, dimension), one range backwards, up to 6,000 rows                                   | as `/series`                               |
| `GET /markets?days=`                                                 | `daily` (three splits), `price_daily`                                                        | `daily_by_day` backwards (each split), `price_daily` primary key                                                 | run (aggregate version, 30-minute slot)    |
| `GET /prices/{btc\|mezo}?from=&to=`                                  | `price_daily`                                                                                | primary key                                                                                                      | long for past ranges, else hourly slot     |
| `GET /status`                                                        | `scan_status` (or `scan_runs`)                                                               | primary key                                                                                                      | run, plus the row's `updated_at`           |
| `GET /tokens`                                                        | `daily` (`token.total_supply`, `token.holders`), KV prices                                   | primary key, one D1 batch                                                                                        | run (aggregate version and the live slot)  |
| `GET /validators`                                                    | `daily` (`chain.blocks_proposed`, `_total`), Pro's gauge directory                           | `daily_by_day`; primary key                                                                                      | run (aggregate version and directory etag) |
| `GET /uptime`                                                        | the `uptime_*` tables                                                                        | primary keys; `uptime_hourly_hour`, `uptime_daily_day`                                                           | live (height and minute)                   |
| `GET /validators/{address}/uptime`                                   | the `uptime_*` tables                                                                        | primary keys                                                                                                     | live (height and minute)                   |
| `GET /labels?address=a,b,...` (up to 50)                             | `labels`                                                                                     | primary key (IN)                                                                                                 | run                                        |
| `GET /labels/search?q=&by=name\|address`                             | `labels`                                                                                     | `labels_name`, primary key (prefix ranges)                                                                       | run                                        |
| `GET /search?kind=name\|address\|address-prefix\|epoch\|lock&q=`     | `labels`, READ_DB `gauges`, `epoch_totals`, `locks`                                          | prefix ranges, primary keys                                                                                      | run                                        |
| `GET /mezo-ids/{Mezo ID, address or BTC}`                            | Mezo's accounts API                                                                          | none (one upstream lookup, 2.5 s deadline)                                                                       | long if found, else brief (1 min)          |
| `GET /mezo-ids?addresses=a,b,...` (up to 100)                        | the found answers `/mezo-ids/{key}` stored                                                   | none (memory, then the Cache API, per address)                                                                   | none (answered `max-age=60`)               |
| `GET /entities/tx/{hash}`                                            | proxy + `activity` + `labels`                                                                | `activity_tx`; labels primary key                                                                                | long when final, else head                 |
| `GET /entities/address/{address}`                                    | proxy + `labels`, `locks` (with Mezo RPC, once a minute per data centre), Borrow, `activity` | as the routes above                                                                                              | head                                       |
| `GET /entities/block/{height or hash}`                               | proxy + `labels`                                                                             | labels primary key                                                                                               | long when final, else head                 |

`/mezo-ids/{key}` takes a Mezo ID (`alice.mezo`, any case; letters, digits
and hyphens, up to 63 before `.mezo`), an address, or a mainnet Bitcoin
address (`1…` or `3…` in base58, `bc1q…` or `bc1p…` in bech32; testnet is
refused), asks Mezo's accounts API (`/accounts/{key}`) and answers
`{ data: { status: "found", mezo_id, wallets, btc_address } }`,
`not-found`, or `unavailable` (Mezo's API down or past its deadline,
answered `no-store`, so Matchscan's search offers its other readings).
Mezo's API matches exactly, with no prefix search: IDs and bech32 are
looked up lower case, base58 exactly as typed. Anything else in the path is
a 404 before any upstream request. It needs no database.

Ownership is checked both ways. `wallets` is the account's own wallet only:
its one linked account of type `wallet`, never another linked account and
never the zero address. An ID is found only when Mezo's answer names that
same ID (`mezoId`) and the account has exactly one such wallet. An address
is named only when it is that wallet. Anything else is `not-found`. A found
ID also stores its wallet's answer (`/mezo-ids/{wallet}`), so the address
reads as that ID, but only when the address has no answer of its own (a
stored ID, or this minute's "no ID").

For an ID or an address, `btc_address` is the Bitcoin address Mezo links
with the account's own wallet, or null. A Bitcoin address leads to the EVM
address of the linked account whose Bitcoin address is exactly the key
(`wallets`, one address); `mezo_id` is the account's ID only when that EVM
address is the account's own wallet, and then the wallet's answer is stored
as for an ID. No such account, one with no usable EVM address, or two
linked accounts naming different EVM addresses is `not-found`. A found
Bitcoin address is kept a day, a miss a minute. Answers stored before
`btc_address` existed leave it out until they expire (a day).

Mezo answers some addresses with HTTP 500 and
`{"error":"Account has no Mezo ID"}`: that is read as `not-found` and kept
like any miss. Every other 5xx is `unavailable`.

`?fresh=1` skips every stored answer, asks Mezo and is answered
`private, no-store`. Pro reads an ID this way when a transfer to it reaches
its review, since an ID can be pointed at another wallet. What a fresh read
of an ID learns is stored, as the newest answer from Mezo:

- found: it replaces the ID's stored answer, so later reads (Pro's display
  lookup, Matchscan) show the wallet funds would go to, and its wallet gets
  the reverse answer where that address has no answer of its own;
- not found: the ID's stored answer is dropped;
- when the ID's wallet changed, the old wallet's stored answer is dropped
  if it still names the ID, so no list shows two wallets under one ID;
- unavailable: nothing changes.

This reaches the data center's Cache API and the isolate that served the
read; another isolate keeps what it holds in memory until it is recycled.

`/mezo-ids?addresses=` answers `{ data: { [address]: mezo_id } }` with the
IDs already cached for those addresses, from this isolate's memory or the
Cache API, and leaves the rest out. It never asks Mezo's API, never spends
a rate-limit bucket and reads no database, so Matchscan's lists can call it
once per page. The cache fills from `/mezo-ids/{address}` (the address
page) and `/mezo-ids/{Mezo ID}` (search, `/address/alice.mezo` and Pro's
`/alice.mezo` links), a day per data center.

`/borrow/events` is the homepage's "Latest borrowing": the newest events
of every venue, merged newest first by (timestamp, block, log), with no
cursor. An Enclave event pledging several veBTC is one row per lock in
`enclave_events`; the route reads four rows per item asked and keeps one
per event.

`{escrow}` takes `vebtc`, `vemezo` or the escrow address. `{start}` is an
epoch start (a multiple of a week). `/gauges/{gauge}/voters` defaults to the
current epoch. Locks lists show live locks (not withdrawn or merged) by
amount and unlock, and every lock by creation. Activity's ties on (block,
log) are broken by rowid.

Measured plans (all `SEARCH`, none with a temporary B-tree), for example:
`activity_time ((timestamp,block_number,log_index)<(?,?,?))`,
`activity_actor (actor=? AND (block_number,log_index)<(?,?))`,
`locks_by_amount (escrow=? AND amount_key<?)` (the partial index is used
because the query repeats `is_withdrawn = 0 AND is_merged = 0`),
`lock_votes_gauge_weight (epoch_start=? AND gauge=? AND weight_key<?)`,
`gauge_epoch_rank (epoch_start=? AND source=? AND rank>?)`,
`epoch_totals USING INTEGER PRIMARY KEY (rowid<?)`, and
`daily USING PRIMARY KEY (metric=? AND dimension=? AND day>? AND day<?)`.

### Borrow figures

Health is computed at read time from the live snapshot's state, all in
bigint. Troves use `@matchbox/domain`'s LiquityMath port
(`collateralRatio`, `liquidationPrice`, `bandFor`) with mUSD's 110% MCR and
150% CCR: ICR, LTV, health factor (ICR over MCR), liquidation price in USD
per BTC and a band. They are priced as the protocol prices them, with
MUSD's PriceFeed price (`fetchPrice()`), which the live snapshot stores on
the `stability_pool` row (`musd_btc_price_raw`, `_scale`, `_block`;
apps/jobs/migrations/0005), not the market price. Each trove says so:
`health_basis: { source: "price_feed", btc_usd, estimate: false, block }`.
Any of the three columns may be NULL (a reverted read, a row from before
the migration): with no raw price or no scale the trove's band is
`unknown`, its ratios null and `btc_usd` null. The market price never
stands in for it. The liquidation price needs no price and is always
given. The owner document's `btc_usd` stays the market price (for USD
values), and is not what troves are banded at.

A stale PriceFeed price bands troves `unknown` too. Every live run writes
the price and `musd_btc_price_block` right after the batch that rewrites
troves and the pool (5785d87), while those rows' `block` moves only when
their values change, so it is never newer than the latest run's. A price
block older than the trove's or the pool's therefore means a later run
wrote them and then failed to write the price: stale, by an exact rule
with no threshold. The pool is the better witness of a later run (it
changes most runs), so the reference is the newer of the two. The
protocol prices with a current price, so no band is claimed;
`health_basis` says why (`stale`, `lag_blocks`) and still shows the old
price and block. A stopped snapshot freezes every Borrow row, not the
price alone, and is not judged here. The API must not be deployed ahead
of a jobs Worker that predates 5785d87: under the old writer an unchanged
price kept an old block and would read as stale.

Morpho positions use Morpho Blue's share maths (virtual shares 1e6, borrow
rounded up) and the market's oracle price at 1e36 scale: assets, LTV,
health factor (collateral value times LLTV over debt) and liquidation
price in oracle units; interest accrued since the snapshot is not
included. A position with debt and no oracle price is `unknown`, never
`healthy`. That Morpho maths lives in `src/scan/borrow-math.ts` because
`@matchbox/domain` has none yet; it should move there. Ratios are
1e18-scaled integer strings. Enclave positions carry no health (their own
minimum and warning ratios are not read).

Every Morpho market the jobs Worker reads is served: the ones configured
in `@matchbox/chain` and those discovered from `CreateMarket` logs (READ_DB
`morpho_known_markets`, migration 0006); the lists, the owner document,
positions and liquidations read whole tables, so a discovered market
needs no API change. Each market carries `loan_decimals` and
`collateral_decimals`: the tokens' `decimals()` read on chain when the
market was discovered, else the API token registry, else null (amounts
are raw base units; never 18 by default). Before migration 0006 the
registry alone answers. Market series take their decimals the same way.

### Enclave positions

`/borrow/enclave/positions` lists Enclave positions in position id order,
each summed from its `enclave_events` rows
(`scanEnclavePositionSummarySchema`): enclave, borrower, `status` (`closed`
once the latest event is `POSITION_CLOSED`), `principal` (after the latest
event, "0" once closed), `minted` (the `POSITION_OPENED` amount plus every
`DEBT_INCREASED`), `repaid` (every `DEBT_REPAID`), the veBTC pledged now
and every veBTC it has pledged, and when it opened and last changed.
Amounts are MUSD base units summed with bigint. A page reads at most 1,000
event rows: a position the budget cut is left to the next page, unless it
is the only one, which is then summed from the rows read with `minted`,
`repaid` and `opened` null (`complete: false`). The cursor names the last
position.

`/borrow/enclave/locks/{tokenId}` answers `{ data: { token_id, positions
} }`: the positions that veBTC has been pledged to, newest first (its 50
newest rows, up to 5 positions, each from its 300 newest events; empty
when it never was). A debt row names only a position's lowest veBTC, so
positions are found through the rows that pledged the token. The lock
backs a position now when the position's `pledged_ve_btc` holds its id.

Not served: live Enclave debt with interest and the collateral ratio.
EnclaveDebtManager accrues interest with no event and no job reads
`getTotalOutstandingDebt()` or the position's collateral value yet.

### Borrow totals

`GET /internal/scan/borrow/totals` is the homepage's "Borrowed" figure:
what borrowers owe across Mezo's three borrow venues, in **one unit, MUSD**
(base units, 18 decimals from the token registry), summed in bigint.
Schema: `scanBorrowTotalsResponseSchema` (`@matchbox/contracts/scan`,
`borrow-totals.ts`). It takes no query parameters.

| Venue      | Source                                                            | `basis`                   | Counts                                               |
| ---------- | ----------------------------------------------------------------- | ------------------------- | ---------------------------------------------------- |
| `troves`   | READ_DB `troves`, status `active` (live snapshot)                 | `principal_plus_interest` | principal and interest as the snapshot read them     |
| `enclaves` | `enclave_events`, each position's latest event                    | `principal`               | principal after that event; 0 once `POSITION_CLOSED` |
| `markets`  | READ_DB `morpho_markets` whose loan token is MUSD (live snapshot) | `total_borrow_assets`     | interest accrued up to the market's last update      |

What it leaves out, and why:

- **Markets lending another token** (BTC / mUSDC today) are listed under
  `venues.markets.data.excluded` with `reason: "loan_token"`, their raw
  `borrowed` amount and `loan_decimals`, and are never added. There is no
  mUSDC price source, and a stablecoin is never taken as $1, so they cannot
  be stated in MUSD. A MUSD market whose decimals do not resolve to 18 (the
  chain read says otherwise, or nothing knows) is excluded with
  `reason: "decimals"`.
- **Enclave interest.** EnclaveDebtManager accrues it with no event, and
  no snapshot reads `getTotalOutstandingDebt()`, so Enclave debt is
  principal only (on 9 Nov 2026, 4,000,000 of 4,012,641 MUSD).
- **Nothing is priced.** The figure is MUSD, not USD: the API has no MUSD
  price, only the registry's `usd` pricing, which is a $1 assumption.
- PCV's bootstrap debt is protocol debt, not a borrow venue.

`total` is troves plus Enclaves plus MUSD markets, or **null** when any
venue is unavailable; `missing` names those venues. It is never the sum of
the venues that answered. `enclaves_share` is Enclave debt over `total`,
1e18 = 100% and rounded down, null without a total (or with a total of 0).

Each venue and `history` degrade alone, as the composed documents do:
`{ status: "ok", data }` or `{ status: "unavailable", reason }`, with the
composed reasons plus `incomplete` for a bounded read that did not reach
the end (more than 25 Enclave positions, more than 1,000 open troves). A
row that fails its schema makes its venue `schema`, never a smaller sum.
The answer is always 200 and carries the live `snapshot`, as every live
Borrow answer. An answer with an `upstream` or `schema` part is served
`private, no-store`; `disabled` and `incomplete` hold for everyone and are
stored.

`history` is 30 points, oldest first, the last one today: `troves` is the
`musd.trove_debt` close, `markets` the sum of `morpho.total_borrow` closes
of today's MUSD markets, `enclaves` the principal after each position's
last event before the UTC day ended (read from `enclave_events`; a
position before its first event owed nothing). A point's `total` is null
when any of the three is unknown that day (a level series has no row):
the gaps are shown, never filled. Today's point is the live total,
`partial: true`; other points are `partial` when a close was marked
partial or the day is in `scan_dirty`. This is the one route that adds
series together, and only closes of the same unit and definition as the
live figures.

`collateral` (since 14 Nov 2026; absent from older answers) is the BTC
behind the loans, in BTC base units (18 decimals), for the homepage's "BTC
collateral" and "Open positions": `troves` the open troves' `coll`,
`enclaves` the veBTC amount of each live lock the open Enclave positions
pledge (one `locks` primary-key read per lock), `markets` the collateral
of every position in the MUSD markets Borrowed includes whose collateral
token is BTC (`morpho_positions`, by market, up to 300 per market, else
`incomplete`), `total` their sum, and `open_markets` those markets'
positions that owe anything: the tiles count what Borrowed counts. Troves
and markets come from the reads behind their debt. It degrades alone, like the venues; a
BTC market whose collateral decimals nothing knows makes it `incomplete`.

Example, illustrative and abridged (the venues as the research of 9 Nov 2026
found them, `docs/research/mezo-borrow-markets.md`):

```text
{
  "data": {
    "unit": { "symbol": "MUSD", "token": "0xdd468a1d…f186", "decimals": 18 },
    "total": "4055533000000000000000000",
    "missing": [],
    "enclaves_share": "986306855350455784",
    "venues": {
      "troves": { "status": "ok", "data": { "basis": "principal_plus_interest", "debt": "55533000000000000000000", "open": 3, … } },
      "enclaves": { "status": "ok", "data": { "basis": "principal", "debt": "4000000000000000000000000", "open": 1, "positions": 4, … } },
      "markets": {
        "status": "ok",
        "data": {
          "basis": "total_borrow_assets",
          "debt": "0",
          "included": [{ "market_id": "0x29c2a844…6707", "loan_token": "0xdd468a1d…f186", "borrowed": "0", "loan_decimals": 18 }],
          "excluded": [{ "market_id": "0x6f88e79e…33db", "loan_token": "0x04671c72…c197", "borrowed": "62710840000", "loan_decimals": 6, "reason": "loan_token" }]
        }
      }
    },
    "history": { "status": "ok", "data": { "from": "2026-10-11", "to": "2026-11-09", "points": [{ "day": "2026-10-11", "total": null, "troves": null, "enclaves": "14500000000000000000000000", "markets": null, "partial": false }, …] } }
  },
  "snapshot": { "block": 13098400, "head": 13098465, "behind_blocks": 65, "stale": false, "max_behind_blocks": 240 }
}
```

**Reads.** Per render, today (3 open troves, 2 markets, 4 Enclave
positions, 1 with events in the window): READ_DB `markets` (2 rows),
`knownMarkets` (2), `openTroves` (one statement per 100 open troves,
reading one row past the page: 3); SCAN_DB `enclaveNextPosition` (positions
plus one statements, one row each: 4), `enclaveByPosition` only for
positions with an event in the window (pages of 100, at most 3), and
`dailyRange` for `musd.trove_debt` and each MUSD market (at most 29 rows
each). The status row, `scan_dirty` and the snapshot's `stability_pool`
row are memoised and shared with every other route. About 12 statements
and under 100 rows. Bounded at 10 trove statements, 26 position
statements and 3 event pages per position with an event in the window.

**Cost of the homepage's polling.** The answer is `live`: keyed by the
five-minute snapshot slot, the Scan data version (Enclave events and
closes come from SCAN_DB) and the UTC day; `Cache-Control: public,
max-age=60`. Read every 30 seconds behind the homepage's edge cache, it
renders once per slot (or data change) per isolate and colo; every other
request is a memory or Cache API hit, reads nothing and spends no rate
limit.

### Killed gauges

The aggregates leave a gauge killed as of the epoch's end unranked (`rank`
null) and never a top gauge, but keep its weight. Scan shows them rather
than hiding them: every gauge-epoch item carries `killed` (the row's 0 or 1); an epoch item
carries `killed_weight` ({voter source: weight}, also inside `vote_weight`);
`/epochs/{start}/gauges` adds `killed`, that source's killed gauges with
their weight; and the epoch document adds `killedGauges` per source.

### Aggregates still filling, and status

`epoch_totals` and `gauge_epoch` are recomputed over several ticks, and
copy runs can fail or wait for a re-fill. Every epoch, ranking, gauge
history and series response carries `meta`:

- `complete`: this response's own rows are computed (no epoch or day of
  it in `scan_dirty`, no point the jobs Worker marked `partial`).
- `aggregatesComplete`: nothing anywhere waits for its aggregates
  (`scan_status.aggregates_complete`).
- `asOf`: `scan_status.last_ok_at`, when a copy run last changed the data.
- `historyFilled`: the one-time history fill has been applied.
- `stale`: copy runs are failing (`consecutive_failures` > 0) or the
  copy has halted a table (`halted_tables` not NULL: that table's rows
  stop moving). The data lags the chain. No error text or reason reaches
  the body.
- `refillPending`: a re-fill is required (`refill_required`): figures may
  disagree until it is done, but they are not behind. `/status` says the
  same as `refillRequired`, beside `stale`. Before this field `stale`
  counted a pending re-fill too.

Items carry their own `complete` (per epoch, from `scan_dirty`). An epoch
with no row yet answers `{ data: null, meta: { computed: false } }`: not
computed yet, which is not an epoch with zero votes. A start before Epoch 0
or in the future is a 404. Series points carry `partial` when the jobs
Worker marked the day (`daily.partial`), for today, and for days in
`scan_dirty` when the copy step's day aggregates write the metric
(`scanMetricRecomputed`: its note's source is the copy step). A dirty day
cannot change a live close, a subgraph day, a counter or a backfill, so
re-aggregating the trove history (thousands of dirty days at once) leaves
those series, and `/series/split` and `/markets`, whole and long-cached.

An epoch is sealed (kept a day) only when it has ended, the history fill
is applied (`history_filled` 1), its totals row exists, it is not in
`scan_dirty`, nothing is stale or awaiting a re-fill, and a copy run finished an hour after its
end. Even then an answer is kept a day only when whole: one that says
`computed: false` or skipped a bad row is stored under the versioned key,
as `run`. Without a status row nothing is sealed.

A list that skipped a bad row says so in `meta.skipped`, and its
`complete` is false. Paging steps over bad rows: the cursor is the key of
a page's last row, read from its key columns when the row itself fails
its schema, so a whole page of bad rows still leads on to the rows after
it, and each bad row is counted once.

All of this comes from the `scan_status` row (scan-migrations 0002, 0003).
Only when that table does not exist yet, or holds no row, does the API
fall back to the newest `ok` scan_runs row, with `aggregatesComplete` and
`historyFilled` null (unknown), never false. Any other failure to read
it (a D1 error, a row that fails its schema) is an error: lists answer
500 and composed documents answer `private, no-store`, so nothing is
cached against a version nobody read. `GET /internal/scan/status` returns
the same fields for the shell, plus the run counts (`lastRunStatus`,
`lastRunAt`, `consecutiveFailures`, `copiedThrough`, `dirtyEpochs`,
`dirtyDays`, `refillRequired`, `quarantinedRows`), `halted` and
`haltedTables` (the stopped tables' names; their reasons stay in the jobs
Worker's logs) and `source` (`status` or `runs`).

### Series

`/series` validates `metric` and `dimension` against the one registry in
`@matchbox/contracts/scan` (`series.ts`, which the jobs Worker writes to) at
request time; the route names no metric, so a renamed or dropped metric is
a 400 with no API change. The answer describes the series from the
registry (`unit`, `decimals` as a number or `token`, `kind` flow or level,
`signed`), `resolvedDecimals` and `token` (for `token` decimals: the
dimension's token, or a Morpho market's loan token, its collateral token
for collateral metrics, with its decimals from the token registry; null
for an unknown token or a total across tokens or markets), and `note`
(`scanMetricNotes`: definition, source, first day),
lists the points in the range with `partial` flags, and gives `firstDay`
and `lastDay` present anywhere plus `endsOn` for a series with no live
writer (backfill only). Dimensions follow their kind, including
`token-destination` (`<token>:ethereum` or `<token>:bitcoin`). Ranges are at
most 732 days. No route adds two series together except `/borrow/totals`
(Borrow totals, above).

`/series/split` (since 15 Nov 2026) answers every dimension of one
metric over a range from one range scan, for charts of every pool or
token together: a token metric (the per-token rollups
`pool.token_balance` and `dex.token_volume_in`, and the other token
series) over up to 732 days, or a pool-token metric over a week (two
rows per pool a day: "MUSD in each pool now"). Each series carries its
dimension, its token with symbol and `resolvedDecimals`, and its points
with `partial` as `/series` marks them; nothing is added across series.
At most 6,000 rows, read newest first: past that the answer starts the
day after the cut (`from`), so every day it serves is whole and the
newest are always there, and says `truncated`. Totals,
markets and the other kinds are a 400 (use `/series`). Cached as
`/series` (`long` once settled). Schema: `scanSeriesSplitSchema`.

`/markets?days=` (since 15 Nov 2026) is Network's TVL and DEX volume in
one call instead of six: `balances` (`pool.token_balance` over `days`),
`volume` (`dex.token_volume_in` over at least 31 days, for its 30-day
figure), `pools` (`dex.volume_in` per pool over the last three days, for
the last whole day's pools), each a `/series/split` answer, and
`prices.btc` and `prices.mezo` (the daily closes over the longer range).
`days` is 1 to 732. Keyed by the aggregate version and a 30-minute slot;
never `long`. A miss reads the last three days; the days before them
(balances, volume and closes) are read apart and, once every point in
them is whole and the copy has passed them, kept a day under a
version-free key (`/internal/scan/markets/settled?days=&to=`), as
`/series` keeps a settled range. So a new data version, which moves with
almost every copy run, costs about 30 rows, and the full period (up to
about 12,000 rows at `days=730`, about 700 at the default 30) is read
about once a day per period. Schema: `scanMarketsSchema`.

### Caching

A per-isolate memory (a byte-budgeted LRU, 8 MiB, entries over 256 KiB
left to the edge, as the proxy's) and the Cache API (namespace `scan`) in
front of every handler. The key is the canonical request plus the version
of the data it reads, so an entry stops being used when the data changes,
not on a timer:

| Class  | Key version                                                                                                                                                                                                                                                                   | Cache-Control           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `run`  | `scan_status.last_ok_at`, its stale, aggregates-complete and history-filled flags, and `data_version` where it exists (re-read every 5 s); without the row, the last `ok` scan_runs row. Never `last_run_at`. Aggregates and series also key on the aggregate version (below) | `public, max-age=30`    |
| `long` | none: whole answers for sealed epochs (above), settled series ranges (below), final composed documents                                                                                                                                                                        | `public, max-age=86400` |
| `live` | the live snapshot's five-minute slot (READ_DB is rewritten by the `*/5` cron)                                                                                                                                                                                                 | `public, max-age=60`    |
| `head` | the BlockHub head and the copy run (composed documents)                                                                                                                                                                                                                       | `public, max-age=3`     |
| `doc`  | the Pro document's etag and `updated_at` (that version row memoised for 5 s)                                                                                                                                                                                                  | `public, max-age=60`    |

- **Aggregate version**: epochs, an epoch's document, ranking and
  incentives, a gauge's epochs and voters, and series key on
  `scan_status.data_version` (scan-migrations 0003: bumped with any change
  to a served row, skipped runs included). Before that column exists, on
  `scan_status.updated_at`, which every run moves.
- **The clock**: an answer that reads it keys on what it read. A gauge's
  voters with no `epoch` key on the epoch they resolved to; the epochs
  list and unsealed epoch documents on the epoch "now" is in (`sealed`,
  and the 404 before an epoch starts).
- **Series and prices** are `long` only when settled: the range ends
  before the day of `scan_status.copied_through` minus one, the status is
  not stale, and no point is partial (known once rendered; the long key is
  read first). Otherwise they key on the aggregate version and a 30-minute
  slot (prices hourly), the closing-value and price writers' cadence; a
  slot boundary is also a UTC midnight. Without a status row nothing is
  `long`.
- **Labels** key on the canonical address set (lower case, sorted, each
  once). Name search also keys on the gauge directory's etag.

### Composed documents

One subrequest per Scan page. Each reads Blockscout through the proxy's
own code path (`BlockscoutProxy.handle`: its allowlist, cache classes and
budgets, with the caller's identity) and merges our rows:

- **Transaction**: the proxy's transaction, logs and token transfers,
  our decoded activity rows for the hash, and labels for every address in
  any part. `final` (kept a day under a version-free key) once every
  Blockscout part is immutable or final, the activity part read, and the
  copy checkpoint (`scan_cursors` `copy:activity`) is past the
  transaction's time. Until the copy is, the document also carries
  `live` (below).
- **Address**: the proxy's address and counters, its first 25 locks, open
  Borrow positions (Morpho, trove, Enclave), the first page of activity,
  and labels: its own (`label`) and those of the addresses its parts name
  (`labels`), the address first. Never final. Matchscan waits 3 s for
  it, so every deadline counts from the request's arrival: the copy run's
  version and the head 0.3 s (for every document), the locks' chain read
  2.2 s, every part 2.3 s (`composedPartsMs`) and the labels 2.6 s
  (`composedLabelsMs`). What comes before the render (those two reads, two
  edge lookups of at most 0.2 s each, `scanLookupMs`, and the rate-limit
  call, at most 0.25 s, `scanSpendMs`) takes from the parts' time rather
  than adding to it, and 0.4 s is left for encoding and the hop. A part
  still running then is `upstream` (the document is not stored) and
  finishes in the background, ready for the next request, while the other
  parts are served. A document that took 1.5 s or more from arrival logs
  `Composed document slow` with each part's time, whether it was cut, and
  the time before the render.
- **Block**: the proxy's block and its transactions, with labels for the
  proposer (`miner`) and every address in the transactions. Final as the
  transaction document is.

Labels cover at most 50 distinct addresses per document, the first in
document order (transaction, logs, transfers, our rows; the proposer
first on a block; the address itself first, then summary, locks, borrow
and activity on an address). All three documents say so: `labelLimit: 50` and
`labelsTruncated` when more were named. Scan labels the rest, if it
wants, with `/labels` (50 a call).

Which documents are shared: a document is stored (under the head key, or
the final key once final) only when every part is `ok` and fresh, or
unavailable for a reason that holds for every caller: `not_found`,
`invalid`, `disabled`. A part `rate_limited` (that caller's bucket),
`upstream` or `schema` (transient), or one the proxy served from its copy
past freshness (`stale`, `revalidating`: the next caller may be read
fresh) makes the answer `private, no-store`, stored nowhere. One end
user's limit never reaches another's answer, and no caller header reaches
any stored body.

### Live transactions (`live`)

A transaction reaches Scan's store through the indexer's 15-minute tick
and the copy chained after it, so our decoded rows arrive up to about 16
minutes after it is mined, and Blockscout has it some seconds after. Until the copy has read past the
transaction (the explorer's time against `copy:activity`, or no time
because Blockscout answered 404), the transaction document reads it from
Mezo RPC (`src/scan/live-tx.ts`) and sends `live`
(`scanLiveTransactionSchema`):

- `state`: `unknown` (the RPC has never seen the hash), `pending` (in the
  mempool) or `mined`, with the transaction, the receipt (at most 200 logs)
  and the block's time.
- `activity`: the receipt decoded with the indexer's own handlers
  (`@matchbox/indexer/receipt`) and mapped as the copy maps rows, so a vote,
  a claim or a lock change reads as it will once indexed
  (`apps/indexer/test/decode/receipt.test.ts` checks 15 real transactions
  against the rows the copy wrote). The decoder gets this epoch's gauges
  from the market snapshot (reward contracts and pools, remembered ten
  minutes) and the touched locks as the chain had them at the block before
  (`ownerOf` and `locked` in one Multicall3 request, at most 40 locks),
  with the escrows' logs of earlier transactions in the same block (one
  `eth_getLogs`, only when it was not the block's first): a lock one of
  them names may have changed since. A field that depends on a lock state
  the read did not get (a lock row's `prev_*`, `post_*` and
  `merge_dest_prev_*`, a poke's actor) is left out, never taken from the
  stored row, which lags up to the copy's 15 minutes. A log from a
  contract neither knows is left undecoded.
- Cost: one request for an unknown or pending hash, four for a mined
  one (the transaction, then its receipt, its block and the head
  together), on Scan's chain client (primary RPC, 1.2 s, no retry) inside
  the route's 2.2 s chain deadline, started as soon as the explorer has
  answered. A mined answer at least two blocks behind the head (where the
  indexer reads) is kept a day in the isolate and at the edge; a newer
  one, any other answer, or a failure, one block (3 s), so viewers of one
  hash and a page polling it cost one read per block. Each read is paid
  from the visitor's live allowance (15 a minute), then a budget of its
  own (`scanTxBudget`, `scan:chain-reads:tx`, 60 a minute and 20,000 a
  day across every isolate), apart from the lock and address pages'
  `scanChainBudget`, so made-up hashes never spend what those pages read
  with. It is not made when the budget cannot be asked, nor when no
  rate limiter is bound: random hashes cost one request each, up to the
  visitor's allowance and the transaction budget.
- A failed read is `{ status: "unavailable", reason: "upstream" }` and the
  answer is `private, no-store`. APIs before this field send none; Scan
  treats that as no live data.

### Rate limits

The scan class in the `RateLimiter` Durable Object, apart from the `/v1`
and Blockscout buckets: `scan:caller:<client>:<end user>`, 120 a minute and
10,000 a day per end user; callers without an end-user key share
`scan:caller:<client>:anonymous`, 600 a minute. Spent only when a request
renders (memory and edge hits cost nothing); fails open, also when the
limiter takes more than 0.25 s (`scanSpendMs`). Composed
documents also spend the proxy's own buckets for their Blockscout parts.

### Creating the database (human steps)

`SCAN_DB` is not bound in `wrangler.jsonc` until `matchbox-scan` exists, so
this Worker deploys exactly as before (every environment, `v2preview` that
live Pro binds to included). Without the binding the `/internal/scan` routes
answer 503 `service_disabled`; nothing else changes. A config test
(`src/wrangler-config.test.ts`) fails if any D1 or KV binding in this app's
wrangler configs has a placeholder or all-zero id, so a binding to a
database that does not exist yet cannot be merged again.

To turn the routes on, in this order (the bindings go into the configs
before the migrations are applied: `wrangler d1 migrations apply` finds
the database, its id and `migrations_dir` through the config):

1. Create the database and note its id:

   ```sh
   pnpm --filter @matchbox/jobs exec wrangler d1 create matchbox-scan
   ```

2. Add the binding, with the real id, to both Workers' configs:
   - `apps/jobs/wrangler.jsonc`: the `SCAN_DB` block from the jobs README
     ("SCAN_DB schema"), where its comment says.
   - `apps/api/wrangler.jsonc`, wherever `READ_DB` is bound: the top-level
     `d1_databases` (after `READ_DB`) and the `d1_databases` of
     `env.v2preview`. Not `env.staging`, which has no read models. Done on
     10 Nov 2026 (database `ace6a0e7-ddf9-4e29-9b75-c80df48c3ab2`):

   ```jsonc
   // SCAN_DB: matchbox-scan, Matchscan's explorer rows, written by
   // matchbox-jobs and read by /internal/scan.
   {
     "binding": "SCAN_DB",
     "database_name": "matchbox-scan",
     "database_id": "<the id from step 1>",
     "migrations_dir": "../jobs/scan-migrations",
   }
   ```

3. Apply its schema (`apps/jobs/scan-migrations`), now that the jobs
   config names the database:

   ```sh
   pnpm --filter @matchbox/jobs exec wrangler d1 migrations apply matchbox-scan --remote
   ```

4. Check: `pnpm --filter @matchbox/api test` and
   `pnpm --filter @matchbox/jobs test` (the config tests check the ids), and
   `pnpm --filter @matchbox/api exec wrangler deploy --dry-run --env v2preview`.

5. Deploy the API first, then matchbox-jobs: the jobs Worker reads
   Blockscout through the API's `InternalApi` entrypoint, so the API must be
   deployed before the jobs Worker binds to it. Until the jobs Worker's
   first run fills the history, nothing is sealed (`history_filled` 0).

### An owner's votes

### Tokens

The address document's `tokens` part is the first page (50) of the
address's ERC-20 balances, through the proxy's allowlisted
`addresses/{address}/tokens?type=ERC-20` (never `token-balances`, which
answers every token unpaged): one upstream read per cold address view,
refreshed by the proxy at most every 4 blocks. Each balance carries
`value_usd` from the API token registry's pricing and the KV prices, and
`priced_as` (`btc`, `mezo`, `usd` taken as $1, or null) so a client can
leave assumed values out. `next_page_params` continues through the proxy.

`/tokens` is the token list in one read: every registered token and every
token the jobs Worker keeps a supply for, with `price_usd` by `priced_as`,
`price_source` (`mezo-oracle` for BTC, `coingecko` or its thin fallback
`aerodrome-cl` for MEZO, `registry` for $1 taken, null unpriced: name it
next to the price),
`supply` (the latest `token.total_supply` close: `totalSupply()`, never
summed transfers, since MEZO, mUSDC and other bridge-minted tokens have
no mint events), `supply_usd`, and `holders` (the latest `token.holders`
close, Blockscout's count). Each figure has its day and `partial`; with
no row it is null, never zero. No Blockscout read per page view.

### Cross-chain (MUSD and MEZO on Mezo, Ethereum, Base)

These routes read the tables matchbox-jobs fills (apps/jobs README,
"Cross-chain data"; `scan-migrations/0006`). Their schemas are in
`@matchbox/contracts/scan` (`crosschain.ts`). Every figure nobody can give
is null, and the row's `unavailable` map (field → reason) says why. It is
never 0. Two examples: the Aerodrome APR (the new gauges revert on
`rewardRate`), and MEZO's bridge flows (Wormholescan's NTT endpoints do not
support MEZO). Base holder counts are not served: Base's Blockscout answers
with a Cloudflare challenge. Before the migration is applied, these routes
answer 500 and the token list keeps MUSD at $1 taken.

| Route                                        | Answer                                                                                                                                                                                                                                                                                                                                                                                   | Cache key     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `crosschain/prices`                          | MUSD: the headline (`basis` `venues`, the liquidity-weighted median, or `coingecko`), each venue's quote with its chain, pool, link, depth, method and read time (`stale` after 10 minutes), `spread_bps`, and `diverged` (over 50 bps). MEZO: the KV price with `basis` `coingecko` or its thin fallback `aerodrome-cl`. `attribution.coingecko`: show it next to any CoinGecko figure. | the minute    |
| `crosschain/prices/history?days=90`          | MUSD's daily closes: the headline, and each venue by id (the peg chart).                                                                                                                                                                                                                                                                                                                 | 5-minute slot |
| `crosschain/supply?days=30`                  | Per asset: each chain's latest total, locked (Mezo's NTT manager) and circulating supply in base units, the sum across chains (null when a chain is missing), and circulating supply by chain per day.                                                                                                                                                                                   | 5-minute slot |
| `crosschain/pools`                           | Every tracked pool, legacy ones included: chain, venue, pair, link, TVL, 24h volume, 7-day volume and mean APR (null with fewer than 7 days), the APR split (fees, rewards, Merkl, gauge, total), each figure's source, and the Matchbox gauge that funds it (`metadata`, `curated` or `pool`). Tigris pools get MEZO emissions from Pro's gauge documents.                              | 5-minute slot |
| `crosschain/bridge-flows?asset=musd&days=30` | Per route: Wormholescan's all-time transfers and USD, and the daily change between consecutive snapshots. Also every route together per day.                                                                                                                                                                                                                                             | 5-minute slot |

None of these tables bump `data_version`, because MUSD's quotes change every
minute. Each route's cache key is a time slot instead.

In `/tokens`, MUSD's row is `priced_as: "market"` at the headline, with
`price_source` `venues` or `coingecko`, while the headline is under 10
minutes old. Otherwise it falls back to the registry's $1 (`usd`,
`registry`). `supply_usd` uses the row's own `price_usd`.

### Validator uptime

`/uptime` and `/validators/{address}/uptime` serve the counts the jobs
Worker reads from a community CometBFT node's commit signatures (apps/jobs
README "Validator uptime"; schemas in `@matchbox/contracts/scan`,
`uptime.ts`). Both carry `status`: `source` (the node that answered
last: `pathrock`, `lavender` or a host), the last counted `height` and
its `block_time`, `read_at` (the last run that read a node),
`behind_blocks` (the head minus `height` at that run) and `state`,
judged when the answer is made: `live` (read within 5 minutes, within
150 blocks of the head and a block under 10 minutes old), `behind`,
`down` (no read for 5 minutes) or `not_started` (nothing counted, or
migration 0005 not applied: then every figure is empty, never an error).
Only `live` figures are current; pages say so otherwise.

Windows (`d1`, `d7`, `d30`) give blocks in the set, signed, missed,
proposed, proposals missed (rounds it proposed that committed nothing),
expected proposals in millionths (1/N per block) and `uptime_bps`, with
`from` and `complete`: 24 hours and 7 days sum the hourly rows (the
current hour and the 23 or 167 before), so they are complete only once the
poller has run that long; 30 days sums the rolled-up days and the hours
after the last one, complete when the chain's day rows (live or backfilled)
cover all 30. `/uptime` also gives the newest block's `signing` of `of`
members. A validator's route adds its strip (the newest 100 blocks:
`signed`, `missed` or `out`, proposed, missed proposal) and
`last_signed` (the newest hour, kept 14 days, else day it signed in).
Validators are keyed by operator address, the blocks' miner; a member the
PoA module did not name has `address` null and its consensus address.

### Validators

`/validators` gives the latest day with counts of `chain.blocks_proposed`
(the jobs Worker's difference of two daily reads of each validator's
Blockscout `validations_count`): each validator's `blocks`, `share_bps`
and `blocks_total`, matched by address to Pro's gauge directory
(ValidatorPool operator, gauge, status, name) and Scan's labels. Before
the second daily read there is no count: `available` false with a
`reason`, never zero.

Shares are of every block the chain produced that day (`share_of:
"all_blocks"`): `chain.blocks`, the difference of Blockscout's newest
height at two daily reads (dimension `''`), given as `blocks_in_day`.
`unattributed_blocks` is that count minus the validators' (`day_total`),
at least 0, since the height and the counters are read minutes apart.
Without a `chain.blocks` row for the day (a first read, a missed day, a
height that went down) the shares are unknown: null, with `share_of`
null, never shares of the known validators' sum. A validator with a
total but no count for the day has no share and is listed in
`missing_counts`; its blocks fall in the unattributed remainder. Validator gauges with no operator are listed
apart (`pool_without_operator`). Day reads use `daily_by_day (metric,
day, dimension)`, in place since scan-migrations 0001.

### Governance

Matchscan's governance panels (`src/scan/governance.ts`, schemas in
`@matchbox/contracts/scan` `governance.ts`):

| Route                                         | Source                          | Index (plan)                                                                                                           | Class                   |
| --------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `GET /epoch-sources?epochs=` (1 to 104, 26)   | `epoch_sources`                 | primary key (epoch range)                                                                                              | run (aggregate version) |
| `GET /epoch-emissions/{start}?source=`        | `gauge_emissions`               | `gauge_emissions_epoch`                                                                                                | run (aggregate version) |
| `GET /gauges/{gauge}/emissions?limit=`        | `gauge_emissions`               | primary key, newest first                                                                                              | run (aggregate version) |
| `GET /lock-distribution?escrow=vebtc\|vemezo` | `lock_distribution`             | primary key: newest day, the reads 30 and 90 days before it (up to 3 days older, else null), a year of headline groups | run (aggregate version) |
| `GET /apr?epochs=` (1 to 104, 26)             | MARKET_DB `market_voter_epochs` | primary key range                                                                                                      | live (5-minute slot)    |
| `GET /gauges/{gauge}/apr?limit=`              | MARKET_DB `market_gauges`       | `market_gauges_history`                                                                                                | live (5-minute slot)    |

- **Emissions and voter totals** are the jobs Worker's summaries (apps/jobs
  README "Governance summaries"): the MEZO each voter distributed to each
  gauge per epoch, and each voter's emissions, incentives, fees, vote
  weight and gauge count. Validator gauges' emissions are what each
  validator earned; what it claimed is not indexed. `emissions` is null
  before the copied DistributeReward history (9 Apr 2026) and for the
  epoch it starts in: unknown, not 0.
- **Lock distribution** is the jobs Worker's daily chain read of every
  lock (amounts checked against `supply()`), not the warehouse's lock
  rows. Before the first read `latest` is null.
- **Voting APR per epoch.** The market cron's projected APR for a gauge is
  `aprPercent` over its rewards and its weight; `market_voter_epochs`
  (`migrations/0003_market_voter_epochs.sql`) applies the same function to
  each voter's summed rewards and total weight, from the cron's own stored
  rows, so an epoch's figure is what its last snapshot said. An escrow's
  row (`vebtc`: pools and validators; `vemezo`: boost and third-party)
  adds its voters' APRs (`escrowAprPercent`): each voter keeps its own
  ballot, so one lock votes its full power on both (on 15 Nov 2026, 22
  veBTC locks held 1,034 of the validators' 1,040 BTC of votes and voted
  on pools too). Its `total_usd` and `weight` are the voters' sums, for
  reference. `src/market/voter-epochs.ts` runs after each snapshot:
  the current epoch at most every 30 minutes (rows rewritten only when a
  figure changed, so at most 6 rows twice an hour), and one past epoch
  without a final row per run, which fills the stored history (39 epochs
  once `gauge-epochs.ts` is applied) within a few hours with no script.
  Without MARKET_DB both routes answer 503; before the migration the
  refresh logs "Voter epochs not refreshed" and `/apr` answers 404.
  `/gauges/{gauge}/apr` answers each stored epoch up to the current one
  (upcoming epochs' rows carry the previous weight and are left out).

Deploy order: apply `scan-migrations/0007` to `matchbox-scan` and
`migrations/0003` to `matchbox-api-market-v2`, deploy the API, then the
jobs Worker, then Matchscan. Each part degrades without the next: the
routes answer empty or null before the jobs write and 404 before their
migration (a missing table is never a 500), and Matchscan shows "Not
available yet" for any answer but 200, including the 404 of an API
without these routes.

### The live snapshot's age

Every live Borrow answer carries `snapshot`, as does the `borrow` part of
`/entities/address/{address}` when it is `ok`, and `/status` carries
`liveSnapshot`: the block of the last live run
(`stability_pool.musd_btc_price_block`, written every run since jobs
5785d87), the BlockHub head, `behind_blocks`, and `stale` past 240 blocks
(the snapshot runs every 5 minutes, about 79 blocks, so two missed runs).
Null, never a guess, without the block or the head. One primary-key read
and the shared clock, remembered for 5 s; no chain or upstream read. A
head the clock missed (its 300 ms read timing out while the hub wakes) is
neither remembered nor cached: that answer is `private, no-store`, so the
next one reads the head again instead of carrying null for the live slot.

### An owner's votes

`/owners/{address}/votes` is the votes of every lock the address owns now
(`locks.owner`), so votes a previous owner cast on a lock come with it.
Order: by lock (escrow, token id), each lock's newest epoch first, then
gauge; `?epoch=` keeps one epoch. Each page carries `labels` for its
gauges (at most 50; `labelLimit`, `labelsTruncated`), so Scan's votes tab
is one read. Cursors, validation and caching are the other vote lists'.

### Locks from the chain

Scan's `locks` rows follow the indexer through the jobs copy, up to about
17 minutes behind the chain. The lock route and the address document lay
the chain over them (`src/scan/live-locks.ts`, with readers from
`src/read-models/live-locks.ts`). Nothing is written: not to SCAN_DB, and
not to `wallet_requests`.

Every chain read here is public and on the RPC Pro uses too, so each one:

- is remembered for its minute in the data centre's edge cache, whatever it
  answered (figures, "no such lock", or a failure), and shared in the
  isolate by requests that arrive together. A minute's read is made once
  per lock or address per data centre, not once per isolate;
- runs on its own client (the primary RPC only, 1.2 s per request, no
  retry at either of viem's levels), one request per step, inside one
  deadline per route of 2.2 s (`scanLiveDeadlineMs`, inside Matchscan's 3 s
  wait for the API) even if the RPC never answers;
- is paid for before it starts, within 300 ms: first from the caller's
  allowance (`scanCallerLiveAllowance`, 15 reads a minute per visitor key,
  30 shared by callers without one), then from `scanChainBudget` (120 reads
  a minute, 60,000 a day, across every isolate), both keys of the
  rate-limit Durable Object. Past either, that request serves the stored
  rows, and the refusal is not remembered for other callers. When the
  Durable Object cannot answer in time, an address read serves the stored
  rows (addresses are unbounded keys) and a lock read goes ahead (its ids
  are bounded below).

The routes:

- `/locks/{escrow}/{tokenId}` answers `{ data, indexed, live }`
  (`scanLockDocumentSchema`). `data` is the stored row with the chain's
  owner, amount, unlock and permanence over it; `live` is the lock's voting
  power and its current votes by gauge (`source` as on lock_votes, and
  `voted_at`, the lock's last vote on that voter), with the block they were
  read at. A lock the chain has and the store does not is made from the
  chain (`indexed: false`; `created_at`, `activity_count` and `updated_at`
  null). An id the store does not have is read only when it is at most 20
  past the escrow's newest id (`tokenId()`, read once a minute for both
  escrows); any other is a 404 without a read. A withdrawn or merged row is
  served as stored without a read. A read that fails, passes the deadline or finds
  the budget spent serves the stored row (`live: null`); with no stored row
  that is a 500, never a 404. The answer is keyed on the run and the minute
  (`brief`).
- `/entities/address/{address}`: the `locks` part lists every lock the
  chain says the owner holds (up to 50 per escrow), each over its stored row
  where the store has one (looked up by primary key when it is not on the
  owner's first stored page: past it, or transferred in and still under its
  former owner there), with the withdrawn and merged locks of that page, in
  the page's order. A stored live lock the owner no longer holds is dropped,
  unless that escrow's chain list was cut at 50. The owner read asks for the
  lock set and each lock's `locked` only, no voting state. The `nextCursor`
  is the stored page's only while locks are left unlisted (an escrow's
  chain list cut at 50, or a withdrawn or merged lock past the stored page),
  so "more locks" is not said when all are listed. The next page
  (`/owners/{address}/locks`) is the store's list: it can repeat a lock
  already listed or name one the owner no longer holds until the copy
  catches up. A read that fails lists
  the stored page.

Requests (`eth_call`s, each one Multicall3 batch) per read, made at most
once a minute per lock or address and data centre:

| Read                                                                                      | Requests                                                              |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A stored lock that does not vote                                                          | 1                                                                     |
| A stored lock that votes (more than 4 gauges on a voter)                                  | 2 (3)                                                                 |
| An id the store does not have, within 20 of the newest                                    | as above, plus the newest-id read (1, shared by every id that minute) |
| An id further on, a withdrawn or merged lock                                              | 0                                                                     |
| An address with no locks                                                                  | 1                                                                     |
| An address with locks                                                                     | 2                                                                     |
| An address with more locks than its stored page names plus 2, up to 50 or more per escrow | 3                                                                     |

A throttled, failing or hung RPC does not add requests: each step is one
request with no retry, a hung one is given up at the route's deadline, and
the failure is remembered for the minute like an answer. With the RPC hung,
a lock or address costs one request a minute per data centre (a lock not
stored: the newest-id read, which takes the whole deadline).

### Needed from the jobs schema

- **`locks_owner_lock`** (the unique index for an owner's votes): written
  by the jobs agent as scan-migrations 0004; the planner takes it with no
  API change.
- **No `daily_metric_day` needed** for validators: `daily_by_day (metric,
day, dimension)` has existed since scan-migrations 0001 and is the same
  index.

- **Halt state.** Read from `scan_status.halted_tables`: any value but
  NULL (or empty) means halted, so the data is stale and nothing is sealed.
  The jobs Worker is changing how halt state is stored (kept until the
  table copies cleanly; a halting run no longer advances `last_ok_at`). The
  API reads the column defensively (JSON `{table: reason}`, a list of
  names, or anything else as "halted, names unknown") and will follow the
  final form once it is settled.
- In place and read: `scan_status.data_version` (scan-migrations 0003),
  `scan_status.history_filled` (sealing), MUSD's PriceFeed price on
  `stability_pool` (apps/jobs/migrations/0005) with its block written every
  live run (5785d87). The voters' escrow
  tie-break needs no index (`lock_votes` is WITHOUT ROWID, so
  `lock_votes_gauge_weight` already ends in escrow).

### Not served yet

| Designed element                                             | Waiting for                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Validators list, blocks proposed, proposer share             | a per-block proposer series (Blockscout `miner` rolled up daily)                            |
| Transactions per category                                    | a source; Blockscout has only the daily total                                               |
| TVL and its five-way split, protocol fees by source          | a defined formula (scan-plan "Design gaps")                                                 |
| Net worth per address, LP APR                                | a defined formula and USD prices beyond BTC and MEZO                                        |
| Historical USD for tokens other than BTC and MEZO            | `price_daily` rows for them                                                                 |
| Pool list with token pairs                                   | a route over the new `pools` table (scan-migrations 0002); the data exists                  |
| DEX swap counts on CL pools                                  | CL swaps in the warehouse (`dex.swaps` covers basic pools only; `dex.volume_in` covers CL)  |
| Token holder history beyond five tokens                      | `token.holders` is read once a day for five tokens; `token.holders_replayed` is backfill    |
| Full holder lists, CSV export, contract verification, alerts | held for later (scan-plan)                                                                  |
| Watch lists in Scan                                          | Matchbox ID sign-in (`watch_items` exists)                                                  |
| BTC price at a transaction's time                            | one archive `eth_call` per transaction (scan-plan), not built                               |
| Bridge fees                                                  | a source (none found)                                                                       |
| Validators' claimed and unclaimed emissions                  | the validator gauges' reward claims in the indexer (earned per epoch is served: Governance) |
| Early veBTC locks' full amounts                              | a re-read of the 57 locks that predate the indexer's start                                  |
| Recent internal transactions                                 | Blockscout's index, months behind; the proxy's raw-trace summary covers it                  |
| Quarantined rows                                             | intentionally internal: only their count reaches `/status` (`quarantinedRows`)              |

Now served that this list used to hold: Morpho liquidations (in
`/borrow/liquidations`), an address's sent-only activity (`role=sender`),
the open-troves index, aggregate freshness (`/status` and every `meta`),
killed gauges, and the settled series registry with its notes.

## Internal Pro routes

Read models for Matchbox Pro, typed by `@matchbox/contracts/read-models` and
served from D1 (`READ_DB`, schema in `apps/jobs/migrations`). Public chain
data, so no API key, but reachable only by internal callers (above). Every
response is `{ data, meta }` where `meta` names the source (`warehouse`,
`live`) and block.

| Route                                                           | Read model             | Edge / browser TTL |
| --------------------------------------------------------------- | ---------------------- | ------------------ |
| `GET /internal/pro/wallets/{address}/overview`                  | `walletOverview`       | 30 s / 15 s        |
| `GET /internal/pro/wallets/{address}/rewards`                   | `walletRewards`        | 30 s / 15 s        |
| `GET /internal/pro/wallets/{address}/activity`                  | `walletActivity`       | 30 s / 15 s        |
| `GET /internal/pro/wallets/{address}/activity.csv`              | CSV, every row         | 30 s / 15 s        |
| `GET /internal/pro/wallets/{address}/rewards.csv`               | CSV, every claim       | 30 s / 15 s        |
| `GET /internal/pro/wallets/{address}/balances`                  | `walletBalances` (RPC) | 4 s / 4 s          |
| `GET /internal/pro/wallets/{address}/watchlist`                 | `watchList`            | none               |
| `PUT, DELETE /internal/pro/wallets/{address}/watchlist/{k}/{a}` | `watchList`            | none               |
| `GET /internal/pro/summary`                                     | `proSummary`           | 60 s / 30 s        |
| `GET /internal/pro/protocol`                                    | `protocol`             | 60 s / 30 s        |
| `GET /internal/pro/protocol/epochs`                             | `protocolHistory`      | 60 s / 30 s        |
| `GET /internal/pro/protocol/epochs/{number}`                    | `protocolEpoch`        | 60 s / 30 s        |
| `GET /internal/pro/gauges`                                      | `gaugeDirectory`       | 60 s / 30 s        |
| `GET /internal/pro/gauges/{address}`                            | `gaugeProfile`         | 60 s / 30 s        |
| `GET /internal/pro/gauges/consistency`                          | `gaugeConsistency`     | 60 s / 30 s        |
| `GET /internal/pro/wallets/{address}/identity`                  | `walletIdentity`       | 1 h / 1 day found  |
| `GET /internal/pro/prices`                                      | `prices` (KV)          | 30 s / 15 s        |
| `GET /internal/pro/head`                                        | `chainHead`            | none               |
| `GET /internal/heads` (WebSocket)                               | `headMessage` feed     | none               |

**A failed read.** A render that throws anything but a deliberate answer
(a D1 error, a stored document this API's schema rejects, a builder bug)
is tried once more, except on `/wallets/{address}/balances`, a live chain
read whose client retries each RPC itself. The shared routes (summary,
protocol and its epochs and
activity, the gauge list, a gauge, consistency) also keep their last good
answer a day under its own cache key; when the second try fails too, that
answer is served with `X-Cache: stale-if-error` and `Cache-Control:
no-store` instead of a 500, `Read model render failed` is logged with
the route and the error, and the request log counts it (`servedFrom`,
below). A schema error is logged as its checks and paths only, a JSON one
as "not JSON": neither quotes what was read. With no earlier answer in that data centre the
route still answers 500. Wallet routes keep no extra copy.

Activity takes `category` (`votes`, `claims`, `locks`, `incentives`,
`system`), `limit` (1 to 100) and `cursor` (the previous page's
`nextCursor`). The first pages come from the wallet's document (its latest
rows). For a wallet with more, the document's last page carries a cursor
`h.<ts>` into its stored history (`wallet_activity_rows`, written by
matchbox-jobs), paged newest first by time then row id with cursors
`h.<ts>.<id>`: at least `limit` rows, then the rest of the last row's epoch,
never more than 100. The last page has `pending: true` only where older
rows are on their way: the stored history does not reach the document yet
(the snapshot fills that gap by itself), or older rows are not stored yet
and the snapshot's last run had the backfill on (`warehouse-history-backfill`
in `job_cursors`). With the backfill off it ends with what is stored and
promises nothing. A history page is read without the document's body (its
meta only) and its ETag comes from the history's state: a page with older
pages after it, or the last of a complete history, changes only when a row
is rewritten and is kept 10 minutes in the browser and an hour at the edge;
the document's pages and a pending last page keep the wallet TTLs. Rows in
the stored history keep the USD they were priced at when stored. Claim rows
also carry `atClaim`, their value when claimed (each token at its UTC day's
00:00 price, `src/read-models/claim-prices.ts`), once their day is priced.

The CSV downloads (`src/read-models/history-export.ts`, format in
`@matchbox/contracts/read-models/history-csv`) hold the whole stored
history, or its claims: the document's rows, then the stored rows read 500
a query inside the one streamed response, at most 20,000 rows (the file
says where it stops). A stored claim written before its day was priced is
valued from `token_price_daily` on the way out. A history still being
added ends with a note. The busiest wallet (about 4,500 rows) reads about
5,200 rows in 12 queries (`history-export.workers.test.ts`). The ETag
covers the document, the history state and the priced days, so a repeat of
an unchanged file is a 304 that reads no page. Each download that misses
the edge cache costs one from the visitor's bucket (Pro's
`X-Matchbox-End-User` key: 6 a minute and 200 a day, or 60 and 3,000 for
everyone without a key), and a refusal is a 429.

The gauge list is paged (`gaugeQuerySchema`): `limit` (1 to 100, default
50), `cursor` (the previous page's `nextCursor`), `sort` (`votes`, `apy`,
`incentives`), `voter`, `q` (name or address prefix), `addresses` (up to 50,
comma-separated, for ballots and watch lists), `funded=true` and `kind`
(`vebtc`, `validator`, `pool`, `mezo`). The response carries `total`,
`nextCursor` and `kinds` (gauges per kind with every filter but `kind`, for
tabs with counts); the stored document holds every gauge and is sliced per
request, so pages are edge-cached by URL. Every order puts veBTC gauges whose
lock expired or was withdrawn last.

On mainnet the gauge list, `/summary`, `/protocol` and
`/gauges/consistency` leave out MEZO gauges the Mezo app does not list
(`MEZO_APP_GAUGES` in `packages/chain`; `read-models/pro-gauges.ts`), so Pro,
Home and Stuart offer the same MEZO gauges as the app. The stored document,
gauge profiles, wallets, Scan and the jobs keep every gauge.

- **Gauge kinds.** `kind` comes from the voter: BoostVoter `vebtc`,
  ValidatorsVoter `validator`, PoolsVoter `pool`, ThirdPartyVoter `mezo`
  (shown as cross-chain). Each kind has its own metadata, compact on cards
  (`meta`) and full on the profile (`details`), built in the gauge publish
  from chain reads (`src/read-models/gauge-details.ts`): veBTC lock id,
  owner, beneficiary and `lock` (`active`, `auto-max`, `expired`,
  `withdrawn`, from `locked(tokenId)`); validator operator, beneficiary and
  status (PoA: no stake or commission); pool `poolKind` (`vamm`, `samm`,
  `cl`, `vault`), reserves, TVL, staked share, fee, MEZO emission APR and,
  for sMUSD, the savings APR (`yieldIndex` growth over about seven days);
  MEZO gauges' destination chain, allocator and bridge from their
  RemoteGaugeBeneficiary (Wormhole NTT), protocol and pool from the
  ThirdPartyGaugeCreated metadata, and the owner's facts from
  `mezo_gauge_destinations` (MARKET_DB, filled by hand, wins when present).
  Cards carry `votesUnit`: veMEZO for veBTC and MEZO gauges, veBTC for
  validator and pool gauges.
- **Gauge labels** (`src/read-models/gauge-labels.ts`). CL pools (CLGauge,
  read `token0`, `token1`, `tickSpacing`), pools of tokens the read models
  do not know and vaults are named by their pair or token; MEZO gauges by
  their creation metadata (one Blockscout logs call). Labels never change:
  each is resolved once and kept in `gauge_labels` (MARKET_DB,
  `migrations/0002_gauge_labels.sql`).
- **Gauge history and consistency.** `gauge-history` documents (one per
  gauge, every epoch with votes or incentives) and `gauge-funding` (funded
  epochs of the last 8, ever, and the current streak) come from
  matchbox-jobs. The profile route adds the history; the consistency route
  ranks by `gauge-funding` (`kind`, `limit`). Gauge cards carry no
  consistency figure.
- **Mezo ID** (`src/read-models/identity.ts`). `api.mezo.org/accounts/{
checksummed address}`, cached a day at the edge when found and ten minutes
  per isolate. A failed lookup answers `status: "unavailable"`, never an
  error.

- **Wallets outside the sweep.** When a wallet has no document yet, the
  route builds one from Mezo RPC (`src/read-models/live-wallet.ts`): locks
  from `ownerToNFTokenIdList` on veBTC and veMEZO, votes from `usedWeights`
  and `votes` on the voters for the gauges in the directory, claimable from
  `earned` on their bribe and fee contracts. `meta.source` is `live` and the
  activity is empty. Wallets with locks are stored (one etag-guarded write
  per document) and queued in `wallet_requests`, so the next warehouse
  snapshot adds their history; empty wallets are never written. One build
  per wallet per isolate serves overview, rewards and activity for 30 s.
- **Locks from the chain** (`src/read-models/live-locks.ts`). The stored
  wallet documents follow the indexer, four times an hour. Every overview
  and rewards read lays the wallet as the chain has it over them: which
  locks it owns (`balanceOf`, `ownerToNFTokenIdList`), each one's `locked`,
  `votingPowerOfNFT`, `usedWeights`, `lastVoted` and vote slots, then
  `votes` per target. Three requests for most wallets, beside the claimable
  read and inside the same 4 s; one read per wallet per isolate serves
  both routes for 30 s. History, each lock's creation time and claimable
  stay the stored document's, which is not written; a wallet whose lock set
  differs from it is queued in `wallet_requests`, so the next warehouse run
  rebuilds it first. So is a wallet whose stored overview names locks and
  is over an hour old (`wantsRebuild`, at most once per wallet per isolate
  every 15 minutes); never for its activity, which a rebuild that finds no
  new events leaves as it was, nor for a wallet without locks, which only
  its events change (the run after them rebuilds it). The run marks a
  requested wallet's overview as checked even when it is unchanged, so it
  is not asked for again. A lock the chain does
  not list is dropped unless the wallet holds more than 50 in that escrow.
  A failed read serves the stored locks; `locksAsOf` (`live` or `stored`,
  with the block) says which, as `claimableAsOf` does for claimable.
- **Time bounds on the live wallet reads.** Pro waits for no answer of its
  own, so the API bounds them. The lock, claimable and lock-count reads give
  up at 4 s (`claimableDeadlineMs`) even if the RPC never answers (each
  request is raced against the deadline), on a client with 2 s per endpoint,
  each RPC once and no retry at either of viem's levels. Measured on 13 Nov
  2026, a 41-lock wallet's lock read took 0.6 to 0.9 s and 1.26 s at worst on
  a fallback, one request 0.7 s at worst. A request waits at most 5 s for a
  wallet built from the chain (`liveWalletDeadlineMs`), then answers 503
  with Retry-After while the build goes on (up to 30 s); retries join it,
  and a failed build is remembered for 15 s. Pro shows its "Data
  unavailable" state with Try again. Before, a hung RPC held these reads for
  the default client's 15 s per endpoint, retried at both levels.
- **`?after=<block>`** on the wallet overview and rewards and on the gauge
  list and profile: the caller had a transaction mined in that block. The
  answer skips the isolate memo unless it is that new, and is cached (under
  its own URL) only when it is; otherwise it is `no-store`. Pro sends it for
  five minutes after a transaction.
- **Gauge votes** (`src/read-models/gauge-votes.ts`). The minute cron reads
  `weights` for every gauge (two requests for 782 gauges) and compares them
  with the stored cards. No vote changed: nothing is written. Otherwise the
  changed cards get their votes, APY (the market snapshot's incentives and
  prices over the new votes) and boost (`getBoost`), in the directory and
  in up to 60 profiles, and the directory's `block` becomes the block read.
  The write is conditional on the etag that was read, so a publish that
  landed meanwhile stands.
- **Projected rewards and the suggestion** (`wallet-extras.ts`, shared with
  matchbox-jobs): each lock's `projected` is its share of every voted
  gauge's incentives (`nativeShares` from `@matchbox/domain`); the overview's
  `suggestion` is the most urgent of withdraw, vote, top up a near-5x boost
  gauge, or claim.
- **Balances** read native BTC (`eth_getBalance`) and MEZO, MUSD and every
  other registered token (`src/read-models/token-registry.ts`: mUSDC, mUSDT,
  sMUSD, mSolvBTC, mxSolvBTC, mcbBTC, ...) with one multicall at one block,
  cached per isolate per block. `tokens` lists the held ones, priced (one
  USD, BTC or MEZO) where the registry knows how.
- **Watch lists** live in `watch_items`. Writes need an
  `X-Matchbox-Client` id (8 to 64 URL-safe characters) and hold at most 100
  items. TODO: require a signed-in Matchbox ID once it ships; today the id
  is unsigned and only recorded.
- **Gauge pictures and colours.** Profile pictures come from the curated
  profiles; the preview, which has no service-role key, reads Supabase's
  public `gauge_profiles` and `validator_profiles` with the publishable key
  (`PROFILES_SUPABASE_URL`, `PROFILES_SUPABASE_KEY`). Pool gauges draw their
  pair (`vAMM-BTC/MUSD` read against known and reward tokens). `color` is,
  in order: the profile's curated `brand_color`, the colour picked from the
  profile picture, a pool's lead token colour, a stable palette pick.
- **Picture colours** (`src/read-models/avatar-colors`). The gauge publish
  fetches each profile picture (8 s timeout, 4 MB, 16.7 MP), decodes it with
  pure-JS decoders (PNG via native inflate, JPEG from DC coefficients only,
  lossy and lossless WebP, first GIF frame) to a 64 × 64 sample grid, picks
  the dominant brand-like hue by area (skipping transparent, near-white,
  near-black and grey pixels; the most common colour for monochrome logos)
  and moves it into the luminance band that keeps 2.5:1 against every
  preset's bg, soft and soft2. Results are cached in `avatar_colors`
  (READ_DB, `read-db-migrations/`) by URL and profile `updated_at`: one
  write per new or changed picture, at most 12 pictures or 15 s per run,
  failures cached (timeouts and 5xx retried after a day).

- **Caching.** The Cache API keys each response by URL; the strong `ETag`
  is the document's etag (its price-free content; for wallet routes, of the
  document as served, with the chain's locks and claimable) plus, for
  wallet routes, a hash of the current prices and of where the figures came
  from. `If-None-Match` answers 304, from the cache
  or the database. `X-Cache` says `hit` or `miss`.
- **Prices.** Wallet documents keep the USD values of the snapshot that
  wrote them and are rewritten only when an amount changes. Current values
  (locked, claimable) are repriced on read from `PRICES` (`prices:v1`,
  written by matchbox-jobs); history keeps its recorded USD.
- **Gauge documents** (`gauges`, `gauge-profile`) are built by this Worker's
  market cron on the quarter hour from the market snapshot, curated
  profiles and veBTC reads (`src/read-models/gauges.ts`); their votes are
  kept current every minute in between (Gauge votes, above). Wallet,
  protocol and live documents come from matchbox-jobs.
- **BlockHub** (`src/heads/block-hub.ts`) is one Durable Object per network.
  While at least one WebSocket is open it polls `eth_getBlockByNumber` at
  block cadence, `HEADS_POLL_MS` (default and configured 3800, Mezo's block
  time); a poll that finds the same block retries after 1 s, doubling up to
  the interval, so heads arrive about a second after they are produced at
  about 1.5 polls per block. RPCs: `HEADS_RPC_URLS` (default: Mezo's
  ValidationCloud RPC, then `rpc-internal.mezo.org`, then Boar). On each new
  block it sends `type: "head"` with `block` and `timestamp` (Pro's
  `headMessageSchema`, unchanged) plus the additive explorer fields `hash`,
  `transactionCount`, `gasUsed` and `miner`, null when the RPC block lacks
  them (`blockHeadMessageSchema` in `@matchbox/contracts/scan`). After 30 s
  of failures (`HEADS_STALE_MS`) it sends `{ type: "stale", since }` once
  per outage, and greets any socket that joins during the outage with it;
  clients then poll on their own. Sockets hibernate between messages. When
  the last socket closes the alarm is deleted (and an alarm that fires with
  no sockets is not rescheduled), so an idle hub costs nothing. The first
  socket after a sleep polls at once, gets the current head, and restarts
  the loop. A plain `GET` (`/internal/pro/head`) re-polls at most once per
  interval, counting failed polls, so a down RPC is not hammered. A hub
  with no sockets is evicted after a few idle minutes and wakes with no
  head in memory: a GET then waits for the poll, its own or one already in
  flight for another request, for at most 1.2 s (`firstReadWaitMs`), and
  if that poll is slow or fails answers the last head saved to storage
  (saved at most once a minute) with `stored: true` and `ageSeconds`. It
  answers 503 only when the poll failed and nothing is stored. (Before,
  every request that arrived while the waking poll was in flight answered
  503 at once.) The Blockscout proxy and Scan treat a stored head as
  unknown, since it is not the current head. The GET
  body also carries `lastActiveBlock`, the newest block that may have had
  transactions (a block with transactions, the first head seen, or any
  skipped block); the Blockscout proxy uses it to skip refreshing views
  over idle blocks. A close with a reserved code (1005, 1006, 1015) is
  answered with 1000, after the idle check, so the alarm always stops.
- **BlockHub cost model.** While any socket is open the hub stays resident:
  an alarm every 1 to 3.8 s never leaves it idle long enough to be
  hibernated, so wall-clock duration is billed for the whole time a socket
  is open, about 128 MB for 86,400 s, 11,000 GB-s a day or roughly 330,000
  GB-s a month (Workers Paid includes 400,000). Polling at block cadence
  does not change that. It cuts RPC calls and alarm invocations (Durable
  Object requests) from 86,400 a day at the old 1 s poll to roughly 34,000
  (about 1.5 per 3.8 s block), about 1 million a month. Duration falls only
  in hours with no socket open, when the alarm stops. Batching cannot save
  more while sockets are open: any gap short enough for a live ticker is
  too short for the object to hibernate between alarms, and polling less
  often than once a block makes the ticker late. The remaining lever is
  fewer socket-hours (clients closing the socket when their tab is
  hidden).

## Auth and limits

- Keys verified by prefix lookup + HMAC(`API_KEY_PEPPER`), cached per isolate
  for 15 s (revocation latency ≤ 15 s). Unknown keys are negatively cached.
- Missing/malformed keys and failed verification consume `ip:<prefix>`
  (`unauthenticated` policy). Verified keys never touch an IP bucket, so
  callers sharing an egress (all Cloudflare Workers) cannot lock each other
  out.
- DB reads on the miss path are bounded. A prefix that just failed
  verification is answered from memory for 15 s (unknown prefix or the row's
  secret hash). Once an isolate sees `ip:<prefix>` spent, it answers that
  bucket's 429 locally until reset, and a miss reads the key row only if the
  prefix is in the isolate's snapshot of unrevoked prefixes (one
  `listActiveKeyPrefixes` read, reloaded after 60 s, or after 10 s for a
  missing prefix). Junk costs at most 30 lookups per IP prefix per minute
  plus one snapshot read per 10 s per isolate; valid keys always pass. A
  limiter error gates the miss path the same way for 30 s (fail closed).
- Per environment: `env:<environmentId>:secret` with `rateLimitPolicies` +
  `mbx_dev_quota_overrides` (cached 60 s), and `env:<environmentId>:publishable`
  scaled by `PUBLISHABLE_QUOTA_SHARE`. Publishable keys also use
  `pk:<keyId>:<ipPrefix>`. Restricted apps get test limits. The limiter
  fails open if the Durable Object is unavailable.
- The developer console reads the `env:*` buckets (quota used / remaining /
  reset) with `RateLimiter.peek()` through a cross-script Durable Object
  binding; peeking never consumes. 429s land in the request log with error
  code `rate_limited`.
- Live keys need `review_state = approved` with `gauge-profiles:read` in
  `approved_scopes` and an `active`/`restricted` app.
- `last_used_at` is written at most once per key per 5 min (`waitUntil`).

## Request log

Analytics Engine binding `REQUEST_LOG`, dataset `mbx_api_requests`. Layout:
`API_REQUEST_LOG_LAYOUT` in `@matchbox/contracts/api-request-log`
(index1 environment id or `anonymous`; blob1–11 requestId, keyId,
routeTemplate, method, status, cacheStatus, colo, country, environmentKind,
errorCode, servedFrom; double1 latencyMs, double2 statusCode). `servedFrom`
is `last-good` for a read-model route's earlier answer served because its
render failed (`X-Cache: stale-if-error`), empty otherwise. How often that
happens, per route, over a day:

    SELECT blob3 AS route, SUM(_sample_interval) AS served
    FROM mbx_api_requests
    WHERE blob11 = 'last-good' AND timestamp > NOW() - INTERVAL '1' DAY
    GROUP BY route

## Crons

`* * * * *` runs the health probes (`src/health/probes.ts`): `GET
HEALTH_API_URL` (`/v1/health`, validated, kill switch off = down),
`GET HEALTH_ID_URL` (discovery document) and the newest chain-state row per
network plus the RPC head. One data point per probe goes to binding
`HEALTH_LOG`, dataset `mbx_platform_health` (layout
`PLATFORM_HEALTH_LAYOUT` in `@matchbox/contracts/platform-health`). The
console reads it for the Overview status tiles.

`*/10 * * * *` reconciles `mbx_api_gauge_chain_state` for every profile in
`mbx_api_gauge_profiles`: Multicall3 reads (`isAlive`, `rewardsBeneficiary`,
`boostableTokenIdToGauge`, veBTC `ownerOf`) pinned to one block per network,
40 gauges per batch, 3 batches in flight. A network without an RPC URL is
skipped. Failures are logged; the handler never throws. Test locally with
`wrangler dev --test-scheduled` and
`curl "http://localhost:8787/__scheduled?cron=*/10+*+*+*+*"` (or
`?cron=*+*+*+*+*` for the health probes).
