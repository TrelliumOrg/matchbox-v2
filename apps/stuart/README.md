# matchbox-stuart

Stuart's Worker: answers questions about Mezo and Matchbox for Pro, prepares
unsigned transactions for review, and (behind a flag) serves the Matchbox MCP.
Deterministic Matchbox services own every number; answers carry their source
and block; Stuart never claims a transaction was sent.

The wire contract is `@matchbox/stuart-ui/contract` (zod). Paths are
`STUART_PATHS` there.

## Endpoints

| Method and path          | Request                        | Response                                   |
| ------------------------ | ------------------------------ | ------------------------------------------ |
| `POST /chat`             | `stuartRequestSchema` (JSON)   | `text/event-stream` of `stuartStreamEvent` |
| `GET /status`            | none                           | `stuartStatusSchema`                       |
| `POST /proposal/refresh` | `proposalRefreshRequestSchema` | `proposalRefreshResponseSchema`            |
| `POST /support-report`   | `supportReportSubmitSchema`    | `supportReportSubmitResponseSchema`, 201   |
| `POST /mcp`              | MCP `2026-07-28` JSON-RPC      | JSON-RPC result; 404 unless `MCP_ENABLED`  |
| `POST /docs/ask`         | `docsAskRequestSchema`         | `docsAskResponseSchema`                    |
| `OPTIONS *`              | CORS preflight                 | 204 for allowed origins, 403 for the rest  |

### `POST /chat` events

Each SSE frame has `event: <type>` and `data: <JSON>`, where the JSON is one
`stuartStreamEventSchema` value with the same `type`.

1. `status` (zero or more): operational progress such as "Reading gauges and
   votes" or a tool's trace line ("Compared 34 gauges at block 13,078,795").
   Never model reasoning.
2. Exactly one of:
   - `answer`: the validated `StuartResponse` and `cached` (true when served
     from the per-block answer cache).
   - `busy`: `reason` is `rate_limited` (this IP prefix or wallet is over its
     limit), `spend_cap` (the daily model budget is spent or
     `STUART_SPEND_CAP=on`) or `model_busy` (Anthropic rate limited or
     overloaded, or the breaker is open), with `retryAfterSeconds`.
   - `error`: `code` and a high-level `message`; details go to the logs.
3. `done`, always last.

Model text never streams: a model sentence is admitted only after every
number in it matched that turn's tool results.

Requests that fail validation never open a stream: 403 `forbidden_origin`,
415 `unsupported_media_type`, 413 `payload_too_large`, 400 `invalid_request`.

### Errors on the JSON routes

Every non-2xx body is `stuartErrorSchema`:
`{ "error": { "code", "message", "retryAfterSeconds" } }`.

| Status | Code                                                     |
| ------ | -------------------------------------------------------- |
| 400    | `invalid_request`, `invalid_proposal`, `wallet_mismatch` |
| 403    | `forbidden_origin`                                       |
| 404    | `invalid_request` (unknown path, MCP off)                |
| 410    | `proposal_expired`                                       |
| 413    | `payload_too_large`                                      |
| 415    | `unsupported_media_type`                                 |
| 429    | `rate_limited`, with a `retry-after` header              |
| 500    | `internal`                                               |
| 503    | `support_unavailable`                                    |

### `POST /docs/ask`

"Ask about this page" on Matchbox Docs. The contract is
`@matchbox/docs/ask`: `{ question, page }` in, up to three reviewed notes
out, with the notes written on `page` ranked first. It is a keyword search
over the notes the docs publish (`docsKnowledge`) and nothing else: no
model, no read model or RPC, no wallet, no tools, no Supabase and nothing
stored. Stuart's own notes, whose safety and incident claims are not yet
verified, stay in its chat and never reach this route; a test enforces it. It is the only route the
docs origins (`DOCS_ALLOWED_ORIGINS` in `src/query/env.ts`) may call.

An anonymous caller can send a question of at most 300 characters and a docs
path, in a body of at most 2 KiB, and read back public notes that are also
published on the docs site. Each call costs one rate-limit count in the
`RateLimiter` Durable Object and well under a millisecond of CPU. The limit
is 20 a minute and 500 a day per IP prefix, counted before the body is read,
so malformed requests spend quota too.

