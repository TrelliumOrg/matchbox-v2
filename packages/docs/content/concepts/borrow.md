---
title: Borrow
description: Borrowing on Mezo, through Morpho Blue, Enclaves and MUSD troves.
definition: Borrowing against BTC on Mezo, through Morpho Blue markets, Enclaves
  or MUSD troves.
updated: 2026-11-10
stuart:
  - id: borrow.where
    title: Where to borrow on Mezo
    answer: "Mezo lends against BTC two ways: an MUSD trove mints MUSD at 1% a year
      simple interest with a 0.1% borrowing fee, and Morpho Blue lends mUSDC at
      a variable rate with an 86% liquidation LTV. Enclaves also mint MUSD
      against veBTC, but only for allowlisted institutions."
    detail:
      - A trove's net debt must be at least 1,800 MUSD.
      - A BTC and MUSD Morpho market exists but had no deposits on 10 Nov 2026.
    facts:
      - { label: Trove interest, display: 1% a year }
      - { label: Trove borrowing fee, display: 0.1% }
      - { label: mUSDC liquidation LTV, display: 86% }
    keywords:
      - borrow
      - borrowing
      - where can i borrow
      - loan
      - take a loan
      - morpho
      - musdc
      - open a trove
      - open trove
      - mint musd
      - new trove
    sources:
      - {
          label: "Mezo docs: Borrow mUSDC",
          url: "https://mezo.org/docs/users/borrow/how-to-borrow-musdc/"
        }
      - {
          label: Morpho Blue on Mezo,
          url: "https://explorer.mezo.org/address/0x565834cE7E40b8987BC20EbF83E2159467bDA\
            311"
        }
      - {
          label: MUSD TroveManager,
          url: "https://explorer.mezo.org/address/0x94AfB503dBca74aC3E4929BACEeDfCe19B93c\
            193"
        }
      - {
          label: "Mezo docs: Enclaves",
          url: "https://mezo.org/docs/users/mainnet/enclaves/"
        }
  - id: borrow.troves
    title: MUSD troves
    answer: An MUSD trove must stay above a 110% collateral ratio or it can be
      liquidated. Redemptions against troves pay a 0.75% fee.
    detail:
      - Recovery mode starts when the whole system's collateral ratio falls
        below 150%, not one trove's.
      - A trove's net debt must be at least 1,800 MUSD.
    facts:
      - { label: Minimum collateral ratio, display: 110% }
      - { label: Redemption fee, display: 0.75% }
    keywords:
      - trove
      - troves
      - musd
      - collateral ratio
      - liquidation
      - redemption
      - redeemed
      - recovery mode
      - liquidated
    sources:
      - { label: "Mezo docs: MUSD", url: "https://mezo.org/docs/users/borrow/" }
      - {
          label: MUSD TroveManager,
          url: "https://explorer.mezo.org/address/0x94AfB503dBca74aC3E4929BACEeDfCe19B93c\
            193"
        }
  - id: borrow.musdc_liquidation
    title: Morpho liquidation
    answer: A Morpho mUSDC loan can be liquidated once its LTV passes the market's
      86% liquidation LTV. The liquidator takes a bonus of about 4.38% of the
      repaid debt from the collateral.
    facts:
      - { label: Liquidation LTV, display: 86% }
      - { label: Liquidation incentive, display: About 4.38% }
    keywords:
      - liquidated
      - liquidation
      - ltv
      - liquidation ltv
      - morpho liquidation
      - penalty
      - musdc liquidation
    sources:
      - {
          label: "Mezo docs: Borrow mUSDC",
          url: "https://mezo.org/docs/users/borrow/how-to-borrow-musdc/"
        }
  - id: borrow.enclaves
    title: Enclaves
    answer: Enclaves are an institutional path. Allowlisted custody contracts hold
      BTC as veBTC and can mint MUSD against it through the EnclaveDebtManager,
      and regular wallets cannot open Enclave positions.
    keywords:
      - enclave
      - enclaves
      - institutional
      - enclavedebtmanager
      - institution
      - custody
    sources:
      - {
          label: "Mezo docs: Enclaves",
          url: "https://mezo.org/docs/users/mainnet/enclaves/"
        }
---

There are three ways to borrow against BTC on Mezo. Matchbox shows all three in Matchscan, and the loans themselves are taken out on Mezo.

| Way         | Borrow | Against | Who                      |
| ----------- | ------ | ------- | ------------------------ |
| MUSD troves | MUSD   | BTC     | Anyone                   |
| Morpho Blue | mUSDC  | BTC     | Anyone                   |
| Enclaves    | MUSD   | veBTC   | Allowlisted institutions |

## Morpho Blue {#morpho-blue}

Morpho Blue runs isolated lending markets. The live one on Mezo lends mUSDC against BTC at a variable rate.

:::facts

- **Liquidation LTV** 86%
- **Rate** Variable, adaptive curve
- **Market fee** 0
- **Liquidation incentive** About 4.38%

:::

A loan can be liquidated once its loan to value passes 86%. The liquidator repays debt and takes that much collateral plus the incentive.

## Enclaves {#enclaves}

Enclaves are custody contracts that hold bridged BTC as veBTC and mint MUSD against it. Only contracts with the Enclave role can open positions.

| Setting               | Value      |
| --------------------- | ---------- |
| Mint cap              | 14.5M MUSD |
| Highest combined rate | 5% a year  |
| Lowest minimum ratio  | 110%       |

Enclave positions have no on-chain liquidation path.

## MUSD troves {#musd-troves}

Anyone can open a trove: it holds BTC and mints MUSD against it. It must stay above a 110% collateral ratio, or anyone can liquidate it.

:::facts

- **Minimum ratio** 110%
- **Recovery mode** when the whole system's ratio is below 150%
- **Minimum net debt** 1,800 MUSD
- **Borrowing fee** 0.1%
- **Interest** 1% a year, simple, for new troves
- **Redemption fee** 0.75%

:::

Anyone can redeem MUSD against troves, which repays part of a trove's debt with its BTC. A redemption pays a 0.75% fee.

:::warning[Health in Matchbox]
Matchscan colours loans red near liquidation, amber as they approach it and green when healthy. A trove under 150% shows as near liquidation.
:::
