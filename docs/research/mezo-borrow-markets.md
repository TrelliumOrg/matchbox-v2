# Borrowing on Mezo: Morpho Blue markets, troves and Enclave debt

Research for the Matchscan "Borrow" rework (Loans becomes Borrow). Read-only on-chain checks on
Sun 8 Nov 2026.

- Snapshot block: **13,096,907** (2026-11-08 23:30:04 UTC). Event history from block 9,206,917 (Morpho
  deployment) to 13,096,866.
- Sources: Mezo RPC `https://mainnet.mezo.public.validationcloud.io` (`eth_getLogs` in 10,000-block
  ranges, `eth_call` at the snapshot block) and the Mezo Blockscout API
  (`https://api.explorer.mezo.org/api/v2/...`) for contract names, token metadata and holders.

## Summary

- Morpho Blue on Mezo has **2 markets**. Only **BTC / mUSDC** is live. **BTC / MUSD** was created on
  25 Oct 2026 and has never had a deposit.
- BTC / mUSDC: **77,629 mUSDC supplied, 62,711 mUSDC borrowed, 80.8% utilization**, borrow rate
  **2.04% APR (2.06% APY)**, supply **1.66% APY**, **1.3504 BTC** collateral, **7 open borrowers**
  (16 ever), **no liquidations ever**.
- All supply comes from one Morpho Vault V2, "Morpho BTC-mUSDC Vault", owned and curated by the same Safe
  that owns Morpho. No fees anywhere (market fee 0, vault performance and management fee 0).
- One borrower holds 96% of the debt (0xC853…3030: 60,486 mUSDC against 1.304 BTC).
- MUSD troves: **3 open, 55,533 MUSD debt, 17.2179 BTC collateral**. One of the three is Mezo's
  `SafetyBuffer` contract.
- MUSD supply (19.02M) is now fully explained: **PCV bootstrap debt 14.95M + Enclave debt 4.01M + trove
  debt 0.06M = 19.02M**. See "Where MUSD supply comes from".

## Contracts

| Role                | Address                                      | Notes                                                                                                                   |
| ------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Morpho Blue         | `0x565834cE7E40b8987BC20EbF83E2159467bDA311` | Deployed block 9,206,917 (25 May 2026). Verified "Morpho".                                                              |
| Morpho owner        | `0x98D8899c3030741925BE630C710A98B57F397C7a` | Gnosis Safe. Also vault owner and curator. `feeRecipient` is the zero address.                                          |
| AdaptiveCurveIrm    | `0x3760Ebc636F912a4dB9540fdA4Dec09C25C6C1e7` | Only enabled IRM (block 9,272,816).                                                                                     |
| Enabled LLTV        | 86%                                          | Only enabled LLTV (block 9,272,816).                                                                                    |
| Oracle, BTC / mUSDC | `0xeA0597D3d44FF2ea1E4c35501e153f4C025e48d1` | TransparentUpgradeableProxy, implementation `MorphoPriceOracle` `0x799C…54d4`. Upgradeable.                             |
| Oracle, BTC / MUSD  | `0x1cc8daeb91B7da756E3eA1f51eAB8c0776f0cb9B` | Unverified on Blockscout, different deployer (`0x37D5…C282`).                                                           |
| Vault               | `0x06291b67e3d7660240ab44Afc9a708d82b976a8B` | "Morpho BTC-mUSDC Vault" (`morphoBTC-mUSDC`), Morpho Vault V2, asset mUSDC, 1 adapter, 77,636 mUSDC total assets.       |
| Vault adapter       | `0xb0EE3a01d9134733155B28289c09f084Acca4F61` | `MorphoMarketV1AdapterV2`, the only supplier in the live market.                                                        |
| Flash loan user     | `0x5f81f56A7faAff242A1074cC1FFe0A6de7c69456` | 34 BTC flash loans of 0.0018 BTC, blocks 12,461,767 to 12,860,122. Unverified.                                          |
| BTC                 | `0x7b7C000000000000000000000000000000000000` | 18 decimals.                                                                                                            |
| mUSDC               | `0x04671C72Aab5AC02A03c1098314b1BB6B560c197` | "Mezo Circle USDC", 6 decimals.                                                                                         |
| MUSD                | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` | 18 decimals, total supply 19,015,628.                                                                                   |
| TroveManager        | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` | Proxy, implementation `TroveManager`.                                                                                   |
| BorrowerOperations  | `0x44b1BAC67dDA612a41a58AAf779143B181dEe031` | MUSD minter since block 178,718.                                                                                        |
| InterestRateManager | `0x4a453700d157717fe02fb62e7700ed7845048285` | MUSD minter since block 178,718.                                                                                        |
| StabilityPool       | `0x73245Eff485aB3AAc1158B3c4d8f4b23797B0e32` | Holds 14.17M MUSD.                                                                                                      |
| PCV                 | `0x391EcC7ffEFc48cff41D0F2Bb36e38b82180B993` | `debtToPay` 14,947,821 MUSD.                                                                                            |
| EnclaveDebtManager  | `0x2c5E9AFBb670c4a61aC2dCAd62C258EE2391389A` | Proxy, implementation `EnclaveDebtManager` `0x3Ea9…4C43`. Added to the MUSD mint list at block 8,550,826 (28 Apr 2026). |

