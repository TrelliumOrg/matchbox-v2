# Facts ledger

Every protocol fact the docs state, its value and where it was checked. Checked on 10 Nov 2026 against
this repository and Mezo mainnet (read-only `eth_call` to `https://mainnet.mezo.public.validationcloud.io`,
the public RPC in `packages/live/src/config.ts`, snapshot block 13,124,060). A fact that could not be
verified is not on any page; it is listed at the end. When a value changes, change it here and on the pages
named.

Sources: **code** is a path in this repository; **chain** is a read or a simulated call, never a
transaction; **Stuart** is `apps/stuart/src/query/knowledge/mezo.ts`; **matchdocs** is the old Starlight site;
**Classic** is the Classic repository's `docs/` at `5c657b5`.

Contracts read: veBTC `0x3D4b…f279`, veMEZO `0xb90f…0122`, BoostVoter `0x2Ba6…13d1`, PoolsVoter
`0x4823…1f03`, ValidatorsVoter `0xe99a…515a`, ThirdPartyVoter `0x2e6D…A6EB`, TroveManager `0x94Af…c193`,
BorrowerOperations `0x44b1…e031`, InterestRateManager `0x4a45…8285`, Morpho Blue `0x5658…A311`,
EnclaveDebtManager `0x2c5E…389A`.

## Network

| Fact             | Value                                        | Source                                                   | Pages           |
| ---------------- | -------------------------------------------- | -------------------------------------------------------- | --------------- |
| Mainnet chain id | 31612                                        | `packages/chain/src/chains.ts:5`, chain `eth_chainId`    | Mezo, Developer |
| Testnet chain id | 31611                                        | `packages/chain/src/chains.ts:4`, `contracts/network.ts` | Mezo, Developer |
| Network names    | Mezo, Mezo Testnet (`mezo`, `mezo-testnet`)  | `packages/contracts/src/network.ts`                      | Mezo, Developer |
| Gas token        | BTC, 18 decimals                             | `packages/chain/src/chains.ts:14`                        | Mezo            |
| BTC ERC-20       | `0x7b7C000000000000000000000000000000000000` | `packages/chain/src/borrow.ts:26`, chain `veBTC.token()` | Mezo            |
| MEZO token       | `0x7B7c000000000000000000000000000000000001` | `packages/chain/src/addresses.ts:18`, `veMEZO.token()`   | Mezo            |

## Epochs

