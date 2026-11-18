---
title: Optimize
description: What the Optimize button maximises, what it reads and what it leaves out.
updated: 2026-11-10
---

Optimize sets the ballot to the split that earns your selected locks the most incentives this epoch. It shows the gain on the button before you press it.

## What it maximises {#what-it-maximises}

For each gauge, your share of its incentives is your votes over all votes on it, including yours. Optimize picks the split that makes the sum of those shares, in dollars, as large as it can be.

```text title="Objective"
maximise  sum over gauges of  incentives × your votes / (other votes + your votes)
```

Adding votes to a gauge earns less with each step, because your own votes shrink your share. That is why the best split is usually spread over several gauges.

## What it reads {#what-it-reads}

- Gauges with incentives this epoch, valued in dollars.
- Each gauge's votes, less the votes your selected locks already have there.
- The voting power of the locks you selected, as one total.
- Both gauge types the escrow votes on, not only the type on screen.

## Limits {#limits}

- At most 30 gauges, the most a ballot can hold.
- Shares in steps of 0.01% that add up to exactly 100%.
- Expired veBTC gauges are left out.

## What it leaves out {#what-it-leaves-out}

Optimize looks at this epoch's incentives only. It ignores APY, boost, trading fees and later epochs, and the best split moves as other people vote.

The button reads Optimized when the ballot already matches. Stuart and the Matchbox MCP use the same solver.