## Morpho markets

|                      | BTC / mUSDC                                                          | BTC / MUSD                                                           |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Market id            | `0x6f88e79e8acb3a3ac2f990dcfb83b42ddae96ef406cd735f1721b2a2e1b733db` | `0x29c2a844b71bb5db40ca26e8880552dcd40517aa10e945b15ef616c46d5d6707` |
| Created              | block 9,274,335, Thu 28 May 2026                                     | block 12,755,635, Sun 25 Oct 2026                                    |
| Loan token           | mUSDC                                                                | MUSD                                                                 |
| Collateral           | BTC                                                                  | BTC                                                                  |
| Oracle               | `0xeA05…48d1` (price 75,328.80 at snapshot)                          | `0x1cc8…cb9B`                                                        |
| IRM                  | AdaptiveCurveIrm                                                     | AdaptiveCurveIrm                                                     |
| LLTV                 | 86%                                                                  | 86%                                                                  |
| Fee                  | 0                                                                    | 0                                                                    |
| Total supply         | 77,629.07 mUSDC                                                      | 0                                                                    |
| Total borrow         | 62,710.84 mUSDC                                                      | 0                                                                    |
| Utilization          | 80.78%                                                               | 0                                                                    |
| Borrow rate          | 2.035% APR, 2.06% APY                                                | n/a                                                                  |
| Supply rate          | 1.66% APY (borrow APY × utilization, fee 0)                          | n/a                                                                  |
| Rate at target (90%) | 2.24% APR stored, adapting down                                      | n/a                                                                  |
| Collateral           | 1.350362 BTC                                                         | 0                                                                    |
| Open borrowers       | 7 (16 addresses ever borrowed)                                       | 0                                                                    |
| Suppliers            | 1 (the vault adapter)                                                | 0                                                                    |
| Liquidations         | 0                                                                    | 0                                                                    |
| Transactions         | 1,285 touching the market                                            | 2 (create, one accrue)                                               |

Event counts across Morpho (all in BTC / mUSDC except where noted): AccrueInterest 1,082, Repay 306,
WithdrawCollateral 244, SupplyCollateral 203, Withdraw 196, Borrow 182, Supply 157, FlashLoan 34,
SetAuthorization 2, CreateMarket 2, SetOwner 1, EnableIrm 1, EnableLltv 1. **No `Liquidate` event has ever
been emitted.**

AdaptiveCurveIrm curve (steepness 4, target utilization 90%) at the stored rate at target: 0.56% APR at 0%
utilization, 2.24% at 90%, 8.94% at 100%. The live 2.035% at 80.8% is slightly under the curve because
utilization has been under target since the last accrual on 6 Nov, so the rate at target is drifting
down. Liquidation incentive at LLTV 86%: `min(1.15, 1 / (0.3 × 0.86 + 0.7))` = 4.38%.

### Open positions, BTC / mUSDC

Liquidation price = debt / (collateral × 0.86), independent of the current price. Health = collateral ×
price × LLTV / debt (1.00 is liquidation). Health is shown at the oracle price (75,329) and at the
design demo price (105,710).

