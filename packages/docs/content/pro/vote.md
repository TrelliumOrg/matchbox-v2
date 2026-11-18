---
title: Vote
description: Split your locks' votes across gauges on the Vote screen, sign one vote per lock, and change them later.
updated: 2026-11-10
topics:
  - pro.vote.again#voting-again-this-epoch
  - pro.vote.optimize#optimize
  - pro.vote.safe#signing-with-a-safe
---

Each :term[epoch]{to="/concepts/epochs"}, your locks vote on gauges. A vote earns that gauge's incentives for the epoch and stays in place until you change it.

Pro shows every gauge you can vote on, projects what each split would earn, and signs one vote per lock. This page covers the Vote screen at `/vote`.

## Before you vote {#before-you-vote}

You need a veMEZO or veBTC lock. The lock decides which gauges you can vote on.

| Gauge type       | Voted with | Pays                           |
| ---------------- | ---------- | ------------------------------ |
| veBTC gauges     | veMEZO     | Incentives, boost for the lock |
| MEZO gauges      | veMEZO     | Incentives                     |
| Validator gauges | veBTC      | Incentives                     |
| Pool gauges      | veBTC      | Incentives, trading fees       |

New to locks? Start with [veBTC](/concepts/vebtc) and [veMEZO](/concepts/vemezo) in Concepts.

## Cast a vote {#cast-a-vote}

::::steps

:::step[Pick a gauge type]
The type list groups gauges by the lock that votes on them. veBTC and MEZO gauges take veMEZO, validators and pools take veBTC.
:::

:::step[Choose locks]
Under Vote with, tick one or more locks. Locks that cannot vote this epoch stay visible, with the reason under them.
:::

:::step[Pick gauges]
Click a gauge card to add it to the ballot. Click its name to open the gauge's page instead.
:::

:::step[Set the split]
Each pick takes the share that is left, and you can type or step each share. **Optimize** suggests the split that earns the most, **Split evenly** shares it equally.
:::

:::step[Review and sign]
Pro checks each vote first, then asks for one signature per lock. Two locks, two signatures.
:::

::::

::figure{drawing="vote" caption="The Vote screen, wide. The numbers match the steps above." label="The Vote screen: the gauge type list, the locks to vote with, the gauge grid and the ballot"}

The ballot rail sits on the right on wide screens. Narrower screens show a bar at the bottom instead, without the share steppers.

:::note[Votes carry over]
A lock keeps its votes from epoch to epoch until you vote again or it is reset. A new vote replaces the old one.
:::

## Voting again this epoch {#voting-again-this-epoch}

A lock casts one vote per epoch on each voter. Once it has voted this epoch, it cannot vote again until the next epoch opens.

Pro lets you change the split anyway and saves it in this browser. The button reads Save for Epoch, followed by the next epoch's number, and nothing is signed.

:::warning[Saved, not signed]
A saved split waits in this browser until the next epoch opens, at Thursday 01:00 UTC. Pro then fills the ballot with it, and you still press Review and sign.
:::

When some picked locks have voted and others have not, the fresh ones sign now. The rest are saved for the next epoch.

## When votes revert {#when-votes-revert}

Pro checks each vote before your wallet opens and says why one would fail.

| Message                           | Why                                                  |
| --------------------------------- | ---------------------------------------------------- |
| Voting opens at 01:00 UTC         | The first hour of the epoch, Thursday 00:00 to 01:00 |
| Last hour, whitelisted locks only | Wednesday 23:00 to Thursday 00:00 UTC                |
| Voted this epoch                  | The lock already voted on this voter                 |
| Over 30 gauges                    | A ballot holds 30 gauges at most                     |
| Gauge is inactive                 | The gauge was killed                                 |

## Optimize {#optimize}

Optimize finds the split across funded gauges that earns your locks the most this epoch, and shows the gain. It replaces the ballot and never opens Stuart.

- Uses current votes and incentives, so the best split moves as others vote.
- Leaves out expired veBTC gauges.
- Applies one split to every selected lock.

The method is explained in [Optimize](/pro/optimize).

## Signing with a Safe {#signing-with-a-safe}

With Signing set to Multisig in [Settings](/pro/settings), Pro proposes the votes to your Safe instead of asking your wallet. Every review also offers Export for Safe, a Transaction Builder batch for chain 31612.

See [Multisig](/pro/multisig) for both ways.
