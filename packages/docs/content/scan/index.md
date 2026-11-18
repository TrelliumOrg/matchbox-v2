---
title: Matchscan
description: Mezo's explorer in the Matchbox family, for transactions, addresses, gauges, epochs, locks and loans.
updated: 2026-11-10
---

Matchscan is Mezo's explorer in the Matchbox family. Search an address, a transaction, a block, an epoch or a lock, and read what happened in plain words.

:::facts

- **Address** `scan.matchbox.markets`
- **Network** Mezo
- **Sections** Network, Borrow, Gauges, Locks, Epochs
- **Search** Addresses, transactions, blocks, epochs, locks

:::

## What you can search {#what-you-can-search}

The search reads the shape of what you type before asking anything. Names of gauges and labelled addresses come from Matchscan's own index.

| You type                         | Opens                         |
| -------------------------------- | ----------------------------- |
| A 20 byte address, `0x` optional | The address                   |
| A 32 byte hash, `0x` optional    | The transaction, or the block |
| A block number                   | The block                     |
| `epoch 47` or `e47`              | The epoch                     |
| `lock #604`                      | The veBTC or veMEZO lock      |
| `veBTC #604` or `veMEZO #604`    | That lock                     |
| A gauge or label name            | Matching gauges and addresses |

A bare number can be an epoch, a lock or a block, so the palette offers each reading that exists.

## Pages {#pages}

:::links

- [Transactions](/scan/transactions) Activity in plain words
- [Addresses](/scan/addresses) Positions, votes, activity and loans
- [Voting](/scan/voting) Gauges, epochs and locks
- [Validators](/scan/validators) The validator set, votes and blocks proposed
- [Borrow](/scan/borrow) Morpho markets, troves and Enclave positions
- [Metrics](/scan/metrics) How the daily figures are counted

:::

## Concepts used here {#concepts}

:::links

- [Epochs](/concepts/epochs) The weekly clock
- [Gauges](/concepts/gauges) The four gauge types
- [Borrow](/concepts/borrow) The three ways to borrow

:::
