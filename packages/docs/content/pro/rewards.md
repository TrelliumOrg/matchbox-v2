---
title: Rewards
description: Claim what your locks earned, or claim and relock the MEZO into a veMEZO lock.
updated: 2026-11-20
topics:
  - pro.rewards.relock#claim-and-relock
---

The Rewards page shows what your locks can claim now and what the current epoch is projected to pay. Rewards become claimable when an epoch ends.

## The page {#the-page}

- Ready to claim, for the epoch that just ended.
- Projected for the current epoch, and the day it pays.
- From, with a Claim button per lock when more than one lock earns.
- Earned, the value of your claims when you claimed them.
- History of your claims, with Download CSV and See all.

## Claim {#claim}

::::steps

:::step[Press Claim all]
The sheet lists one step per lock and reward source: boost rewards, cross-chain rewards, validator rewards, pool incentives and pool fees.
:::

:::step[Review and sign]
Pro checks each claim, then asks for one signature per step. The toast reads Rewards claimed.
:::

::::

The page shows Nothing to claim when there is nothing ready.

## Claim and relock {#claim-and-relock}

Claim and relock claims everything, then adds the MEZO you claimed to a veMEZO lock. Pro picks your unexpired veMEZO lock with the most voting power.

The sheet has a switch, Relock MEZO into the lock's number, so you can turn the relock off. With it on, Pro adds an Approve step for exactly the MEZO claimed and an Add step for the lock.

:::note[No veMEZO lock]
Without a veMEZO lock, Claim and relock works as a plain claim.
:::

## Other places to claim {#other-places}

Overview has Claim all and Claim and relock too. Each lock card shows a Claim pill when that lock has rewards.

## Value when claimed {#value-when-claimed}

Each claim shows what its tokens were worth on the day you claimed them. Pro uses each token's price at 00:00 UTC on that day.

| Token                | Price                          |
| -------------------- | ------------------------------ |
| MUSD, mUSDC, mUSDT   | $1                             |
| BTC and BTC wrappers | CoinGecko's daily price of BTC |
| MEZO                 | CoinGecko's daily MEZO price   |
| Any other token      | No price                       |

Tokens are matched by contract address, never by name. A token with no price that day shows No price, never $0.

A claim gets its price about three days after its day, once CoinGecko's daily figure is final. Until then its figure is an estimate, shown in grey and marked estimate.

The activity sheet says when an estimate becomes final, for example Estimate, final by 23 Nov 2026.

An estimate prices each token the same way, by contract address, at the price Pro had nearest before the claim, else its latest price. An older claim whose price is still missing reads Value when claimed pending.

Earned adds up your claims' values when claimed. Below it, Pro counts the claims with no price, the recent claims not included yet, and any older claim not priced yet.

A claim with an estimate is left out of Earned until its price is final. So Earned only goes up when a claim's price becomes final, even when that price is lower than the estimate.

## Download CSV {#download-csv}

Download CSV on Rewards gives every claim in your history as a file, and the link on Activity gives every row.

Each line is one token of one event.

A claim's `epoch` is the epoch it paid out, as Pro shows it. That is the epoch before the one it was claimed in, which `claimed_in_epoch` gives.

A vote's or an incentive's `epoch` is the epoch it is for.

| Column              | What it holds                                  |
| ------------------- | ---------------------------------------------- |
| `date_utc`          | When it happened, ISO 8601 in UTC              |
| `epoch`             | The epoch Pro shows for the row                |
| `claimed_in_epoch`  | For a claim, the epoch it was claimed in       |
| `type`              | claim, vote, lock-create, incentive and others |
| `tx_hash`           | The transaction                                |
| `token_symbol`      | The token, as its contract names it            |
| `token_address`     | The token's contract                           |
| `amount`            | The exact amount, in whole tokens              |
| `usd_value_at_time` | The value when claimed, claims only            |
| `price_usd`         | The price used                                 |
| `price_source`      | Where the price came from, listed below        |
| `price_date_utc`    | The price's time, 00:00 UTC that day           |
| `gauge`             | The gauges paid from or voted for              |
| `lock_id`           | The locks, such as veBTC #4120                 |

`price_source` is one of these.

| Value                      | Meaning                                             |
| -------------------------- | --------------------------------------------------- |
| USD peg                    | A stablecoin, at $1                                 |
| CoinGecko daily            | CoinGecko's price at 00:00 UTC that day             |
| CoinGecko daily, BTC price | A BTC wrapper, at BTC's daily price                 |
| No price                   | No price that day, or a token Pro does not price    |
| Estimate, not final        | A recent claim's estimate, with no `price_date_utc` |
| Not priced yet             | A claim waiting for its price, with no estimate     |

Only claims carry a value. The file starts with a byte order mark, so Excel reads names that are not plain ASCII correctly.

If a download cannot be made, Pro says why on the page, for example that there were too many downloads.

If older rows are still being added to your history, the file ends with a note that says so.

:::warning[Not tax advice]
These figures are a record of what Pro shows, not tax advice. Check them against your own records and the rules where you live.
:::
