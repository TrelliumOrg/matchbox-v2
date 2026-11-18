---
title: Incentives
description: Tokens anyone adds to a gauge for its voters, split by voting
  weight when the epoch ends.
definition: Tokens added to a gauge for one epoch. They split among that gauge's
  voters by voting weight.
updated: 2026-11-10
stuart:
  - id: earn.incentives
    title: Incentives
    answer: Anyone can add incentives to a gauge in a token the voter allows, such
      as BTC, MEZO, MUSD or mUSDC. When the epoch ends they split pro rata among
      that gauge's voters by voting weight.
    detail:
      - A token the voter does not allow reverts.
      - Incentives added during an epoch pay that epoch's voters and cannot be
        withdrawn.
    keywords:
      - incentives
      - incentive
      - add incentives
      - post incentives
      - bribe
      - bribes
      - which tokens
      - erc-20
      - erc20
      - how are incentives split
      - how is apy calculated
      - what does apy mean
    sources:
      - {
          label: "Mezo docs: Voting",
          url: "https://mezo.org/docs/users/mezo-earn/vote/"
        }
---

Incentives are tokens anyone adds to a gauge to attract votes. When the epoch ends, they split among that gauge's voters by voting weight.

## Who adds them {#who-adds-them}

Anyone can add incentives to any gauge. A veBTC holder might add some to their own veBTC gauge to draw veMEZO votes and a higher boost.

## Tokens {#tokens}

Each voter keeps a list of allowed tokens, and other tokens revert. BTC, MEZO, MUSD and mUSDC are allowed on all four voters.

Pro offers MUSD, MEZO and BTC, and checks the gauge accepts the token before you sign.

## When they pay {#when-they-pay}

Incentives added during an epoch pay that epoch's voters. They become claimable when the epoch ends, and they cannot be withdrawn once added.

## How they split {#how-they-split}

Each voter gets the gauge's incentives times their votes, over all votes on the gauge. More votes on a gauge means a smaller share for each.

| Your votes | All votes | Incentives | Your share |
| ---------- | --------- | ---------- | ---------- |
| 1,000      | 10,000    | 500 MUSD   | 50 MUSD    |
| 1,000      | 20,000    | 500 MUSD   | 25 MUSD    |

Matchbox calls them incentives. The contracts use an older name in code, such as `addBribes`.
