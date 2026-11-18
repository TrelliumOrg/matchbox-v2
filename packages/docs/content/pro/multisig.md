---
title: Multisig
description: Vote, claim and manage locks from a Safe, by proposing to it or exporting a batch.
updated: 2026-11-10
---

Pro works with a Safe on Mezo in two ways. It can propose each action to your Safe, or export it as a Transaction Builder batch.

## Propose to Safe {#propose-to-safe}

::::steps

:::step[Turn on Multisig]
In Settings, set Signing to Multisig and enter the Safe on Mezo.
:::

:::step[Review]
Every review's primary button becomes Propose to Safe. It takes one signature from an owner and queues the batch on safe.mezo.org.
:::

:::step[Sign in the Safe]
Press Continue to Safe and collect the other owners' signatures there. Pro shows the progress, for example 1 of 2 signed.
:::

::::

## Export for Safe {#export-for-safe}

Every review also has an Export for Safe link, in Wallet mode too. It saves a Transaction Builder JSON file with one transaction per step and the exact calldata.

Drop the file into the Transaction Builder app in your Safe, then review and sign it there. The batch is for chain 31612, Mezo.

:::note[View the Safe]
To see the Safe's own locks in Pro, add `?address=` and the Safe's address to the URL.
:::
