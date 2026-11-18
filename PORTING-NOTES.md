# Porting notes

What changed, and what looked wrong, while porting Matchbox code into the
shared packages. Sources are `MallardLabs/Matchbox` at `origin/main`,
`origin/feat/pro-rebuild` and the `feat/stuart-query-mvp` working tree as of
8 Nov 2026. Behaviour was kept unless a line below says otherwise.

## Toolchain

- Every package extends the root `tsconfig.base.json`. `agent-instructions/typescript.md`
  names a `@matchbox/config-ts` package, which does not exist yet.
- Internal packages export their TypeScript sources (no build step), as the
  Matchbox originals did. Only `@matchbox-dev/sdk` builds.
- vitest 2.1.9 became 4.1.12 and Workers types 4.x became 5.20261108.1. No test
  needed a change for either.
- **`@matchbox-dev/sdk` is pinned to TypeScript 5.9.3.** TypeScript 7 ships no
  JavaScript compiler API, and `openapi-typescript` (type generation) and
  tsup's declaration build both call it. Every other package uses 7.0.2.
- Biome 2.6 formats code fences inside Markdown without semicolons and
  Prettier formats them with semicolons, and `pnpm lint` runs both on every
  `.md` file. Any Markdown with a TypeScript fence fails one of them.
  `packages/sdk/biome.json` leaves Markdown to Prettier for the SDK README.
  A root-level decision is needed.
- Biome suggests `Math.max()` for two bigint comparisons in
  `rewardOptimizer.ts` and `voteMath.ts`. `Math.max` does not accept bigints,
  so the warnings stay.

## @matchbox/logger

Unchanged.

## @matchbox/chain

- The webapp's ABIs (`packages/shared/src/contracts`) held only functions and
  the indexer's (`apps/matchbox-indexer/src/decode/abis`) held only events, so
  each merged ABI is their union. Each contract also keeps an events-only ABI
  (`*_EVENTS_ABI`) because the indexer maps `toEventSelector` over them.
- Deduplicated: the four gauge lifecycle events (identical on all voters), the
  vote, gauge creation and bribe events shared by BoostVoter and the non-pools
  voters, and the voting reward events (the indexer's `bribe-voting-reward.ts`
  and `fee-voting-reward.ts` were byte-identical). PoolsVoter's `Voted` and
  `Abstained` name their second argument `pool`, and the indexer reads
  `args.pool`, so they stay separate.
- The indexer's contract kinds, ingested signatures (`HANDLED_EVENTS`, now
  `INDEXED_EVENTS`) and static contract list moved here. `StaticContract`
  drops the indexer-only fields; `fromBlock: "networkStart"` stands for the
  indexer's configured start block (5,000,000 on mainnet). The indexer port
  should build its `RegisteredContract` rows from this list.
- `OWNER_LOOKUP_ESCROWS` and `VOTER_ADDRESSES` moved from the indexer's
  `decode/constants.ts`; the indexer's `ACTION`, `SOURCE` and similar
  enumerations are not chain data and stay with it.
- mUSD: BorrowerOperations, TroveManager, PriceFeed, CollSurplusPool and the
  token addresses come from Stuart's `providers/abis.ts`. SortedTroves
  (`0x8C5D…749f`) and StabilityPool (`0x7324…0e32`) were read from
  `TroveManager.sortedTroves()` and `stabilityPool()` over mainnet RPC, and the
  function signatures used for the trove snapshot were called on chain.
  Event signatures and indexed flags come from `mezo-org/musd` interfaces.
  Testnet mUSD addresses are not recorded anywhere in Matchbox.
- **The expected trove count looks wrong.** The rebuild plan expected about
  919 troves. On 8 Nov 2026 at block 13,095,724, `SortedTroves.getSize()` and
  `TroveManager.getTroveOwnersCount()` both returned 3 (three RPC providers
  agree). The 7,421 historical `trove_updates` rows may still be right; the
  live set is small.
- `TroveStatus` uses musd's enum names (`closedByOwner`). Stuart's
  `providers/loans.ts` uses its own snake case names (`closed_by_owner`) for the
  same values; pick one when Stuart is ported.

### Pricing

- `MEZO_FALLBACK_PRICE` (0.22) and the `USE_PYTH_ORACLE` toggle are gone, as
  the plan requires. MEZO has no price unless a caller passes a live one.
- Prices are decimal strings instead of JS numbers (financial precision
  rules): `fixedPrice: string | null`, `getTokenUsdPrice` takes and returns
  strings, and `pythPriceToNumber` became `pythPriceToDecimal`, which shifts the
  integer exactly.
- **Bug:** the registry listed MUSD at `0x118917a40fa1cd7a13db0ef56c86de7973ac503`,
  39 hex digits, which no address can match. Removed; the 40-digit
  `0x118917a40faf…ac503` entry next to it is kept.
- `MEZO_PYTH_PRICE_FEED_ID` is still an all-zero placeholder (a TODO in
  Matchbox). Pyth is not wired anywhere.
- The pricing module had no tests; `src/pricing.test.ts` is new.

## @matchbox/domain

### Epochs

One module, `src/epoch.ts`, replaces four copies (five counting Pro's history
math). `packages/domain/EPOCHS.md` lists every difference. In short: they all
agree on Thursday 00:00 UTC and the one-hour vote padding; they differ in
input guards, number types and pre-launch numbering, and those differences are
kept under distinct names.

### Optimizer

