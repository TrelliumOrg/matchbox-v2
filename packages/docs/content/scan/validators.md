---
title: Validators
description: Mezo's validator set in Matchscan, with each validator's veBTC votes, incentives, blocks proposed and uptime.
updated: 2026-11-12
---

Validators lists Mezo's validator set and how veBTC voters back each validator. Voting for a validator happens in Pro, through Vote on Matchbox.

## The list {#the-list}

Step through epochs with the arrows beside the epoch number. Order the table by vote share, uptime or blocks proposed.

| Column     | What it shows                                                |
| ---------- | ------------------------------------------------------------ |
| Validator  | The validator's name and operator address                    |
| Status     | In the set or Left the set                                   |
| Uptime     | Share of blocks it signed in the last 24 hours, and misses   |
| Vote share | Its gauge's share of the veBTC votes on all validator gauges |
| Voters     | Voters on its gauge in that epoch                            |
| For voters | Incentives posted for that epoch's voters                    |
| Blocks     | Blocks it proposed on the latest day with a count            |

Status is membership of the validator set. Mezo's validators are a proof of authority set, and the status comes from its ValidatorPool contract.

Uptime is liveness: see [Uptime](#uptime).

Above the table, cards show the active set and how many validators signed the newest block, veBTC votes on validator gauges and the incentives posted for their voters. A panel charts veBTC votes on validators by epoch, with their share of all veBTC votes on validators and pools.

## A validator {#a-validator}

A validator page opens by proposer address. It shows the set status, the operator, the beneficiary and the validator's gauge.

| Figure                | What it shows                                                 |
| --------------------- | ------------------------------------------------------------- |
| Blocks proposed       | Blocks on the latest day with a count, its share and all time |
| Vote share            | Its share of validator votes this epoch, with its rank        |
| Incentives for voters | Posted for this epoch's voters, at today's prices             |
| Uptime                | Signed over 24 hours, 7 days and 30 days, and the last blocks |

Below them come the gauge's votes, voters, incentives and deposits, as on a [gauge page](/scan/voting#gauges). A validator's claims go to the beneficiary named on its gauge.

The Uptime panel also shows blocks and proposals missed in 24 hours. It compares its share of blocks proposed with the share an equal turn would give.

A strip shows its newest 100 blocks: signed, missed, and the ones it proposed. A validator that has stopped signing shows when it last signed.

A proposer with no validator gauge shows its blocks and uptime alone. A killed gauge is marked Gauge inactive.

## Blocks proposed {#blocks-proposed}

Matchscan reads each validator's proposed block counter from Blockscout once a day, between 00:00 and 03:00 UTC. A day runs from one read to the next, so its edges are off by up to three hours.

A day's count needs two reads, so there is none after the first. When a validator has no count for a day, the page names it and shows no shares.

## Uptime {#uptime}

Mezo has no slashing module, so uptime exists only in the signatures on each block. Matchscan reads every block's signatures each minute from a public community node.

That is Pathrock's archive node, or Lavender Five's node when Pathrock is unhealthy. Neither is run by Mezo or Matchbox, and neither promises to stay up.

| Term            | Meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| Uptime          | Blocks it signed out of the blocks it was in the set for                    |
| Missed block    | A block its signature is absent from                                        |
| Proposed        | Blocks it proposed                                                          |
| Missed proposal | A turn to propose that produced no block, so the next validator proposed it |

A vote for no block still counts as signed: the validator was online. Each figure says which node it came from and how long ago.

When the node is behind or not answering, the pages say Uptime paused. Figures then show the time they run to instead of passing as current.

Counting started when the reader was turned on, and a window that reaches further back shows when its counts start. Older days can be filled in from Pathrock's archive.

## Not shown yet {#not-shown-yet}

| Figure                       | Why                                                         |
| ---------------------------- | ----------------------------------------------------------- |
| Emissions per validator      | No route reports emissions per validator gauge yet          |
| Unclaimed rewards and claims | Validator reward claims are not indexed yet                 |
| Voter concentration          | Voters across every validator gauge need one read per gauge |

The pages say the same in place of each figure. See [Gauges](/concepts/gauges) for how validator gauges earn.

Each block's own signatures and finality are not shown on the block pages. Uptime past 30 days is counted but not shown yet.

Mezo's validators are never jailed: its proof of authority module has no jailing.