| Borrower                                           | Collateral BTC | Debt mUSDC | LTV at oracle | Liquidation price | Health at oracle | Health at demo price |
| -------------------------------------------------- | -------------- | ---------- | ------------- | ----------------- | ---------------- | -------------------- |
| `0xC853E78877c758cC43ad152726Cb593f03D23030` (EOA) | 1.303962       | 60,486.22  | 61.6%         | $53,938           | 1.40             | 1.96                 |
| `0x965C18B6AC7D233C00C93c7C0039BEf6A6035D26`       | 0.045000       | 2,217.18   | 65.4%         | $57,292           | 1.32             | 1.85                 |
| `0xC12b7efBD9956f9020c2c3b9eb3a985c99320B2B`       | 0.000200       | 5.04       | 33.5%         | $29,308           | 2.57             | 3.61                 |
| `0xC6Bd6baD18F7c31fE002c94010D49cD812E93934`       | 0.000006       | 0.20       | 44.6%         | $39,088           | 1.93             | 2.70                 |
| `0x50A20E21c2be8f86746bfB8233854aD3569863fe`       | 0.000093       | 1.01       | 14.3%         | $12,545           | 6.01             | 8.43                 |
| `0x6e80164ea60673D64d5d6228beb684a1274Bb017`       | 0.001000       | 1.10       | 1.5%          | $1,281            | 58.8             | 82.5                 |
| `0xc84649E4BB52dcd2066eAe4e671f03a36a9Bc2d1`       | 0.000100       | 0.09       | 1.2%          | $1,055            | 71.4             | 100.2                |

Recent activity is almost all 0xC853…3030 (borrows of 1,000 and 2,000 on 4 Nov, repays of 1,375 and
6,720 on 5 to 6 Nov, collateral top-ups of 0.0274 and 0.2416 BTC on 8 Nov at blocks 13,095,518 and
13,095,651) and vault rebalancing (withdrawals of 18,991, 5,000 and 6,720 mUSDC, 4 to 6 Nov).

### History, BTC / mUSDC (daily close, reconstructed from events)

The first real deposits were tiny tests (28 May to early July). The market went live mid July.

| Date          | Supplied | Borrowed | Utilization | Collateral BTC |
| ------------- | -------- | -------- | ----------- | -------------- |
| 17 Jul (peak) | 278.6k   | 278.6k   | 100%        | 6.18           |
| 23 Jul        | 258.9k   | 258.9k   | 100%        | 5.72           |
| 6 Aug         | 182.6k   | 171.5k   | 94%         | 3.55           |
| 3 Sep         | 263.5k   | 211.4k   | 80%         | 3.82           |
| 1 Oct         | 153.4k   | 117.5k   | 77%         | 1.81           |
| 15 Oct        | 116.7k   | 116.7k   | 100%        | 2.05           |
| 22 Oct        | 81.9k    | 66.3k    | 81%         | 1.15           |
| 5 Nov         | 84.5k    | 69.4k    | 82%         | 1.18           |
| 8 Nov         | 77.6k    | 62.7k    | 81%         | 1.35           |

Utilization sat at 100% for most of late July and again around 12 to 15 Oct, so suppliers could not
withdraw at those times.

## MUSD troves (legacy)

TroveManager at the snapshot: `getTroveOwnersCount` 3, `getEntireSystemDebt` 55,533.00 MUSD,
`getEntireSystemColl` 17.217919 BTC. Per trove (`getEntireDebtAndColl`: collateral, principal, interest):

| Owner                                                                  | Collateral BTC | Principal MUSD | Interest MUSD | Ratio at oracle | Ratio at demo price |
| ---------------------------------------------------------------------- | -------------- | -------------- | ------------- | --------------- | ------------------- |
| `0x593c427d8C7bf5C555Ed41cd7CB7cCe8C9F15bB5`                           | 16.589214      | 14,486.90      | 8.03          | 8,621%          | 12,098%             |
| `0xA7F5Dc5955a599524A28DFf21389D88c49DBf738` (`SafetyBuffer` contract) | 0.593126       | 38,979.66      | 0.07          | 114.6%          | 160.9%              |
| `0x467FFa9B2b3300a14D44f0A2707E28014C673Fb4`                           | 0.035579       | 2,057.86       | 0.49          | 130.2%          | 182.7%              |

