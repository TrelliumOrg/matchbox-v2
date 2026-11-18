---
title: Rewards
description: What a lock earns from voting, when it becomes claimable and how to claim it.
definition: What a lock earns from its votes. It becomes claimable when the epoch ends.
updated: 2026-11-10
stuart:
  - id: rewards.claim
    title: Claiming rewards
    answer: Fees and incentives become claimable when the epoch ends, Thursday 00:00
      UTC. Claim them per lock and per voter, or all at once in Pro.
    detail:
      - Pool gauges pay trading fees as well as incentives.
      - Claim and relock adds the claimed MEZO to a veMEZO lock in the same flow.
      - Unclaimed rewards do not expire. A claim adds up every week since the
        lock last claimed.
    facts:
      - { label: Claimable from, display: Thursday 00:00 UTC }
    keywords:
      - claim
      - claiming
      - when can i claim
      - claimable
      - rewards
      - my rewards
      - unclaimed
      - claim rewards
      - how do i claim
      - claim window
      - rewards expire
      - compound
      - when are rewards
    sources:
      - {
          label: "Mezo docs: Vote FAQs",
          url: "https://mezo.org/docs/users/mezo-earn/vote/claiming-fees-emissions/"
        }
---

A lock earns from the gauges it votes for. Rewards for an epoch become claimable when that epoch ends, Thursday 00:00 UTC.

## What a lock earns {#what-a-lock-earns}

| Lock   | Voted on         | Earns                       |
| ------ | ---------------- | --------------------------- |
| veMEZO | veBTC gauges     | Incentives on those gauges  |
| veMEZO | MEZO gauges      | Incentives on those gauges  |
| veBTC  | Validator gauges | Incentives on those gauges  |
| veBTC  | Pool gauges      | Incentives and trading fees |

## Claiming {#claiming}

Rewards are claimed per lock, from each voter the lock voted on. Pro gathers them so one Claim all covers every lock, with one signature per claim.

Unclaimed rewards do not expire: a claim adds up every week since the lock last claimed. If the lock is transferred, they move to the new owner.

## Claim and relock {#claim-and-relock}

Claim and relock is a Matchbox flow, not a contract feature. It claims everything, then adds the MEZO you claimed to one of your veMEZO locks.

See [Rewards in Pro](/pro/rewards) for the screens.
