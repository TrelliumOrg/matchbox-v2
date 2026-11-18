---
title: Locks
description: Create a lock, then add, extend, merge, transfer or withdraw it from the lock card.
updated: 2026-11-10
topics:
  - pro.locks.new#new-lock
  - pro.locks.manage#manage-a-lock
---

Locks are what you vote with. Pro creates them in the New lock sheet and manages them from the back of each lock card.

## New lock {#new-lock}

::::steps

:::step[Pick the token]
Choose MEZO or BTC. MEZO makes a veMEZO lock and BTC a veBTC lock.
:::

:::step[Enter the amount]
Type an amount or press Max. It must be above zero and within your balance.
:::

:::step[Pick the duration]
Auto max is picked by default. Unlock dates round down to a Thursday 00:00 UTC.
:::

:::step[Review and sign]
MEZO needs an approval step first, for exactly the amount. Auto max adds a step that turns it on.
:::

::::

| Lock   | Durations                                    |
| ------ | -------------------------------------------- |
| veMEZO | 1 month, 6 months, 1 year, 4 years, Auto max |
| veBTC  | 1 week, 2 weeks, 3 weeks, 4 weeks, Auto max  |

## Manage a lock {#manage-a-lock}

Press Manage on a lock card to flip it. The back lists the actions, and each opens its own sheet.

| Action   | Sheet               | Notes                                                |
| -------- | ------------------- | ---------------------------------------------------- |
| Add      | Add MEZO or Add BTC | Adds to the lock, same unlock date                   |
| Extend   | Extend unlock       | veMEZO 1 to 4 years, veBTC 1 to 4 weeks, or Auto max |
| Merge    | Merge locks         | Burns the From lock into the Into lock               |
| Transfer | Transfer            | To a 0x address or a Mezo ID, with its votes         |
| Withdraw | Withdraw            | Expired locks only                                   |

An expired lock shows only Withdraw. Every other action stays enabled, and the sheet explains anything in the way.

## What stands in the way {#what-stands-in-the-way}

Pro adds the fix to the plan where it can, so you sign it with the rest.

| Notice                        | What Pro does                                     |
| ----------------------------- | ------------------------------------------------- |
| Clears the lock's votes first | Adds a reset step before a merge or a withdraw    |
| Turns off auto max first      | Adds a step before a merge                        |
| Unclaimed rewards on the lock | Offers Claim first, since a merge would burn them |
| Voted, clears at 01:00        | The reset waits until the epoch turns over        |

A transfer needs no reset. The lock leaves your wallet with its votes, and any unclaimed rewards move with it.

## Read only locks {#read-only-locks}

Vesting locks show Vesting until and their end date, and managed locks show Managed lock. Neither can be changed in Pro.

See [Locks in Concepts](/concepts/locks) for the rules behind each action.
