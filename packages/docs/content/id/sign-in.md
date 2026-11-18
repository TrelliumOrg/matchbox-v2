---
title: Sign in
description: Sign in to Matchbox ID by signing a message with your wallet.
updated: 2026-11-10
---

You sign in to Matchbox ID with your wallet. It is a signed message, so there is no fee and no transaction.

::::steps

:::step[Connect a wallet]
Pick MetaMask, Rabby, OKX Wallet, Coinbase Wallet, Taho, WalletConnect or another browser wallet. If it is on another network, switch it to Mezo.
:::

:::step[Sign the message]
Press Sign message and confirm in your wallet. The message names the site asking, the network and when it expires.
:::

::::

The message expires in 5 minutes, so sign it soon after it appears. Smart contract wallets can sign in too.

| Message             | What happened                                |
| ------------------- | -------------------------------------------- |
| Signature rejected  | You turned the request down in the wallet    |
| Too many attempts   | Wait a moment and try again                  |
| Unsupported network | The wallet is on a network ID does not serve |
| Sign-in failed      | The signature did not check out              |

## Discord {#discord}

Discord is a linked account, not a way to sign in. Link it with the `/matchbox` command in the Mezo Discord server, and apps can then ask for your Discord details.

## Signing in to an app {#signing-in-to-an-app}

When an app sends you to Matchbox ID, the consent screen shows the app, each scope it asks for and the wallet it will see. Nothing is shared until you press Allow.
