---
title: Boost
description: How veMEZO votes on a veBTC gauge raise that lock's voting power, up to 5×.
definition: Extra voting power for a veBTC lock, from 1× to 5×, set by the
  veMEZO votes on its veBTC gauge.
updated: 2026-11-10
topics:
  - concepts.boost.formula#formula
  - concepts.boost.poke#poke
stuart:
  - id: boost.mechanism
    title: How boost works
    answer: Boost multiplies a veBTC lock's voting power from 1x to 5x. veMEZO votes
      on the lock's veBTC gauge provide it, and it reaches 5x once the gauge's
      share of all veMEZO matches the lock's share of all veBTC.
    detail:
      - Boost is 1 plus 4 times the gauge's share of veMEZO voting power over
        the lock's share of veBTC voting power, capped at 5.
      - Votes past the 5x point earn incentives but add no boost.
    facts:
      - { label: Boost range, display: 1x to 5x }
      - { label: Max boost, display: 5x }
    keywords:
      - boost
      - how does boost work
      - boost multiplier
      - multiplier
      - 5x
      - max boost
      - optimal vemezo
      - boost formula
      - boosting
      - boosted
      - maximum boost
      - how does boost
    sources:
      - {
          label: "Mezo docs: Boost mechanism",
          url: "https://mezo.org/docs/users/mezo-earn/lock/vemezo/boost-mechanism/"
        }
  - id: boost.earnings
    title: What boost earns
    answer: Boost raises a veBTC lock's voting weight up to 5x, so it takes a larger
      share of the fees and incentives on the gauges it votes for. veMEZO voters
      on a veBTC gauge earn only the incentives posted there, never the lock's
      fees.
    facts:
      - { label: Max boost, display: 5x }
    keywords:
      - what does boost earn
      - boost rewards
      - boost earnings
      - why boost
      - benefit of boost
      - boosting a vebtc
      - boost my vebtc
      - boost change
      - what i earn
      - earn more
      - boost earn
      - self-boost
      - self boost
      - attract boost
    sources:
      - {
          label: "Mezo docs: Boost mechanism",
          url: "https://mezo.org/docs/users/mezo-earn/lock/vemezo/boost-mechanism/"
        }
  - id: boost.voter
    title: BoostVoter
    answer: veMEZO boosts veBTC by voting on veBTC gauges through the BoostVoter.
      Every veBTC lock has its own veBTC gauge, and anyone can post incentives
      there to attract veMEZO votes.
    keywords:
      - boostvoter
      - boost voter
      - boost gauge
      - vebtc gauge
      - attract votes
      - attract vemezo
      - boost gauges
      - vote with vemezo
      - vemezo vote
    sources:
      - {
          label: BoostVoter contract (verified),
          url: "https://explorer.mezo.org/address/0x2Ba614a598Cffa5a19d683cDCA97bac3a4931\
            3d1?tab=contract"
        }
  - id: boost.poke
    title: Boost needs a poke
    answer: Boost does not update by itself. Poke the veBTC lock after new veMEZO
      votes, a lock extension or a rebase claim, and anyone may poke a decayed
      position.
    detail:
      - The boost is stored on the lock and changes only when someone calls
        pokeBoost.
    keywords:
      - poke
      - pokeboost
      - boost not updating
      - boost did not change
      - boost didn't change
      - stale boost
      - update boost
      - poking
      - boost not applied
      - boost not showing
    sources:
      - {
          label: BoostVoter contract (verified),
          url: "https://explorer.mezo.org/address/0x2Ba614a598Cffa5a19d683cDCA97bac3a4931\
            3d1?tab=contract"
        }
  - id: boost.lower
    title: Why boost falls
    answer: Boost depends on your share of total veBTC and total veMEZO, so it falls
      when others lock more, even if your own holdings do not change.
    keywords:
      - boost dropped
      - boost went down
      - boost decreased
      - lower boost
      - boost fell
      - boost lower
      - lost boost
      - lower than expected
    sources:
      - {
          label: "Mezo docs: Boost mechanism",
          url: "https://mezo.org/docs/users/mezo-earn/lock/vemezo/boost-mechanism/"
        }
---

Boost multiplies a veBTC lock's voting power by 1× to 5×. veMEZO votes on the lock's own veBTC gauge decide how much.

## Formula {#formula}

Boost compares two shares: the gauge's share of all veMEZO voting power, and the lock's share of all veBTC voting power.

```text title="Boost"
boost = min(5, 1 + 4 × (gauge veMEZO votes / total veMEZO voting power)
                     ÷ (lock veBTC power / total veBTC power))
```

Both totals are voting power, not supply. The veBTC side uses power before boost.

## Reaching 5× {#reaching-5x}

Boost reaches 5× when the two shares are equal. The veMEZO a gauge needs for that is the lock's veBTC power times total veMEZO voting power, over total veBTC power.

Pro shows that point as the band on each veBTC gauge card. Votes past it still earn incentives but add no boost.

## Poke {#poke}

Boost is stored on the lock and does not update by itself. Anyone can poke a lock to recompute it, after new votes, an extension or when it has decayed.

## Why boost falls {#why-boost-falls}

Both sides are shares of totals. Boost falls when other people lock more veBTC or vote more veMEZO elsewhere, even when your own lock is unchanged.
