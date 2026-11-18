---
title: Connect
description: Connect a wallet to Pro, view another address read only, and how Mezo IDs show.
updated: 2026-11-10
---

Pro reads a wallet's locks and votes, and your wallet signs every step. Press Connect wallet in the top bar, or Connect on a phone.

## Connect a wallet {#connect-a-wallet}

The drawer lists Recent, Detected and More wallets, with WalletConnect for a phone wallet. MetaMask, Rabby, OKX Wallet, Coinbase Wallet and Taho show a Get link when they are not installed.

::::steps

:::step[Pick a wallet]
Press Connect on its row. The drawer asks you to confirm in that wallet.
:::

:::step[Switch to Mezo]
If the wallet is on another network, the drawer offers Switch to Mezo. Confirm it in the wallet.
:::

::::

| Message                        | What happened                               |
| ------------------------------ | ------------------------------------------- |
| Declined in wallet             | You turned the request down in the wallet   |
| Request already open in wallet | The wallet has an earlier request waiting   |
| Wallet not found               | The wallet is not installed in this browser |
| Connection failed              | The wallet did not answer                   |

## View another address {#view-another-address}

Add `?address=0x…` to any Pro URL to see that wallet read only. The account panel then offers Stop viewing in place of Disconnect.

## Mezo ID {#mezo-id}

When a wallet has a Mezo ID, Pro shows it above the short address in the header and the account panel. The Transfer sheet also takes a Mezo ID as the recipient.
