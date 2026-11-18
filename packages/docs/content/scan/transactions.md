---
title: Transactions
description: Transactions and blocks in Matchscan, and what each page shows.
updated: 2026-11-10
---

Matchscan writes each transaction as a plain headline where it can, such as a swap or a vote. The details below it keep every raw field.

## Network {#network}

Network lists the latest transactions and blocks, newest first, with a pager. Open it from the top bar.

## A transaction {#a-transaction}

| Part           | What it shows                                                   |
| -------------- | --------------------------------------------------------------- |
| Headline       | The transaction in plain words, else Transaction                |
| Details        | Status, block, time, from, to, method, value, tokens moved, fee |
| Actions        | The decoded steps, when there are two or more                   |
| Input and logs | The raw input and each log, decoded and raw                     |

A failed transaction shows Failed with the revert reason when the chain gives one.

## A block {#a-block}

A block page shows its height, the proposer, the transactions in it and where the fees went. Previous and Next step through the chain.

Block figures cover the transaction count, gas used against the limit and the fees paid in BTC.