- Classic's `apps/webapp/src/utils/rewardOptimizer.ts` and Pro's
  `packages/shared/src/rewards/optimizer.ts` were identical, and so were their
  ten tests (one in `node:test`, one in vitest). One copy and one suite
  remain.
- The MCP had two snapshot adapters. The working tree's (labelled
  `optimizer-live-v1`) spent 100 one-percent points greedily, per lock. The
  pro-rebuild one (labelled `reward-optimizer-1.0.0`) runs the closed-form
  optimizer once per voting domain across every lock, caps ballots at 30
  targets and signs basis points. The merged adapter is the pro-rebuild one,
  labelled `optimizer-live-v2` so stored results can be told apart from the
  greedy `optimizer-live-v1`.
- **Behaviour changes for MCP callers:** allocations are basis points
  (`percentage` is now `basisPoints / 100`, a display float with two decimals,
  not an integer); locks are optimized jointly rather than independently;
  gauges with `depositedUsd` "0" are no longer skipped up front (the optimizer
  gives them nothing); projected USD figures are rounded to cents.
- **Label:** resolved by renaming the merged optimizer to `optimizer-live-v2`.
  `optimizer-live-v1` keeps meaning the old greedy allocator.
- The working-tree test "allocates a full ballot using exact integer
  percentages" now asserts percentages that total exactly 100.00. Its other
  two cases duplicated pro-rebuild cases and are covered by them.

### MCP proposals

Only the pure parts of `packages/matchbox-mcp` moved: schemas, proposal
hashing, vote calldata (`buildVoteTransactionRequest`, now encoded with
`BOOST_VOTER_ABI` from chain, same selector on every voter) and the refresh
diff. Two steps the RPC-bound functions ran first are now exported so their
tests run without a chain: `prepareVoteWithoutChain` (ballot totals, empty and
read-only proposals) and `assertVoteProposalHash` (with
`assertProposalBinding`). Left for the Stuart port, with their tests:

- `prepareVoteTransactions` (connected path), `refreshProposal`,
  `readBestVotingPositions`, `optimizeVotesForWallet`.
- `earn.ts` (savings deposit preparation, RPC simulation) and `earn.test.ts`.
- `tools.ts` (`validateSingleVotingDomain`) and `tools.test.ts`,
  `transport.ts`, the gauge and Wormholescan adapters and their tests.

`assertProposalBinding` compares against the literal `31_612` rather than
`CHAIN_ID.mainnet`; same value, kept as written.

### Money and APY

- Pro's `lib/money.ts` (exact bigint micro-USD) and the MCP's `money.ts`
  (`@thesis-co/cent`) are one module. Neither uses floats for money.
- **Two functions were both called `formatMicroUsd`:** Classic's prints
  `~$1,234.56` and "Price unavailable"; Pro's prints `$1,234.56` and "—".
  Pro's keeps the name; Classic's is `formatApproxMicroUsd` in
  `validatorApy.ts`, whose duplicate `decimalToScaledBigInt` and
  `tokenUsdMicroValue` now come from `money.ts` (they were identical).
- Several formatters return "—", "∞" or "×" (`formatMicroUsd`,
  `formatApyBasisPoints`, `formatValidatorApy`, `formatBoost`). The v3 copy
  rules forbid em dashes in UI text; the UI should decide what to show.
- `rewardPerVeMezo`: Classic stripped the `~` its own formatter added; with
  Pro's formatter the output is the same.
- `optimalVeMEZO`: Classic computed `floor(w * M / B)` through cent Rationals
  inside a try/catch that logged with `console.error`; Pro computes it with
  bigints. Same results; Pro's version is kept. Classic's
  `oversubscribedStressColor` returns CSS and stays with the UI;
  `weightToOptimalRatio` and `oversubscribedRedWidthPercent` came over (new
  tests, they had none).

### Vote, loan and history math

- `voteMath.ts` needed Stuart's `VoteTarget`, `IncentiveToken` and price types
  and `tokenMicroUsd`; the pure parts are in `voteMath.ts` and `prices.ts`.
  Stuart's port should import them from here instead of redefining them.
- `loanMath.test.ts` used Stuart's `displayUsd` and `displayRatioBps`; the test
  carries copies so its assertions are unchanged.
- musd's `interestOwed` moved from the indexer's `decode/handlers/musd.ts` into
  `loanMath.ts`, with its test. The indexer port should import it.
- `historyMath.ts` had its own bigint epoch helpers; they now come from
  `epoch.ts`.

### Purity

`src/purity.test.ts` fails if a source file imports React, TanStack, wagmi,
Hono, Supabase, a Cloudflare or Node module, or names a Worker binding type.

## @matchbox/contracts

- `market.ts` takes epoch arithmetic from `@matchbox/domain`. Exported names
  are unchanged; `currentEpochResponse` wraps the domain's
  `currentAndNextEpoch`. A type-level assertion ties `epochSchema` to the domain
  `Epoch` type.
- The OpenAPI description said "Generated from `@repo/platform-contracts`";
  it now names `@matchbox/contracts`. That is the only change in
  `openapi.json`.
- `market.ts` had no tests; `src/market.test.ts` is new.

## @matchbox/server

Unchanged apart from imports. Workers types moved to 5.x.

## @matchbox-dev/sdk

Name and version (`1.0.0-beta.3`) kept. Types regenerated from
`@matchbox/contracts/openapi.json`; only the source comment changed. Pinned to
TypeScript 5.9.3 (see Toolchain).