| Fact               | Value                                                    | Source                                                                                  | Pages                  |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------- |
| Epoch length       | 604,800 s, 7 days                                        | `packages/domain/src/epoch.ts:12`, chain `epochNext - epochStart` on all four voters    | Epochs                 |
| Epoch start        | Thursday 00:00 UTC                                       | `epoch.ts:71`, chain `epochStart` = Thu 5 Nov 2026 00:00 UTC                            | Epochs, Rewards        |
| Epoch end          | The next Thursday 00:00 UTC                              | `epoch.ts` `describeEpoch`, chain `epochNext`                                           | Epochs                 |
| Epoch 0            | Thu 11 Dec 2025 00:00 UTC (`1_765_411_200`)              | `epoch.ts:32` (Matchbox numbering)                                                      | Epochs                 |
| Epoch number       | floor((start − Epoch 0) / 604,800), Thu 5 Nov 2026 is 47 | `epoch.ts:142`                                                                          | Epochs                 |
| Mezo Earn launch   | Thu 3 Sep 2026, Epoch 38                                 | `epoch.ts:41` (code only)                                                               | Epochs                 |
| First hour         | Thu 00:00 to 01:00 UTC: votes, resets and pokes revert   | `epoch.ts:21`, `apps/pro/src/tx/vote-window.ts:28`, chain simulation at Thu 00:30       | Epochs, Vote           |
| Last hour          | Wed 23:00 to Thu 00:00 UTC: whitelisted locks only vote  | `vote-window.ts:30`, chain simulation at Wed 23:30 (`NotWhitelistedNFT`)                | Epochs, Vote           |
| One vote per epoch | Per lock and voter, a second vote or reset reverts       | chain (`AlreadyVotedOrDeposited` on #2930)                                              | Epochs, Vote, FAQ      |
| Votes persist      | Until the lock votes again or is reset                   | chain (`usedWeights` kept for locks last voted in earlier epochs)                       | Epochs, Vote, FAQ      |
| Ballot size        | 30 gauges                                                | `packages/domain/src/voteOptimization.ts:15`, chain `maxVotingNum()` = 30 on all voters | Gauges, Vote, Optimize |
| Poke               | Anyone can poke and pokeBoost, reset needs the owner     | chain simulation from a stranger                                                        | Boost                  |
| Unlock dates       | Round down to a Thursday 00:00 UTC                       | `apps/pro/src/tx/durations.ts:49`, chain (sampled locks)                                | veBTC, veMEZO, Locks   |

## veBTC and veMEZO

| Fact                | Value                                                    | Source                                                                       | Pages                 |
| ------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------- |
| veBTC locks         | BTC, ERC-721 "veBTC"                                     | chain `token()`, `name()`                                                    | veBTC                 |
| veBTC longest lock  | 28 days (2,419,200 s)                                    | `packages/chain/src/abis/writes.ts:126`, chain (`LockDurationTooLong` above) | veBTC, Concepts, FAQ  |
| Shortest lock       | Must reach the next Thursday, a week always works        | chain (`LockDurationNotInFuture` for 1 hour and 1 day on a Tuesday)          | veBTC, veMEZO, FAQ    |
| veBTC voting power  | amount × time left / 28 days, before boost               | `durations.ts:66`, chain fit on #5963 and #6164                              | veBTC                 |
| Auto max            | `lockPermanent`: full power, no unlock date              | `writes.ts:40`, chain #6033                                                  | veBTC, veMEZO, Locks  |
| veBTC votes on      | PoolsVoter and ValidatorsVoter                           | chain `ve()`                                                                 | veBTC, Gauges         |
| veMEZO longest lock | 208 weeks (125,798,400 s), 4 days short of 4 × 365       | `writes.ts:118`, chain (`LockDurationTooLong` at 4 × 365 days)               | veMEZO, Concepts, FAQ |
| veMEZO votes on     | BoostVoter and ThirdPartyVoter                           | chain `ve()`                                                                 | veMEZO, Gauges        |
| Lock actions        | create, add, extend, merge, transfer, withdraw, auto max | `writes.ts:23-42`                                                            | Locks                 |
| Voted locks         | Cannot merge or withdraw (`AlreadyVoted`)                | chain                                                                        | Locks                 |
| Transfer with votes | Allowed, votes and unclaimed rewards move with the lock  | chain simulation, `apps/pro/src/tx/flows/transfer-sheet.tsx:37`              | Locks, Pro Locks      |
| Vesting and managed | Vesting grants cannot add, merge or split until vested   | `writes.ts:17-34`                                                            | Locks                 |

## Gauges and boost

| Fact                | Value                                                                                                         | Source                                                                                                               | Pages           |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------- |
| Gauge types         | veBTC (BoostVoter), MEZO (ThirdPartyVoter), validator, pool                                                   | `packages/contracts/src/read-models/primitives.ts:103`, chain                                                        | Gauges, Vote    |
| Pool gauges         | DEX pools and vaults, sMUSD is pool #0                                                                        | chain `PV.pools(i)`                                                                                                  | Gauges          |
| Pool gauge earnings | Trading fees and incentives                                                                                   | `apps/pro/src/tx/plans.ts:242` (`claimFees`)                                                                         | Gauges, Rewards |
| MEZO gauges         | Cross-chain through Wormhole, reward token MEZO                                                               | `gauge-kinds.ts:151-160`, chain `rewardToken()`                                                                      | Gauges          |
| Killed gauges       | Votes revert (`GaugeNotAlive`)                                                                                | `packages/chain/src/abis/writes.ts:89`                                                                               | Gauges          |
| Boost range         | 1× to 5×                                                                                                      | `packages/contracts/src/market.ts:139`, chain `getBoost` (5.0 on #6033)                                              | Boost, veBTC    |
| Boost formula       | min(5, 1 + 4 × (gauge veMEZO / veMEZO totalVotingPower) ÷ (lock unboosted / veBTC unboostedTotalVotingPower)) | `packages/ui/src/gauge-card/band.tsx:30`, `domain/optimalVeMEZO.ts`, chain exact match on #5910 (3.0376925493739253) | Boost           |
| Boost storage       | Stored on the lock, changes on `pokeBoost`                                                                    | chain #5910 (stored 3.040274, live 3.037693)                                                                         | Boost           |

## Incentives and rewards

| Fact                     | Value                                                                   | Source                                                                                                                                                                                         | Pages                |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Who adds incentives      | Anyone                                                                  | `incentives-sheet.tsx:47-48`, chain (no auth revert)                                                                                                                                           | Incentives           |
| Allowed tokens           | Allowlist per voter, BTC, MEZO, MUSD and mUSDC on all four              | chain `isWhitelistedToken`, `NotWhitelistedToken` for others                                                                                                                                   | Incentives, FAQ      |
| When they pay            | The current epoch's voters, not withdrawable                            | `incentives-sheet.tsx:48-49`                                                                                                                                                                   | Incentives           |
| Split                    | Pro rata by voting weight                                               | `packages/domain/src/voteMath.ts:9-11`                                                                                                                                                         | Incentives           |
| Claimable                | When the epoch ends, Thursday 00:00 UTC                                 | `epoch.ts:186`, `plans.ts` claim plan                                                                                                                                                          | Rewards, FAQ         |
| Claim and relock         | Matchbox flow, MEZO into the veMEZO lock with most power                | `apps/pro/src/tx/claim-request.ts:48-53`                                                                                                                                                       | Rewards, Pro Rewards |
| Unclaimed rewards expire | No. A claim adds up every week since the lock last claimed, with no cap | mezo-org/tigris `solidity/contracts/rewards/Reward.sol` `earned()` lines 185-230 at 0a3b5e8, inherited unchanged by `FeesVotingReward` and `BribeVotingReward`. Deployed bytecode not compared | Rewards              |

## Borrow

| Fact                     | Value                                                                                                                                            | Source                                                                                      | Pages  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------ |
| Troves open to new loans | Yes, anyone can open one                                                                                                                         | Owner decision, 10 Nov 2026                                                                 | Borrow |
| Trove minimum ratio      | 110%                                                                                                                                             | chain `TroveManager.MCR()` = 1.1e18                                                         | Borrow |
| Critical ratio           | 150%, system-wide: recovery mode, not one trove                                                                                                  | chain `CCR()` = 1.5e18                                                                      | Borrow |
| Minimum net debt         | 1,800 MUSD                                                                                                                                       | chain `BorrowerOperations.minNetDebt()`                                                     | Borrow |
| Borrowing fee            | 0.1%                                                                                                                                             | chain `borrowingRate()` = 1e15                                                              | Borrow |
| Interest for new troves  | 1% a year, simple                                                                                                                                | chain `InterestRateManager.interestRate()` = 100 bps                                        | Borrow |
| Redemption fee           | 0.75%                                                                                                                                            | chain `redemptionRate()` = 7.5e15                                                           | Borrow |
| Morpho market            | BTC and mUSDC, LLTV 86%, adaptive rate, fee 0                                                                                                    | chain `idToMarketParams`, `market()`                                                        | Borrow |
| Morpho liquidation bonus | About 4.38%, min(1.15, 1/(0.3 × 0.86 + 0.7)) − 1                                                                                                 | Morpho Blue formula, `docs/research/mezo-borrow-markets.md:82`                              | Borrow |
| Enclaves                 | Role-gated, mint MUSD against veBTC                                                                                                              | `packages/chain/src/abis/enclave.ts:3-11`                                                   | Borrow |
| Enclave limits           | Cap 14.5M MUSD, rate ≤ 5%, ratio ≥ 110%                                                                                                          | chain `mintCap()`, `maxRate()`, `MIN_MINIMUM_CR()`                                          | Borrow |
| Enclave liquidation      | None on chain: nothing sets `closedByLiquidation`, seizes veBTC or lets anyone but the owning Enclave touch a position. Enforcement is off chain | `docs/research/mezo-borrow-markets.md:289`, a read of the EnclaveDebtManager implementation | Borrow |

## Matchscan

Read from this repository on 11 Nov 2026. These describe what Matchscan shows, not the chain, so no chain read
was made.

| Fact                     | Value                                                                                         | Source                                                                                  | Pages               |
| ------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------- |
| Validator set            | Proof of authority (`x/poa`), status from ValidatorPool, not liveness                         | `apps/scan/src/data/validators.server.ts:47-50`, `explorer/validators/status.tsx:33-36` | Validators          |
| Validator gauges         | One per validator on the ValidatorsVoter                                                      | `apps/scan/src/data/validators.server.ts:48-49`                                         | Validators          |
| Validator vote share     | Gauge votes over votes on all validator gauges in the epoch                                   | `validators.server.ts:294-295`, `:537`                                                  | Validators, Metrics |
| Of veBTC votes           | ValidatorsVoter votes over ValidatorsVoter plus PoolsVoter votes                              | `validators.server.ts:439-445`                                                          | Validators, Metrics |
| Validator claims         | Go to the beneficiary named on the gauge                                                      | `apps/scan/src/explorer/validators/validators-sections.tsx:414`                         | Validators          |
| Blocks proposed per day  | Between two daily reads of the Blockscout counter, 00:00 to 03:00 UTC, edges off up to 3 h    | `packages/contracts/src/scan/series.ts` `chain.blocks_proposed`, `status.tsx:24-26`     | Validators, Metrics |
| Blocks proposed all time | Blockscout `validations_count`                                                                | `series.ts` `chain.blocks_proposed_total`                                               | Validators, Metrics |
| Validator uptime         | Blocks signed over blocks in the set, CometBFT commits from a community node                  | `apps/jobs/src/uptime/`                                                                 | Validators          |
| Not shown per validator  | Emissions, unclaimed rewards, voter concentration                                             | `apps/scan/src/explorer/validators/status.tsx:16-22`                                    | Validators, Metrics |
| Flows and levels         | Flow: the day's movement. Level: the day's close, a missing day is unknown, not zero          | `series.ts:43-44`, `scanLevelGaps`                                                      | Metrics             |
| Backfill-only series     | Say where they end                                                                            | `series.ts:46-50`, `apps/scan/src/data/token-pages.server.ts:298-301`                   | Metrics             |
| Network panels           | Addresses, daily active addresses, transactions per day, MUSD supply                          | `apps/scan/src/data/network.server.ts:49-57`, `series.ts` `scanMetricNotes`             | Metrics             |
| Blockscout counters      | Read up to 3 h after midnight UTC as the previous day's close                                 | `series.ts` `counters`                                                                  | Metrics             |
| Token figures            | Supply, holders, minted and burned (backfill), locked as veMEZO (`escrow.supply`)             | `token-pages.server.ts:71-82`, `:375-376`, `:568`, `series.ts` `scanMetricNotes`        | Metrics             |
| USD prices               | Only where the API prices a token, the list names BTC's, MEZO's or $1 for a dollar token      | `token-pages.server.ts:60-67`                                                           | Metrics             |
| Left out                 | TVL, fees by source, USD to voters, DEX volume in USD, per-block figures, 30 day actives, peg | `network.server.ts:41-45`                                                               | Metrics             |

## Developer platform

Every limit, scope, error code, lifetime and network on the Developer pages renders from `@matchbox/contracts`
at build time (`src/pipeline/tables.ts`), so those values are not repeated here. Also checked by hand:

| Fact                 | Value                         | Source                                                             | Pages |
| -------------------- | ----------------------------- | ------------------------------------------------------------------ | ----- |
| Key rotation overlap | 0 to 7 days, 1 day by default | `packages/contracts/src/console.ts:636-643`                        | Auth  |
| Revocation           | Within 15 seconds             | `apps/api/src/auth.ts:8`, `openapi.json` security scheme           | Auth  |
| SDK retries          | 2, at most 10 s apart         | `packages/sdk/src/client.ts:149-150`                               | SDK   |
| MCP tools            | 20, MCP off in production     | `apps/stuart/src/query/mcp.ts:15-18`, `apps/stuart/wrangler.jsonc` | MCP   |

## Disagreements and how they were resolved

1. **Votes carry over.** matchdocs said votes reset to zero every epoch. Chain: they persist. Pages follow the
   chain.
2. **Changing votes mid-epoch.** matchdocs said any time in the window. Chain and Stuart: once per epoch.
3. **Last hour.** matchdocs said voting is locked. Chain: whitelisted locks can vote, resets and pokes work.
4. **Epoch end.** matchdocs said Wednesday 23:59 UTC. Code and chain: Thursday 00:00 UTC.
5. **veMEZO minimum lock.** matchdocs said one year, Stuart one week. Chain: no fixed minimum, the lock only
   has to reach the next Thursday. The veMEZO page says so and notes the old one year claim.
6. **veMEZO maximum lock.** Docs and Stuart said 4 years. Chain: 208 weeks. Pages say 208 weeks, about 4 years.
7. **veBTC minimum lock.** matchdocs and Stuart said 1 day. Chain: 1 day reverts unless the Thursday flip is
   less than a day away. Pages say the lock must reach the next Thursday.
8. **Boost totals.** Classic said escrow `supply()`. Chain matches `totalVotingPower` and
   `unboostedTotalVotingPower` exactly.
9. **Incentive tokens.** Stuart said any ERC-20. Chain: an allowlist. Pages and the new knowledge entry say so.
10. **Transferring a voted lock.** Stuart's `lockRules.ts:54-58` requires a reset. Chain and Pro allow it.
11. **Morpho liquidation bonus.** Stuart said 4%, the formula gives 4.38%. Pages say about 4.38%.
12. **MUSD troves.** Stuart said troves are winding down and sent borrowers to Morpho. False: troves are open
    to new loans (confirmed by the owner, 10 Nov 2026). The Borrow page and the `borrow.where` note name troves beside
    Morpho, and the package test fails if "winding down" returns to any note.
13. **Reward expiry.** Stuart said unclaimed veBTC fees expire after 50 epochs, and the Rewards page said they
    stay with the lock. Mezo's reward contract source has no expiry: `earned()` sums every week since the last
    claim. The Rewards page and the `rewards.claim` note now say they do not expire.

## Not verified, left off every page

- MEZO gauges' 8% share of weekly emissions (Stuart).
- Rewards not compounding (Stuart).
- The 5 Oct 2026 incident figures and the date meta-transactions were disabled (on chain only the forwarder is
  unset).
- The BoostVoter deploy date, 8 Dec 2025, behind Epoch 0.
- The MEZO gauge venues (Aerodrome, Uniswap, Curve) named in Classic's notes.
- Whether redemptions hit the lowest-ratio trove first.
- Emissions per validator and unclaimed rewards. Matchscan does not show them, and the Validators and
  Metrics pages say so.

## Code that disagrees with the chain (for its owners)

- `apps/indexer/src/decode/constants.ts:90` uses `MAXTIME = 4 × 365 days` for both escrows. The chain uses 28
  days for veBTC and 208 weeks for veMEZO (`handlers/voting-escrow.ts:219` rebuilds unlock dates with it).
- `apps/stuart/src/query/lockRules.ts:54-58` blocked a transfer until reset. The chain allows it. Fixed in
  149f72b.
- Stuart's `earn.incentives` entry says any ERC-20. The docs bundle (`src/knowledge.gen.ts`) carries the
  corrected entry.