## Abuse and cost

- **Rate limits:** the `RateLimiter` Durable Object, per IP prefix (IPv4 /24,
  IPv6 /48) and per wallet, with separate policies for chat, refresh, support
  MCP, search and the docs endpoint (`src/query/rateLimit.ts`).
- **Answer cache:** questions the router answers without the model (a tool, a
  navigation or a clarification card) are cached in the Cache API, keyed by
  the normalized question, wallet, mode, chain, clarification, page entity and
  the chain head block. Answers with proposals are never cached.
- **Spend cap:** each model turn's cost is estimated from the token usage
  at the model's own rates (`RATES` in `src/query/claude.ts`) and metered
  per UTC day in the same Durable Object namespace: the whole day
  (`stuart-spend:<YYYY-MM-DD>`, `STUART_DAILY_BUDGET_USD`, 25 USD) and each
  IP prefix (`stuart-spend:<YYYY-MM-DD>:ip:<prefix>`,
  `STUART_IP_DAILY_BUDGET_USD`, 3 USD), so one visitor cannot spend the
  day's budget for everyone. On Sonnet 5.5 a model answer costs about 1
  cent on the bench and up to about 4 with large tool results: 640 to 2,500
  a day in all, 75 to 300 per prefix. Once either is spent,
  questions that need the model get `busy` with `spend_cap` until midnight
  UTC; deterministic questions keep answering.

## Data

Stuart reads the same documents Pro renders, from `matchbox-developer-api`
through the `API` service binding: `/internal/pro/gauges`,
`/internal/pro/gauges/:address`, `/internal/pro/wallets/:address/overview`
and `/rewards`, `/internal/pro/prices`, `/internal/pro/summary` (lockers,
incentives, gauge counts) and `/internal/pro/head`. Protocol lock totals are
the escrows' on-chain `supply()`, with the summary as the fallback. Without the
binding (the tests and the benchmark) it serves the shared demo fixtures from
`@matchbox/contracts/read-models/fixtures`. Local `wrangler dev` declares the
binding, so data questions go to an API Worker on the same machine. Those
routes read the API's `READ_DB` (D1), not the sample store behind
`dev:memory`, so seed it first with `pnpm db:seed:local` (see Development).

Mezo RPC (`MEZO_RPC_URL`) covers what the read models do not: trove state,
zap quotes, token balances and allowances, `eth_call` simulation, boost
state, and the voters' bribe and fee contracts and pool targets. Wormhole
transfers come from Wormholescan. Blockscout reads go to the API's cached
`/internal/blockscout/api/v2/*` proxy with `X-Matchbox-Client: stuart`, so
Stuart spends its own buckets there, apart from Scan's and Pro's. With
`BLOCKSCOUT_CALLER_SALT` set, each chat and MCP request also sends
`X-Matchbox-End-User`, the visitor's IP prefix (IPv4 /24, IPv6 /48) hashed
with that salt, as Scan and Pro do: each Stuart visitor gets 90 reads a
minute and 3,000 a day there (Scan's and Pro's visitors get 30), and all
of Stuart's visitors together 120 a minute, under the proxy's shared 200 a
minute (Blockscout allows 300), so Scan and Pro keep at least 80. A read
one bucket refuses spends none of the others. Stuart's 60,000 a day is
about 20 visitors at their daily cap; past it, uncached reads stop until
UTC midnight. Without
the salt every
visitor shares one anonymous bucket of 60 a minute, about two cold trace
questions a minute for everyone. MCP requests are keyed by the IP of the
MCP host that calls `/mcp`, so all of one host's users share one bucket
(MCP is off in production). Cold reads measured on live data, 16 Nov 2026:
SNF since 23 April 35, SNF over 90 days 29, another wallet's trace 28,
`compare_holders` 19, before any extra tool calls the model makes. Pages
past the first are kept by the proxy for a day once their blocks are final
and Blockscout reports its blocks indexed, so a repeat that day costs only
the first pages.

## Chain and user activity

Four read-only tools answer "follow the money" questions about any address
or named entity, not only the selected wallet. All four are sent without
`strict` (`loose` in `defineTool`), so they stay outside the compiled
grammar budget and the pinned strict list.

