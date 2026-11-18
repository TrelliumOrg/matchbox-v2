---
title: Mezo
description: The network Matchbox runs on, its chain ids and how gas is paid.
definition: The Bitcoin-backed network Matchbox runs on. Gas is paid in BTC.
updated: 2026-11-10
---

Mezo is the network every Matchbox product reads and writes. Gas on Mezo is paid in BTC.

:::facts

- **Mainnet chain id** `31612`
- **Testnet chain id** `31611`
- **Gas token** BTC, 18 decimals
- **API slugs** `mezo`, `mezo-testnet`

:::

## Networks {#networks}

| Network      | Slug           | Chain id |
| ------------ | -------------- | -------- |
| Mezo         | `mezo`         | 31612    |
| Mezo Testnet | `mezo-testnet` | 31611    |

Wallets need to be on Mezo to sign in Pro or Matchbox ID. Pro asks the wallet to switch when it is on another network.

## Tokens {#tokens}

| Token | Address                                      | Note                          |
| ----- | -------------------------------------------- | ----------------------------- |
| BTC   | `0x7b7C000000000000000000000000000000000000` | The gas token, also an ERC-20 |
| MEZO  | `0x7B7c000000000000000000000000000000000001` | Locked as veMEZO              |

## Gas {#gas}

Keep a little BTC in the wallet for gas. Every vote, claim and lock action is a transaction you pay for.