The earlier figure (54,858 MUSD at block 13,096,133) is confirmed at that block. Between 13,096,133 and
13,096,907 the SafetyBuffer trove's debt grew from 38,304.95 to 38,979.73 MUSD, which is the 675 MUSD
difference. At the oracle price the SafetyBuffer trove is under 120% (red in the Matchscan loan health
scale, MCR is 110%). The SafetyBuffer trove was also the target of at least three redemptions at blocks
13,095,426 to 13,095,428 (2,189 MUSD redeemed for 0.0297 BTC).

At the demo block 13,078,795 there were **4** troves (82,543 MUSD, 17.6425 BTC). The fourth was
0xC853…3030 (0.2710 BTC, 17,219.78 MUSD), closed later on Sun 8 Nov.

### A trove-to-Morpho migration, Sun 8 Nov

0xC853E78877c758cC43ad152726Cb593f03D23030, the largest Morpho borrower, moved out of its trove the same
evening (UTC): `withdrawColl` from the trove (block 13,095,507), `supplyCollateral` 0.0274 BTC to Morpho
(13,095,518, `0x6a4d…ef77`), vault withdrawals (13,095,604 and 13,095,608), `closeTrove` (13,095,621,
`0x8c15…b320`), then `supplyCollateral` 0.2416 BTC to Morpho (13,095,651, `0xf361…63b8`). Its Morpho
health went from 1.56 to 1.96 at the demo price.

## Where MUSD supply comes from

MUSD has three minters (MUSD `MintListAddressAdded` events): BorrowerOperations and InterestRateManager
(block 178,718) and **EnclaveDebtManager** (block 8,550,826). At the snapshot:

| Source                                                                 | MUSD           | Read                                                                 |
| ---------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------- |
| PCV bootstrap debt (protocol-owned MUSD, mostly in the Stability Pool) | 14,947,821     | `PCV.debtToPay()`                                                    |
| Enclave positions (MUSD minted against pledged veBTC)                  | 4,012,633      | `EnclaveDebtManager.getTotalOutstandingDebt()` (principal 4,000,000) |
| Trove debt                                                             | 55,533         | `TroveManager.getEntireSystemDebt()`                                 |
| **Sum**                                                                | **19,015,987** | MUSD `totalSupply` 19,015,628                                        |

The 359 MUSD gap is rounding between accrued and minted interest. Top MUSD holders confirm it: Stability
Pool 14.17M, NttManager (Wormhole bridge) 2.85M, IdleStrategy 1.29M.