| Tool               | Answers                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `resolve_holder`   | Who is behind a label, gauge, lock or address, its locks, Safe signers     |
| `address_activity` | Claims, lock deposits, swaps, bridges, MUSD mints, counterparties, votes   |
| `trace_rewards`    | The rewards claimed in a period and where each claimed token went          |
| `compare_holders`  | The largest veBTC or veMEZO holders, their votes, what they do with claims |

The router sends a question to `resolve_holder` only when it names one
holder (an address, a lock number, a curated entity or "labelled X");
rankings ("who holds the most veBTC") go to `compare_holders`, and
eligibility, validator and protocol-noun questions ("what does veBTC do with
fees") are left to the model.

**Who.** `src/query/subjects.ts` resolves "SNF", "Supernormal Foundation",
"#6033", a 0x address or "my wallet". Sources, in order: the address or lock
in the question (lock owners from the escrow's `ownerOf`, never from who
voted: a vote's `voter` is msg.sender), Matchbox's curated entities
(`KNOWN_ENTITIES`), boost gauge names (a veBTC gauge named "SNF" is veBTC
#6033, whose owner is read live), then Matchscan labels. Every address keeps
the source of its link, shown as an evidence chip with its Matchscan page.

**Data.** `src/query/providers/chainActivity.ts`, through existing cached
API routes only, capped per question (`ACTIVITY_LIMITS`):

| Read                          | Source                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| ERC-20 transfers              | `addresses/{a}/token-transfers?type=ERC-20`, at most 10 pages of 50, 3 addresses                             |
| Lock NFT moves                | `addresses/{a}/token-transfers?type=ERC-721`, at most 3 pages                                                |
| Rebases and chain fees        | `addresses/{distributor}/logs?topic={lock id}`: `Claimed` of every lock owned, 16 locks max, largest first   |
| Native BTC sent by a Safe     | `addresses/{safe}/logs?topic=` `SafeMultiSigTransaction` (8 pages), `ExecutionFailure`, module calls         |
| Which lock a deposit paid     | Mezo RPC receipt (every log), else `transactions/{hash}/logs` up to 4 pages; 6 deposits max                  |
| Labels, locks, votes          | `/internal/scan/labels`, `labels/search`, `owners/{a}/locks`, `owners/{a}/votes`, `locks`                    |
| Signers, reward payers        | Mezo RPC `getOwners`; `ve()`, `stakingToken()`, `rewardToken()` of every paying contract no label classifies |
| Balances, current lock owners | Mezo RPC `balanceOf`, `eth_getBalance` (BTC), `ownerOf`                                                      |

Log times come from Blockscout's `block_timestamp` (the API's log schema
passes it through); without it, times are interpolated between known
blocks and undated Safe events mark the read partial and are named as
undated, not counted. Native sends a Safe makes through a module
(`ExecutionFromModuleSuccess` in the period), or from a Safe that is not an
L2 Safe (executed transactions but no `SafeMultiSigTransaction` events),
are not decoded: the read is partial and the answer says so. A history cut by a page cap, or a member read that
fails, marks the answer partial, and the answer leads with the member and
the oldest date actually read. Locks past the cap of 16 (8 for
`address_activity`) are left out smallest first, and the answer says how
many were read ("16 of 17 locks read").

**Gauges are not reward payers.** Pool, CL and vault gauges answer
`rewardToken()`; vault and pool gauges also answer `ve()` with the veBTC
escrow, like voting reward contracts. What a gauge sends back is the
staked LP or vault principal (`stakingToken()`, e.g. sMUSD from a vault
gauge) or gauge emissions: neither is a voting reward, so neither is a
claim, and the answer says how many gauges paid the entity and that their
payouts are not counted.

**Compounded rewards.** Rebases (MEZO, veMEZO) and chain fees (BTC, veBTC)
for a live lock never reach the owner: the distributor deposits them into
the lock. They are read from each distributor's `Claimed` events for every
lock a member owns now or moved in the period, kept while a member owned
the lock (from its NFT moves, so locks withdrawn or transferred since still
count), and shown as claimed and compounded into their lock. A distributor
payout to the owner (an expired lock) is a liquid claim instead. Ownership
is ordered by block and log index, so a claim and a transfer in one block
are credited to whoever owned the lock at the claim. `compare_holders`
reads each holder's lock NFT moves (one page) and only its two largest
current locks, and no native BTC, and says so.

**Method** (`src/query/flows.ts`, `flows.claimed-fifo.v3`, stated in every
answer). A liquid claim is a voting reward contract or a distributor paying
one of the entity's addresses. Each claim is a lot. An outflow of the same
token from the same address after the claim spends the oldest open lots
first, up to the claimed amount, before any other balance. By default each
claim is followed to today, also past the end of a period that ended
("in March": March's claims, followed to now): on live data SNF's Enclave
sweeps rewards every two to three weeks and its Safe holds MEZO for up to
two months before locking it, so a fixed 14 days left most of what it later
locked or sent "not moved". `windowDays` sets a shorter window. A lot sent
to another of the entity's addresses follows it and its window starts again
there; a lot swapped in one transaction continues as the token received,
still counted in the claimed token, when the other token comes from the
pool or router it paid (or a pool, router or vault by label or name), or,
for a burn, from the burned token's own contract (a vault redeeming its
shares). A burn with no such payment, a loan repaid, is "burned", whatever
else arrives in the transaction. A transfer to a wallet or a Safe is never
a swap. Destinations: compounded into a lock; locked into one of the
entity's own locks, or funding someone else's lock (the deposit's
transaction says which lock and whom it was minted to); bridged out;
deposited (MUSD Savings, pools, vaults); sent (named: a Safe with the same
signers as one member Safe, a Safe signer, a Matchscan label, a curated
entity). When the reward slice is part of a larger move, the line says how
large ("part of a 100,000 MUSD add"). Native BTC a Safe pays to a bridge in
the same transaction as a bridged token is the bridge's fee. With a window
set, a lot no outflow spent within it is "kept past N days, later moves not
attributed"; "still held" is reserved for lots still in their window at the
end, capped by the address's balance now, with any excess "no longer held,
route not in token transfers". Fungible tokens
cannot be tracked exactly once mixed with other balances; the answers say
so.

**The answer.** The lead gives the period ("Since 15 Aug 2026", or "From 1
Oct to 31 Oct 2026" for one that ended), the claims, what was compounded
into locks and where liquid rewards went: each token's largest destination
first, then those more tokens went to ("Liquid rewards: sent to 0xc62b…3ffc
(Safe, same signers) and 0x965c…5d26, swapped to MUSD, and funded veMEZO
#2930 for 0x5959…0965. Some still held."), or the one token's line with
amounts when only it has liquid destinations. A swap on the way is a place
of its own. "Liquid rewards: still held." only when every liquid reward of
every token is. When the model traces several subjects ("SNF and Acme"),
the template answer keeps each one's result, in the order asked. Each token's line lists destinations largest first; when the
next one does not fit, it is shown without its batch total, and if it
still does not fit the line ends there with the rest summed ("elsewhere",
"elsewhere or held"), so a smaller destination never takes the place of a
larger one.

**Periods.** `trace_rewards` and `address_activity` take `since` and
`until` (loose tools; the strict set is unchanged). The router reads "last
30 days", "in the last month" and "past week" (rolling), "last 4 epochs" (a
week each), "since March", "since 23 April 2026", "from April 1st", "this
month", and with an end: "in March" and "during October 2026" (that month),
"from April to June", "between 23 April and 5 May", and a bare "last
month", "last week" or "last year" (the calendar one before this, as the
model passes it too). A date without a year is this year's unless it is
over two days ahead (a user east of UTC can be a day ahead), then last
year's. A period it cannot read ("since last spring", "after the 5th",
"until March"), one that has not started ("since 2027-01-01") or a range
that ends before it starts goes to the model, never a silent 90 days. A
tool given one answers that the period could not be read. So do questions
about groups ("does anyone relock", "what do LPs do", "the DAOs on Mezo",
"Mezo validators") and about several holders ("Supernormal and Acme").

## Bindings, vars and secrets

| Name                         | Kind    | Notes                                             |
| ---------------------------- | ------- | ------------------------------------------------- |
| `API`                        | Service | `matchbox-developer-api`                          |
| `RATE_LIMITER`               | DO      | `RateLimiter` from `@matchbox/server`             |
| `ENVIRONMENT`                | Var     | `production`                                      |
| `MCP_ENABLED`                | Var     | `"true"` mounts `/mcp`; default `"false"`         |
| `STUART_DAILY_BUDGET_USD`    | Var     | Daily model budget, default `"25"`                |
| `STUART_IP_DAILY_BUDGET_USD` | Var     | Daily model budget per IP prefix, default `"3"`   |
| `STUART_SPEND_CAP`           | Var     | `"on"` stops model calls now; default `"off"`     |
| `ANTHROPIC_MODEL`            | Var     | Default `claude-sonnet-5-5`                       |
| `STUART_EFFORT`              | Var     | `low` (default), `medium`, `high`, `xhigh`, `max` |
| `MEZO_RPC_URL`               | Var     | Comma list of HTTPS RPC URLs, tried in order      |
| `STUART_ALLOWED_ORIGINS`     | Var     | Extra browser origins, comma list                 |
| `ANTHROPIC_API_KEY`          | Secret  | Without it Stuart answers deterministically       |
| `PROPOSAL_HMAC_SECRET`       | Secret  | Signs proposal refresh tokens and support drafts  |
| `SUPABASE_URL`               | Secret  | Support report storage                            |
| `SUPABASE_SERVICE_ROLE_KEY`  | Secret  | Support report storage                            |
| `BLOCKSCOUT_CALLER_SALT`     | Secret  | 32+ bytes; per-visitor Blockscout proxy buckets   |

Browser origins allowed by default: `https://pro.matchbox.markets`,
`http://localhost:3000` and `http://127.0.0.1:3000`.

### What the owner sets before going live

1. `wrangler secret put ANTHROPIC_API_KEY` (the one paid dependency).
2. `wrangler secret put PROPOSAL_HMAC_SECRET` (at least 32 random
   characters). Without it, refresh tokens only verify in the isolate that
   signed them.
3. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` if support reports should
   be stored.
4. The budget in `STUART_DAILY_BUDGET_USD`, if not 25 USD a day.
5. `wrangler secret put BLOCKSCOUT_CALLER_SALT` (at least 32 random bytes,
   its own value, not Scan's or Pro's) so each visitor's chain questions
   spend their own Blockscout bucket.

## Development

No credentials are needed to run Stuart, test it or run the benchmark
without a model.

```sh
cp apps/stuart/.dev.vars.example apps/stuart/.dev.vars   # no model key: deterministic
pnpm --filter @matchbox/stuart dev        # wrangler dev, http://localhost:8787
pnpm --filter @matchbox/stuart test       # unit tests and the bench's own tests
pnpm --filter @matchbox/stuart typecheck
pnpm --filter @matchbox/stuart build      # wrangler deploy --dry-run
pnpm --filter @matchbox/stuart bench      # the benchmark on fixtures, router only
```

`GET /status` answers `{"stuart":"deterministic","model":null,...}` without
a model key. Questions that read gauges, wallets or protocol totals go
through the `API` service binding, which `wrangler dev` connects to an API
Worker named `matchbox-developer-api` running locally. They call the API's
`/internal/pro/*` routes, which read the `READ_DB` D1 binding
(`apps/api/src/read-models/routes.ts`), not the sample store behind
`dev:memory`. Seed those read models first (apps/api README, "Local read
models"), then run the API and Stuart on another port:

```sh
pnpm db:seed:local                                # from the repo root
pnpm --filter @matchbox/api dev:memory            # :8787
pnpm --filter @matchbox/stuart dev --port 8788    # second terminal
```

Without the seed every data question answers "Data unavailable" (the API
logs `no such table: read_models`). Checked on 19 Nov 2026, deterministic
mode, posting `POST /chat` to `http://127.0.0.1:8788`:

- "which gauges have the most incentives": Kiln Labs, 1,180.00 USD, 6 of 8
  boost gauges funded, Epoch 47, block 13,078,795 (the seeded directory).
- "how many veMEZO lockers are there": 1,356 lockers (the seeded summary),
  with the escrows' locked totals read live from the chain.
- "what am I earning" and "show my locks" for a real wallet with locks: its
  locks, voting power and earnings from the API's wallet documents, which
  the API builds live from the chain and stores in the seeded database. The
  seed's demo wallet is made up, so the chain reports no locks for it.

The binding can take up to a minute after both Workers start to find the
API. Until then answers say "Data unavailable": ask again. Restart Stuart
after restarting the API. Other routes Stuart calls on the binding, such as
the Blockscout proxy, need only the API running.

What needs credentials of your own: model answers (`ANTHROPIC_API_KEY`),
stored support reports (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and the
model runs of the benchmark (`STUART_BENCH_MODEL` with a key, below).

## Mezo knowledge

Most notes are written beside the concept page they explain, in the
`stuart:` frontmatter of `packages/docs/content`, and arrive generated as
`docsKnowledge` from `@matchbox/docs/knowledge` (voting rules and reverts,
veBTC, veMEZO, boost, MEZO gauges, claiming, MUSD troves, Morpho, Enclaves).
Each cites its docs page first, then the source it was checked against.
`src/query/knowledge/mezo.ts` adds the notes no docs page covers yet
(Savings, gas, safety, support) and the search. The `mezo_knowledge` tool
returns them as `docs` evidence, so how-to and troubleshooting answers are
sourced.

`MEZO_KNOWLEDGE_VERSION` carries the docs content hash, so a docs edit
changes it. Bump its date part when a Stuart-only note changes.
`knowledge.test.ts` checks every number in an answer is one of the note's
facts, that the copy rules hold, that every docs note is taken as written
and that no note says MUSD troves are winding down (they are open).
`SYSTEM_PROMPT` in `src/query/claude.ts` stays separate from the notes.

## Vote scripts

A pasted governance post ("25% to the BTC/MUSD-200 pool, 20% to the MUSD
Savings Vault, ...") goes to `prepare_vote_script` (the router sends it
there without the model). `src/query/ballotScript.ts` splits it into lines
and resolves each name by code against the live gauge directory:
"BTC/MUSD-200" is the CL200 pool, a pair with no number is its Volatile or
Stable pool only when the pair has no concentrated pool (otherwise Stuart
asks), token order is ignored and so is the "m" of a bridged token (mUSDC,
mUSDT, mSolvBTC, mxSolvBTC, mcbBTC; "USD" is not MUSD), "MUSD Savings
Vault" is sMUSD. Part of a name ("Club" for "Millennium Club") is offered,
never taken. A ballot is prepared only when every line resolved to one
voting domain and the shares add up to 100%; otherwise the answer lists
what resolved and the first open line, with a card when that line has two
or more candidates. A card's query carries every earlier pick after the
script (`... | picks: 3=0x...`), and each option is one line's pick, so
answering a second card keeps the first.
Pool and validator gauges vote with veBTC, veBTC gauges with veMEZO. "Keep
the same MEZO gauge votes" is answered with a note (votes persist), never a
ballot. Stuart's one-line inputs keep a pasted post's lines apart with
" | " (`@matchbox/stuart-ui/paste`).

## Benchmark

`pnpm --filter @matchbox/stuart bench` runs `bench/cases.ts` (143 questions
across gauge facts, APY, wallet, transactions, epochs, vote scripts, vote
and claim preparation, refusals and scams, ambiguity, wrong premises,
support, chain activity and multi-part questions; the 44 harder ones are in
`bench/harder.ts`)
through the real orchestrator against `bench/fixtures/gauges.mainnet.json`,
the live gauge directory captured from Matchscan's public pages and Mezo
RPC (`node apps/stuart/bench/capture-gauges.mjs` refreshes it; the file
records when and where). The chain activity cases read
`bench/fixtures/activity.snf.json`: the Supernormal Foundation's voting Safe
and Enclave transfers over the 90 days before the bench clock, their lock
NFT moves, the distributors' claims for every lock they owned, the voting
Safe's native BTC sends, the escrow events of each lock deposit, balances,
Safe signers, reward contracts, locks, the 30 largest veBTC locks and their
owners' votes (`node apps/stuart/bench/capture-activity.mjs`, public
Blockscout and Mezo RPC; `--extras` refreshes only the logs and balances,
`--slim` trims the file again offline). Their expected numbers come from an
independent investigation of the same window (claims classified from
calldata and receipts, owners from archive `ownerOf`), not from the fixture
or Stuart's flow engine: compounded rebases and chain fees, the lock funded
for another address, native BTC sent rather than held, and a reward slice
inside a larger liquidity add. `bench/fixtures/activity.payouts.json`
(`node apps/stuart/bench/capture-payouts.mjs`) adds what gauges paid the
largest veBTC holder over the window and an EOA from 9 to 13 Oct: sMUSD
stake withdrawals, an LP unstake, emissions and a loan repaid beside an
emission, none of which may read as a claim or a swap. Generic questions
("what do big lockers do with their incentives?") must be left to the model
(`leftToModel`). Every check is code (`bench/grade.ts`): intent,
tools called, text shown, numbers within tolerance, the prepared proposal's
exact ballot, unsigned proposals, no invented address (vote targets are
decoded from the call data: PoolsVoter must get pools, never gauges), copy
rules. A run fails on any of those safety checks, and below
`STUART_BENCH_MIN_PASS` passes when set. Without a model it scores the
router and tools for free; results land in `bench/results/`.

Comparing models needs `ANTHROPIC_API_KEY`. The run prints its estimate
first and stops above `STUART_BENCH_MAX_USD` (default 1):

```sh
STUART_BENCH_MODEL=claude-haiku-5-5 STUART_BENCH_LABEL=haiku pnpm --filter @matchbox/stuart bench
STUART_BENCH_MODEL=claude-sonnet-5-5 STUART_BENCH_LABEL=sonnet pnpm --filter @matchbox/stuart bench
# Every question through the model, not only those the router leaves open:
STUART_BENCH_ROUTER=off STUART_BENCH_MODEL=claude-haiku-5-5 pnpm --filter @matchbox/stuart bench
```

With the router on, 21 of the 143 questions reach the model. Each run
prints its estimate before the first call.

### Matchbench: models and effort levels

`pnpm --filter @matchbox/stuart bench:matrix` runs the same questions for
a matrix of entries, each a model at one reasoning effort level (Claude
Haiku 5.5, Sonnet 5.5 and Opus 5.5, each at every level it accepts: low,
medium, high, xhigh and max, per Anthropic's effort documentation; a pair a
model does not accept is skipped with a message, never run at another
level). Stuart's router is off, so every question reaches the model, and
each entry answers every question several times (`--runs`, default 3).
The refusal fallback is off for every entry, and the runner stops if the
API ever serves a model other than the one named.

```sh
pnpm --filter @matchbox/stuart bench:matrix --estimate            # plan and cost, no calls
pnpm --filter @matchbox/stuart bench:matrix --only "<=high" --max-usd 50
pnpm --filter @matchbox/stuart bench:matrix --only opus-5-5.xhigh --max-usd 70
pnpm --filter @matchbox/stuart bench:matrix --publish-only
```

- `--only` takes entry ids (`sonnet-5-5.high`), a model (`opus-5-5`), an
  effort (`xhigh`) or `<=high`. `--max-usd` is required and caps the whole
  matrix's spend, across invocations (`spend.json` beside the run files):
  the run refuses to start when the spend so far plus its estimate is above
  it, and each answer in flight reserves its worst case against it. A
  request cut off before the API reported its usage counts at a worst case.
- Rate limits, overloads and API errors are retried and never graded; an
  answer that keeps failing that way stays pending for the next run, and
  the run stops when such failures persist. A timeout is retried once, then
  graded as a timeout. Refusals and `max_tokens` stops are graded as their
  own failure types.
- Answers are interleaved across entries and runs (`--concurrency`,
  default 4), so API load is the same for every entry.
- The matrix gives an answer 120 s and each request 64,000 tokens
  (`--budget-ms`, `--max-tokens`): models are ranked on their answers, not
  on cut-offs. Each entry also gets `scoreWithinStuartLimit`, where an
  answer fails when it took longer than production's 20 s or one request
  wrote more than its 8,000 tokens.
- A third score, `scoreIgnoringLength`, grades a sentence Stuart rejected
  only for its length (more than two sentences, or over 280 characters;
  three and 400 for Mezo support) on its content, as if Stuart had shown
  it. It is computed offline (`bench/matrix/length.ts`): the stored tool
  calls run again through Stuart's own tools, each result checked against
  the digest of what the model read, and the sentence then has to pass
  every other check Stuart runs (greeting, claim, every number and address
  from this turn's tools, the whole-response check) and every bench check.
- Every rejected answer counts once, under one reason
  (`rejectionReasons`, adding up to `rejectedAnswers`): Stuart's own reason
  for a sentence it rejected, or a `reply_` reason for a reply to a turn
  with no tool run, which is graded on the model's whole text.
- The model's own words are graded, never Stuart's text (the rules are at
  the top of `bench/grade.ts`). When Stuart's checks reject a sentence (over
  two sentences, over 280 characters, an unsourced number) and show a tool's
  template instead, the answer fails once, as "answer rejected"; a turn that
  ends with no answer sentence fails as such. With no tool, Stuart shows
  only the model's question or its own out-of-scope line, so the model's
  whole text is graded instead, once it is a clean reply: no claim to have
  acted, no number or address the user did not write (a bench rule for
  text Stuart never shows: Stuart itself never sources the user's numbers); its length is not
  held against it. A card counts as the model's answer, and the record says
  so. Every branch checks the model's whole text for a claim to have acted.
- Raw results land per entry and run in `bench/results/matrix/<name>/`
  (gitignored), written after every graded answer: running again resumes
  and never repeats a finished run. Each answer keeps what the grader needs
  (the response, the model's own text, its tool calls), so a change to a
  question's checks, or to the grader, is re-graded offline (`--regrade`,
  and at the start of every run); only a changed question or fixture is
  asked again. Each matrix has one fingerprint (`fingerprint.json`: Stuart's
  prompt, tools and code, the packages it imports, the world, the limits):
  a run or a publish that would mix fingerprints is refused, so a change to
  Stuart needs a new `--name`. `--replay-from <name>` replays another
  matrix's stored answers through Stuart and the grader as they are now,
  offline; it equals a fresh run only while Stuart's prompt is unchanged.
- One invocation uses a matrix at a time (`run.lock`, released on exit and
  on Ctrl+C, and taken over when the process that held it is gone). An
  answer lost to API errors in three invocations is set aside and reported
  (`--retry-abandoned` tries it again). A full matrix runs for hours: run it
  where nothing stops it after a few minutes, and run the same command
  again to resume.
- Each answer records pass or fail, how it ended, what became of the
  model's sentence, every failed check with its failure type
  (`bench/failures.ts`; the types and the question kinds are defined in
  `@matchbox/contracts/bench`), safety, wall time with tools, tokens and
  cache tokens, cost, the models that served it, tools called and the text
  shown.
- The published file, `bench/published/results.json`, follows
  `@matchbox/contracts/bench` and is rebuilt from every finished run, so
  entries added later sit beside earlier ones. About a third of the
  questions are public (`bench/public.ts`, with their checks in plain
  words). Whole families sit on one side of the split (`bench/split.ts`:
  paraphrases, a shared text or opening, a shared expected value), so a
  public answer never gives a held-back question away. Publishing also
  searches every public answer for a held-back question's values and fails
  on a hit (reviewed exceptions in `bench/leaks.ts`). Only
  public questions carry their text, checks and answers; held-back ones
  appear only inside the scores. `bench/published/sample.json` is invented
  sample data for building the leaderboard.
- Estimates come from a calibration run (`bench/matrix/estimate.ts`) until
  an entry has metered answers, then its measured cost per answer.

## Live eval

`node apps/stuart/eval/run.ts --label <name> [--only rank.,support.]` asks
the question set in `eval/questions.ts` on the Stuart preview and scores
each answer against ground truth read from the preview API and Mezo RPC
(`eval/truth.ts`, which never imports Stuart's code). Results land in
`eval/results/` (gitignored). A full run makes about five model calls.
