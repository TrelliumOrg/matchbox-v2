---
title: veMEZO
description: MEZO locked for up to 208 weeks. It votes on veBTC gauges and MEZO gauges.
definition: MEZO locked on Mezo as an NFT for up to 208 weeks. It boosts veBTC
  locks and votes on MEZO gauges.
updated: 2026-11-10
topics:
  - concepts.vemezo.lock-length#lock-length
stuart:
  - id: lock.vemezo
    title: veMEZO
    answer: veMEZO is MEZO locked as an NFT for up to 208 weeks, about 4 years. It
      boosts veBTC up to 5x through veBTC gauges and votes on MEZO gauges.
    detail:
      - veMEZO votes on veBTC gauges through the BoostVoter and on MEZO gauges
        through the ThirdPartyVoter, each with its own ballot.
      - A lock only has to reach the next Thursday 00:00 UTC, so one week always
        works.
      - veMEZO voters earn the incentives posted on the gauges they vote for.
    facts:
      - { label: Max lock, display: "208 weeks, about 4 years" }
      - { label: Max boost, display: 5x }
    keywords:
      - vemezo
      - what is vemezo
      - lock mezo
      - mezo lock
      - minimum lock
      - maximum lock
      - how long can i lock mezo
      - locking mezo
      - lock my mezo
      - rebase
      - rebases
    sources:
      - {
          label: "Mezo docs: veMEZO",
          url: "https://mezo.org/docs/users/mezo-earn/lock/vemezo/"
        }
      - {
          label: "Mezo docs: veMEZO FAQs",
          url: "https://mezo.org/docs/users/mezo-earn/lock/vemezo/faqs-and-resources/"
        }
  - id: lock.expiry
    title: Lock expiry
    answer: When a lock expires its voting power is zero and you can withdraw the
      tokens, which burns the NFT. Locks cannot be withdrawn before they expire.
    detail:
      - A lock with votes needs a reset before it can be withdrawn.
      - Extend a lock before it expires to keep its voting power.
    keywords:
      - expired
      - expiry
      - expires
      - withdraw
      - unlock early
      - early unlock
      - get my mezo back
      - get my btc back
      - unlock
      - expire
      - early
      - extend
    sources:
      - {
          label: "Mezo docs: Managing veBTC locks",
          url: "https://mezo.org/docs/users/mezo-earn/lock/vebtc/managing-locks-and-colle\
            cting-rewards/"
        }
---

veMEZO is MEZO locked on Mezo for up to 208 weeks. Each lock is an NFT with voting power, which boosts veBTC locks and votes on MEZO gauges.

:::facts

- **Locks** MEZO
- **Longest lock** 208 weeks, about 4 years
- **Votes on** veBTC gauges and MEZO gauges
- **Gives** Boost to veBTC locks, up to 5×

:::

## Lock length {#lock-length}

A lock lasts up to 208 weeks, which is 4 days short of four calendar years. Its unlock date rounds down to a Thursday 00:00 UTC, so a lock must reach at least the next Thursday.

Pro offers 1 month, 6 months, 1 year or 4 years, or Auto max. A lock that cannot reach the next Thursday reverts.

:::note[Older docs said one year]
The old Matchbox docs gave a one year minimum for veMEZO. The contract has no such minimum, and a one week lock works.
:::

## Voting power {#voting-power}

Voting power is the amount locked times the time left, over 208 weeks. It falls in a straight line to zero at the unlock date, unless Auto max is on.

## What it votes on {#what-it-votes-on}

| Voter           | Gauges       | What the vote does                           |
| --------------- | ------------ | -------------------------------------------- |
| BoostVoter      | veBTC gauges | Boosts that veBTC lock, earns its incentives |
| ThirdPartyVoter | MEZO gauges  | Sends MEZO emissions, earns its incentives   |

Each voter has its own ballot, so one lock can vote on both in the same epoch.

## Unlock {#unlock}

veMEZO cannot be withdrawn before the unlock date. After it, withdraw returns the MEZO and burns the NFT, once any votes are cleared.
