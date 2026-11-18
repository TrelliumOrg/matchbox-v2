---
title: Metrics
description: How Matchscan counts the daily figures on its Network, Tokens and Validators pages, and where each comes from.
updated: 2026-11-11
---

Matchscan's charts come from daily series, one value per UTC day. This page says what each figure counts and where it is read.

## Days, flows and levels {#days-flows-and-levels}

A flow is what moved during the day, such as transactions. A level is the value at the day's close, such as a token's supply.

A level has no value for a day its source was not read. That gap is unknown, not zero.

Some series come only from a one-time backfill. Their figures say where they end, as in Minted 30d to 31 Oct.

## Network {#network}

| Panel                  | Counts                                                                       | Source                          |
| ---------------------- | ---------------------------------------------------------------------------- | ------------------------------- |
| Addresses              | Every address Blockscout has seen, at the close                              | Blockscout counters, read daily |
| Daily active addresses | Distinct senders, recipients and created addresses of the day's transactions | Backfill only                   |
| Transactions per day   | Validated transactions that UTC day                                          | Blockscout's daily chart        |
| MUSD supply            | MUSD's `totalSupply()` at the close                                          | Matchscan's snapshot of Mezo    |

Blockscout's counters are read up to three hours after midnight UTC, as the previous day's close. All time under Transactions per day is Blockscout's total at the latest close.

## Tokens {#tokens}

| Figure           | Counts                                                          |
| ---------------- | --------------------------------------------------------------- |
| Supply           | `totalSupply()` at the close, for BTC its native supply on Mezo |
| Holders          | Blockscout's holder count at the close                          |
| Minted, Burned   | Transfers from and to the zero address that day, backfill only  |
| Locked as veMEZO | The veMEZO escrow's `supply()` at the close                     |

Prices in USD appear only where Matchscan has a price for the token. The list says when a price is BTC's, MEZO's or $1 for a dollar token.

## Validators {#validators}

| Figure          | Counts                                                                      |
| --------------- | --------------------------------------------------------------------------- |
| Blocks proposed | Blocks a validator proposed between two daily reads of its counter          |
| All time        | Every block it has proposed, Blockscout's `validations_count`               |
| Vote share      | Its gauge's veBTC votes over the votes on all validator gauges in the epoch |
| Of veBTC votes  | Votes on validator gauges over votes on validator and pool gauges           |

Read [Validators](/scan/validators#blocks-proposed) for why a day's block count has approximate edges.

## Not shown yet {#not-shown-yet}

These wait for data that can back them. Matchscan leaves them out, or says Not available yet in their place.

- Total value locked and protocol fees by source
- USD paid to veBTC voters and DEX volume in USD
- Transactions per block and success rate
- Active addresses over 30 days, which is not a sum of days
- MUSD's peg and the savings vault's share
- Validator uptime, emissions per validator and unclaimed rewards