EnclaveDebtManager ("On-chain debt accounting for Enclave-managed MUSD minting"): authorized Enclave
contracts open positions that mint MUSD against veBTC NFTs held inside the Enclave. Mint cap 14.5M,
max rate 5%, 35.59M minted and 31.59M burned since April, 63,276 MUSD interest minted. Two Enclaves hold
the role (`0x4da9e77114EE66d64Ca9457DA1FcA94d4B06fB99`, `0x147379A0174780570D07d70a14FB244EE5f2D786`). One
position is open: Enclave `0x1473…D786`, 4,000,000 MUSD at 1.00%, veBTC #6033, opened block 10,441,838.
The `0x4da9…fB99` Enclave cycled two 10.5M positions (veBTC #5730 then #6114) and closed the last on
block 13,022,717.

## Method

1. `eth_getLogs` for every log of the Morpho address in 10,000-block ranges from 9,206,917, decoded with
   the Morpho Blue event ABI (2,411 logs).
2. `CreateMarket` gives the market ids and params. `market(id)`, `AdaptiveCurveIrm.borrowRateView`,
   `rateAtTarget(id)` and `oracle.price()` at the snapshot block. Borrow APR = rate per second ×
   31,536,000, APY = e^APR − 1, supply APY = borrow APY × utilization × (1 − fee).
3. Every `onBehalf` address from the market's events read with `position(id, user)`. Shares to assets with
   the market totals.
4. Daily series replayed from events (Supply, Withdraw, Borrow, Repay, AccrueInterest interest added to
   both sides, collateral events). The replay ends exactly at the on-chain totals.
5. Troves from TroveManager views. MUSD minters from MUSD role events (Blockscout logs API), PCV and
   EnclaveDebtManager from their views. Contract names from Blockscout.

## Numbers used in the Matchscan designs

The Borrow designs (Doop canvas `hFp5UsQ4BA`, page Matchscan) use the state at block **13,096,133**
(Morpho state is identical from 13,095,651 to 13,096,907) and the shared demo price BTC $105,710:
borrowed $62,711, supplied $77,629, utilization 80.8%, borrow 2.04% APR, supply 1.66% APY, collateral
1.3504 BTC ($142,747, aggregate LTV 43.9%), 7 borrowers (16 ever), 0 liquidations, 3 troves with 54,858
MUSD and 17.2179 BTC. The shell's block ticker keeps the demo block 13,078,795, so activity rows show
dates without clock times.

## Caveats

- USD values in the Matchscan designs use the shared demo price (BTC $105,710). The Morpho oracle reads
  **$75,329** at the snapshot. Health and USD figures differ by that ratio. Liquidation prices do not.
- mUSDC is counted at $1.
- The BTC / mUSDC oracle is an upgradeable proxy controlled by Mezo, and the BTC / MUSD oracle is
  unverified.
- The supply side is a single vault controlled by one Safe that also owns Morpho. Utilization has hit 100%
  twice.
- "Borrowers" counts addresses with non-zero borrow shares. Five of the seven owe under $6.
- The trove snapshot reads views at one block. Pending redistributions were zero.
- The EnclaveDebtManager is a third borrowing system, mapped in "Enclaves" below.

## Enclaves

Read-only checks on Mon 9 Nov 2026 at block **13,098,465** (01:09 UTC), plus every log of the
EnclaveDebtManager, both Enclaves and veBTC transfers to and from them, blocks 8,190,000 to 13,098,465.
Enclaves are the third way MUSD is borrowed on Mezo and by far the largest open borrow position: 4.01M
MUSD against one veBTC, about 64× the Morpho BTC / mUSDC market.

### Summary

- **One open position**: Enclave `0x1473…D786` owes **4,012,641 MUSD** (principal 4,000,000, interest
  12,641) at **1.00% APR**, no originator fee, backed by **veBTC #6033** (250.1660 BTC, permanent lock).
  Opened Thu 16 Jul 2026, block 10,441,838.
- Collateral ratio **469%** at the MUSD price feed ($75,191), **659%** at the demo price ($105,710).
  Warning at 150%, minimum 110%. The minimum is reached at **BTC $17,643**, the warning at **$24,059**.
- Four positions ever, all at 1.00%: three by Enclave `0x4da9…fB99` (2.63M grown to 10.5M, then 10.5M
  twice), all closed by repayment. **35,588,622 MUSD minted, 31,588,622 repaid, 63,276 MUSD interest**
  minted to the PCV. No liquidations, and none are possible on chain (see Rules).
- Opening a position is not open to users. Only contracts holding `ENCLAVE_ROLE`, granted by the
  governance Safe that also owns Morpho, can call it. Two Enclaves hold it. The borrower of record is the
  Enclave itself.
- The 4,000,000 MUSD was forwarded on Sat 18 Jul to Safe `0xf365…8BC4` (the SNF voting Safe), which also
  receives #6033's voting rewards.

### Contracts and roles

| Role               | Address                                      | Notes                                                                                                                                                                                           |
| ------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EnclaveDebtManager | `0x2c5E9AFBb670c4a61aC2dCAd62C258EE2391389A` | Proxy, implementation `EnclaveDebtManager` `0x3Ea98a11D349B515e628C1CC74ca999230744C43` (verified). Created 27 Apr 2026.                                                                        |
| Governance         | `0x98D8899c3030741925BE630C710A98B57F397C7a` | Gnosis Safe, same as the Morpho owner. Admin and `GOVERNANCE_ROLE`: grants `ENCLAVE_ROLE`, sets cap and max rate.                                                                               |
| Pauser             | `0x40C7b9612B394212394EA860cACd0e176CA4Ae5B` | SafeL2. Can pause opens, repays and rate changes. Only governance unpauses.                                                                                                                     |
| Price feed         | `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88` | MUSD `PriceFeed` proxy, $75,191.20 at the snapshot.                                                                                                                                             |
| veBTC              | `0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279` | VotingEscrow.                                                                                                                                                                                   |
| Enclave A          | `0x4da9e77114EE66d64Ca9457DA1FcA94d4B06fB99` | Proxy, implementation `Enclave` `0xf74D…273d`. Created Mon 13 Apr 2026. All roles: TimelockController `0x1661…036A`.                                                                            |
| Enclave B          | `0x147379A0174780570D07d70a14FB244EE5f2D786` | Proxy, implementation `Enclave` `0x05bd…4a69`. Created Mon 22 Jun 2026. Admin and bridge manager: TimelockController `0xa0B1…5478`. Executor and BTC manager: TimelockController `0x41c2…98a6`. |
| Bridge module      | `0x17F29B073143D8cd97b5bBe492bDEffEC1C5feE5` | Holds `BRIDGE_MODULE_ROLE` on both Enclaves (mezod bridge callback).                                                                                                                            |

There is no factory. The deployer EOA `0x1236…4cAf` deployed both Enclaves and the EnclaveDebtManager as
separate proxies, and governance added Enclave B to `ENCLAVE_ROLE` on Thu 16 Jul (block 10,438,258).

Parameters at the snapshot: mint cap **14,500,000 MUSD** (3M at launch on 27 Apr, 11M on 12 May, 14.5M
on 16 Jul four minutes before the 4M open), max combined rate **5.00%**, `MIN_MINIMUM_CR` 110%, at most
20 veBTC per position, not paused. Cap used: 27.6%.

### What an Enclave is

`Enclave` ("controlling triparty-minted BTC and makes sure it never leaves the Enclave") is a role-gated
custody contract:

1. A bridge manager records a Bitcoin UTXO and calls `requestTripartyBridge`. The mezod bridge module
   mints that BTC on Mezo straight into the Enclave.
2. A BTC manager locks it as veBTC owned by the Enclave (`createLock`, `increaseAmount`, `lockPermanent`,
   `merge`, `withdraw`).
3. An executor calls an allowlist of `(contract, selector)` pairs through `execute`: EnclaveDebtManager
   open, increase, repay, add or remove pledged veBTC; Voter, ValidatorsVoter and BoostVoter `vote` and
   reward claims; MUSD Savings Rate, CL pools and gauges (Enclave A); transfers of BTC, MEZO, MUSD and
   mUSDC; Morpho vault redeem (Enclave B). veBTC and the bridge are never reachable through `execute`.

| Enclave | BTC bridged in | veBTC                                                                                                                          | Open debt      |
| ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| A       | 750.0100 BTC   | #5730 (500.0 BTC, Apr to Sep, withdrawn), now **#6114** with 500.0729 BTC, unlocks Thu 3 Dec 2026. 250.0112 BTC sits unlocked. | 0              |
| B       | 249.9999 BTC   | #6026 (one week, 24 to 29 Jun, withdrawn), then **#6033** from Mon 29 Jun, permanent by 16 Jul, now 250.1660 BTC               | 4,012,641 MUSD |

#6033 grew by 0.1661 BTC with no Enclave call adding BTC, so the growth is rebases. Both veBTCs vote every
epoch: #6033 splits across pool gauges on the Voter and about 18 validators on the ValidatorsVoter. At the demo block #6033 has 1,250.83 voting power (5.00× boost), 68.1% of all veBTC voting power (1,837.81).

### Rules

- `openPosition(id, borrower, originator, debt, interestRate, originatorFeeRate, veBtcIds, warningCR,
minimumCR)` checks: caller has `ENCLAVE_ROLE` and owns every pledged veBTC, none is pledged elsewhere,
  combined rate at most `maxRate`, total principal within the mint cap, `minimumCR` at least 110%,
  `warningCR` above it, and the position's CR at or above `minimumCR`. It mints the principal to the
  borrower.
- Collateral is the BTC locked in the pledged veBTCs (`locked(id).amount`), priced by the MUSD price
  feed. CR = collateral × price / (principal + interest + originator fee).
- `increaseDebt`, `removePledgedVeBtc` and `setPositionCRThresholds` revert if CR would end under
  `minimumCR`. Adding veBTC has no check. The Enclave can change the rate (within `maxRate`) at any time.
- Interest accrues per second on principal and is minted as MUSD to the PCV on every accrual (anyone can
  call `accrueInterest`). Repayments burn MUSD from the Enclave, pay fees first, then principal. At zero
  principal the position closes and its veBTC is released.
- **No liquidation path.** The `Status` enum has `closedByLiquidation`, but nothing in the implementation
  sets it, seizes veBTC or lets anyone but the owning Enclave touch a position. `getPositionHealthStatus`
  only reports `isBelowWarning` and `isBelowMinimum`. Enforcement under the minimum is off chain, through
  the Enclave's timelocked roles.

### Positions

Position ids are the Enclave address's first 12 bytes plus the open timestamp.

| Position          | Enclave | veBTC                    | Opened                           | Principal MUSD                                                  | Closed                                    |
| ----------------- | ------- | ------------------------ | -------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| `0x4da9…69ef8dbe` | A       | #5730                    | Tue 28 Apr, block 8,565,161      | 2,625,000, +7,875,000 on 13 May, −100,000 and +88,622 on 24 Jun | Mon 29 Jun, repaid 10,503,105             |
| `0x4da9…6a43a4fd` | A       | #5730, #6114 from 15 Sep | Tue 30 Jun, block 10,060,088     | 10,500,000                                                      | Tue 29 Sep, repaid 10,526,155             |
| `0x1473…6a5610d3` | B       | **#6033**                | **Thu 16 Jul, block 10,441,838** | **4,000,000**                                                   | **Open**                                  |
| `0x4da9…6abd0977` | A       | #6114                    | Wed 30 Sep, block 12,197,992     | 10,500,000                                                      | Thu 5 Nov, repaid 10,510,364 (13,022,717) |

All four: interest 1.00% APR, originator fee 0, warning 150%, minimum 110%, borrower and originator the
Enclave itself. Enclave A's MUSD went into the MUSD Savings Rate, CL pools and their gauges, and its
rewards (MEZO, MUSD) went to EOA `0x40f3…3844`. Enclave B sent the 4,000,000 MUSD to `0xf365…8BC4` at
block 10,482,775 (Sat 18 Jul) and has since forwarded 239,415 MEZO, 5,969 MUSD and small BTC amounts of
rewards there.

The open position over time:

| Block                        | Debt MUSD    | Interest MUSD | CR at price feed    | CR at demo price |
| ---------------------------- | ------------ | ------------- | ------------------- | ---------------- |
| 13,078,795 (demo block)      | 4,012,545.46 | 12,545.46     | 472.8% ($75,837.87) | 659.1%           |
| 13,096,907 (Morpho snapshot) | 4,012,633.22 | 12,633.22     | 469.6% ($75,328.80) | 659.0%           |
| 13,098,465                   | 4,012,640.78 | 12,640.78     | 468.8% ($75,191.20) | 659.0%           |

Interest runs at about 109.6 MUSD a day. At the demo price the collateral is worth $26,445,048.

### Numbers used in the Matchscan designs

Enclaves tab at the demo block 13,078,795 and BTC $105,710: debt 4,012,545 MUSD (principal 4,000,000),
1 open position (4 ever), collateral 250.1660 BTC ($26.45M), CR 659%, rate 1.00% APR, mint cap 14.5M
(27.6% used), 35.59M minted and 31.59M repaid since 28 Apr, 63,276 MUSD interest to the PCV, 0
liquidations. The minimum CR is reached at BTC $17,643, the warning at $24,059.

### Method

1. Verified sources and ABIs from Blockscout `GET /api/v2/smart-contracts/{implementation}` for the
   EnclaveDebtManager and both Enclave implementations (Enclave B adds `BRIDGE_MANAGER_ROLE` and blocks
   veBTC and the bridge as `execute` targets).
2. `eth_getLogs` in 10,000-block ranges for the three contracts and veBTC `Transfer` to or from either
   Enclave. Executed calls decoded from `CallExecuted` calldata.
3. `getPosition`, `getPositionDebt`, `getPositionHealthStatus`, totals and role members by `eth_call`,
   `veBTC.locked` for each token id at several blocks.
