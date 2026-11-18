---
title: Epochs
description: Mezo Earn counts votes, incentives and rewards in weekly epochs that start Thursday 00:00 UTC.
definition: One week of Mezo Earn, from Thursday 00:00 UTC to the next Thursday.
updated: 2026-11-10
topics:
  - concepts.epochs.numbers#epoch-numbers
  - concepts.epochs.windows#voting-windows
stuart:
  - id: epoch.clock
    title: The epoch clock
    answer: Mezo Earn epochs last 7 days and start Thursday 00:00 UTC. Rewards become claimable when an epoch ends, and locks expire on epoch boundaries.
    detail:
      - Votes cast in one epoch set the next epoch's emissions.
      - Lock durations round down to whole weeks.
    facts:
      - { label: Epoch length, display: 7 days }
      - { label: Epoch starts, display: Thursday 00:00 UTC }
    keywords:
      [
        epoch,
        epochs,
        how long is an epoch,
        when does the epoch,
        new epoch,
        turnover,
      ]
    sources:
      - {
          label: "Mezo docs: veBTC",
          url: "https://mezo.org/docs/users/mezo-earn/lock/vebtc/",
        }
      - {
          label: "Mezo docs: Voting",
          url: "https://mezo.org/docs/users/mezo-earn/vote/",
        }
  - id: vote.distribute_window
    title: Votes revert during the distribute window
    answer: Votes revert from Thursday 00:00 to 01:00 UTC while the epoch turns over and rewards distribute. Wait until 01:00 UTC and send the vote again.
    detail:
      - The voters reject votes, resets and pokes in that hour with DistributeWindow.
      - In the last hour before the turnover, Wednesday 23:00 to Thursday 00:00 UTC, only whitelisted locks can vote. Resets and pokes still work.
    facts:
      - { label: Distribute window, display: "Thursday 00:00 to 01:00 UTC" }
      - { label: Whitelisted only, display: "Wednesday 23:00 to 00:00 UTC" }
    keywords:
      [
        revert,
        reverts,
        reverted,
        reverting,
        failed vote,
        vote failed,
        vote fails,
        transaction failed,
        "can't vote",
        cannot vote,
        unable to vote,
        thursday,
        midnight,
        distribute window,
        distributewindow,
        wednesday,
        vote window,
        voting window,
        when can i vote,
      ]
    sources:
      - {
          label: "Mezo docs: Vote FAQs",
          url: "https://mezo.org/docs/users/mezo-earn/vote/claiming-fees-emissions/",
        }
      - {
          label: BoostVoter contract (verified),
          url: "https://explorer.mezo.org/address/0x2Ba614a598Cffa5a19d683cDCA97bac3a49313d1?tab=contract",
        }
  - id: vote.once_per_epoch
    title: One vote per lock per epoch
    answer: Each lock can vote once per epoch. Once the vote confirms, that lock's allocation is fixed until the next epoch starts Thursday 00:00 UTC, and a second vote reverts.
    detail:
      - A lock that has not voted yet this epoch can submit a new split at any point in the window, and it replaces the standing allocation.
      - veBTC votes on ValidatorsVoter and PoolsVoter separately, so a lock has one vote per epoch on each.
    facts:
      - { label: Epoch starts, display: Thursday 00:00 UTC }
    keywords:
      [
        twice,
        vote again,
        change my vote,
        change vote,
        change my votes,
        revote,
        re-vote,
        second vote,
        already voted,
        once per epoch,
        update my vote,
        same lock,
        same epoch,
      ]
    sources:
      - {
          label: "Mezo docs: Vote FAQs",
          url: "https://mezo.org/docs/users/mezo-earn/vote/claiming-fees-emissions/",
        }
      - {
          label: "Mezo docs: How to vote",
          url: "https://mezo.org/docs/users/mezo-earn/vote/how-to-vote/",
        }
  - id: vote.persist
    title: Votes persist across epochs
    answer: Votes persist across epochs. An allocation keeps earning its share of fees and incentives every epoch until you change or reset it, so there is no need to vote weekly.
    detail:
      - Voting again is how you change an allocation, not how you keep it.
    keywords:
      [
        every week,
        each week,
        weekly,
        vote every,
        need to vote,
        persist,
        do votes expire,
        votes expire,
        keep my vote,
        carry over,
        carries over,
        same votes as last epoch,
      ]
    sources:
      - {
          label: "Mezo docs: Vote FAQs",
          url: "https://mezo.org/docs/users/mezo-earn/vote/claiming-fees-emissions/",
        }
---

Mezo Earn runs in weekly epochs. Each one starts Thursday 00:00 UTC and ends when the next one starts.

Votes, incentives and rewards all count per epoch. Pro, Matchscan and the Matchbox API read the same clock, so an epoch number means the same week everywhere.

::epoch-clock

## Epoch numbers {#epoch-numbers}

Matchbox counts from Epoch 0, which started Thu 11 Dec 2025 00:00 UTC. Count whole weeks from there.

| Epoch | Starts          | Marks            |
| ----- | --------------- | ---------------- |
| 0     | Thu 11 Dec 2025 | First epoch      |
| 38    | Thu 3 Sep 2026  | Mezo Earn launch |

```ts title="Epoch number"
const epochZero = 1_765_411_200 // Thu 11 Dec 2025 00:00 UTC
const week = 604_800

function epochAt(unixSeconds: number): number {
  return Math.floor((unixSeconds - epochZero) / week)
}

epochAt(1_793_836_800) // 47, Thu 5 Nov 2026
```

The API takes an epoch by its start in unix seconds, always a multiple of `604800`.

## Voting windows {#voting-windows}

Most of the week is open for voting. The hour on each side of the turnover is not.

| Window                     | Votes                  | Resets and pokes |
| -------------------------- | ---------------------- | ---------------- |
| Thu 00:00 to 01:00 UTC     | Revert                 | Revert           |
| Thu 01:00 to Wed 23:00 UTC | Open                   | Open             |
| Wed 23:00 to Thu 00:00 UTC | Whitelisted locks only | Open             |

:::note[One vote per epoch]
A lock votes once per epoch on each voter. A second vote or a reset in the same epoch reverts until the next epoch starts.
:::

## At the boundary {#at-the-boundary}

- Votes carry into the next epoch unless you change or reset them.
- Rewards for the closing epoch become claimable.
- A lock that voted in the closing epoch can vote again from Thursday 01:00 UTC.
- Locks unlock on a Thursday 00:00 UTC boundary, because unlock dates round down to whole weeks.

## In each product {#in-each-product}

:::links

- [Vote in Pro](/pro/vote) The ballot shows the epoch it signs for
- [Epochs in Matchscan](/scan/voting) Votes and incentives for every epoch
- [Current epoch in the API](/developer/api/epochs/get-current-epoch) `GET /v1/epochs/current`
  :::
