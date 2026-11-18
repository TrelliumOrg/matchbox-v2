---
title: Locks
description: What you can do with a veBTC or veMEZO lock, and what stands in the way.
updated: 2026-11-10
topics:
  - concepts.locks.reset#reset-first
---

veBTC and veMEZO locks share the same actions. Some need the lock's votes cleared first, and a few locks are read only.

## Actions {#actions}

| Action   | What it does                                 |
| -------- | -------------------------------------------- |
| New lock | Locks BTC or MEZO until a Thursday you pick  |
| Add      | Adds tokens to an existing lock              |
| Extend   | Moves the unlock date later                  |
| Auto max | Keeps full voting power with no unlock date  |
| Merge    | Moves one lock into another of the same kind |
| Transfer | Sends the lock to another address            |
| Withdraw | After the unlock date, returns the tokens    |

## Reset first {#reset-first}

A lock with votes cannot merge or withdraw until its votes are reset. A reset is refused in the epoch the lock voted, and from Thursday 00:00 to 01:00 UTC.

Pro adds the reset as a step of its own, so you sign it with the rest.

## Transfer keeps the votes {#transfer}

A lock can be transferred with its votes in place. The votes and any unclaimed rewards move to the new owner with it.

## Edge cases {#edge-cases}

- veBTC and veMEZO never merge into each other.
- An Auto max lock cannot be extended. Turn Auto max off first, which sets the unlock date to the longest lock from now.
- An expired lock can only be withdrawn. It cannot be merged into.
- A vesting grant cannot be added to, merged or split until vesting ends.
- Managed locks are read only in Matchbox.

:::warning[Never approve a lock]
Approving your lock NFT to a site or contract lets it move the lock. Vote, merge and transfer from your own wallet.
:::
