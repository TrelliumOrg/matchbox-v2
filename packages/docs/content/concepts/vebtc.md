---
title: veBTC
description: BTC locked on Mezo for up to 28 days. It votes on validator and pool gauges.
definition: BTC locked on Mezo as an NFT for up to 28 days. Its voting power
  falls to zero at the unlock date.
updated: 2026-11-10
topics:
  - concepts.vebtc.lock-length#lock-length
stuart:
  - id: lock.vebtc
    title: veBTC
    answer: veBTC is BTC locked on Mezo as an NFT for up to 28 days. It votes on
      validator and pool gauges, and its voting power decays linearly to zero at
      expiry.
    detail:
      - veBTC votes on validator gauges through ValidatorsVoter and on pools and
        vaults, MUSD Savings included, through PoolsVoter.
      - The unlock date rounds down to a Thursday 00:00 UTC, so a lock must
        reach the next Thursday.
      - Auto max keeps full voting power with no unlock date until it is turned
        off.
    facts:
      - { label: Max lock, display: 28 days }
    keywords:
      - vebtc
      - what is vebtc
      - lock btc
      - btc lock
      - lock bitcoin
      - how long can i lock
      - lock duration
      - voting power
      - locking btc
      - lock my btc
    sources:
      - {
          label: "Mezo docs: veBTC",
          url: "https://mezo.org/docs/users/mezo-earn/lock/vebtc/"
        }
      - {
          label: veBTC VotingEscrow (verified),
          url: "https://explorer.mezo.org/address/0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f\
            279?tab=contract"
        }
---

veBTC is BTC locked on Mezo for up to 28 days. Each lock is an NFT with voting power, which you point at validator and pool gauges.

:::facts

- **Locks** BTC
- **Longest lock** 28 days
- **Votes on** Validator and pool gauges
- **Boosted by** veMEZO, up to 5×

:::

## Lock length {#lock-length}

A lock lasts up to 28 days. Its unlock date rounds down to a Thursday 00:00 UTC, so a lock has to reach at least the next Thursday.

A lock of one week or more always works. Pro offers 1, 2, 3 and 4 weeks, or Auto max.

## Voting power {#voting-power}

Before any boost, voting power is the amount locked times the time left, over 28 days. It falls in a straight line and reaches zero at the unlock date.

| Locked | Time left | Voting power |
| ------ | --------- | ------------ |
| 1 BTC  | 28 days   | 1 veBTC      |
| 1 BTC  | 14 days   | 0.5 veBTC    |
| 1 BTC  | 7 days    | 0.25 veBTC   |

:::note[Auto max]
Auto max keeps the full amount as voting power, with no unlock date. Turn it off to start the countdown again.
:::

## What it votes on {#what-it-votes-on}

veBTC votes on two voters, each with its own ballot. One lock can vote on both in the same epoch.

| Voter           | Gauges           |
| --------------- | ---------------- |
| ValidatorsVoter | Validator gauges |
| PoolsVoter      | Pool gauges      |

## Boost {#boost}

Every veBTC lock has its own veBTC gauge, which veMEZO holders vote on. Their votes raise the lock's voting power by up to 5×, as [Boost](/concepts/boost) explains.

## Unlock {#unlock}

After the unlock date the lock has no voting power. Withdraw returns the BTC and burns the NFT, once any votes are cleared.
