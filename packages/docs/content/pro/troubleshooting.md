---
title: Troubleshooting
description: What Pro's errors mean and what to do about each.
updated: 2026-11-10
topics:
  - pro.troubleshooting.failed#failed-on-chain
  - pro.troubleshooting.reset#reset-blocked
---

Pro checks every step before your wallet opens, so most problems show in the review. This page covers the ones that do not.

## Signature rejected {#signature-rejected}

You or the wallet turned the request down. Nothing was sent, so press Try again.

## Failed on chain {#failed-on-chain}

The transaction was mined but reverted. The step shows Failed on chain with the reason, a Matchscan link and a button to try that step again.

Steps that finished stay done. The button tries the failed step again, or the failed lock's vote.

## Reset blocked {#reset-blocked}

A lock that voted this epoch cannot reset until the next epoch, and no lock can reset on Thursday from 00:00 to 01:00 UTC. The sheet says when, for example Voted, clears at 01:00.

Merge and withdraw wait for the reset. Transfer does not need one.

## Votes revert {#votes-revert}

| Message                           | Do this                                      |
| --------------------------------- | -------------------------------------------- |
| Voting opens at 01:00 UTC         | Wait for the first hour of the epoch to pass |
| Last hour, whitelisted locks only | Vote before Wednesday 23:00 UTC next time    |
| Voted this epoch                  | Save the split for the next epoch            |
| Over 30 gauges                    | Remove gauges until 30 or fewer are left     |
| Gauge is inactive                 | Remove the killed gauge from the ballot      |

## Chain data unavailable {#chain-data-unavailable}

Pro could not read Mezo. Press Try again, or set a Custom RPC in [Settings](/pro/settings).

## Gas {#gas}

Every step costs a little BTC for gas on Mezo. Keep some in the wallet before you vote or claim.
