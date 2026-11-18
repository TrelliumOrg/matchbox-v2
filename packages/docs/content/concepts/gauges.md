---
title: Gauges
description: The four gauge types, which lock votes on each, and what each one pays.
definition: Something locks vote for. Each gauge belongs to one of four voters
  and pays its voters the incentives posted on it.
updated: 2026-11-10
topics:
  - concepts.gauges.types#types
stuart:
  - id: gauges.mezo
    title: MEZO gauges
    answer: MEZO gauges are voted with veMEZO through the ThirdPartyVoter. They send
      MEZO emissions to pools on other chains, and voters earn the incentives
      posted on them.
    detail:
      - Each MEZO gauge points at one pool on another chain, bridged with
        Wormhole.
      - veMEZO votes on MEZO gauges on their own ballot, apart from veBTC gauges.
    keywords:
      - mezo gauges
      - mezo gauge
      - third party voter
      - thirdpartyvoter
      - cross-chain gauges
      - cross chain
      - curve
      - uniswap
      - aerodrome
      - third-party voter
      - remote gauge
      - non-staking
    sources:
      - {
          label: "Mezo docs: MEZO gauges",
          url: "https://mezo.org/docs/users/mezo-earn/vote/mezo-gauges/"
        }
      - {
          label: ThirdPartyVoter contract,
          url: "https://explorer.mezo.org/address/0x2e6D2F2CaCC1d24F9f9358030674eB307397A\
            6EB?tab=contract"
        }
---

A gauge is something locks vote for. Mezo Earn has four voters, and each runs one type of gauge.

## Types {#types}

| Type             | Voter           | Voted with | Points at                                 |
| ---------------- | --------------- | ---------- | ----------------------------------------- |
| veBTC gauges     | BoostVoter      | veMEZO     | One veBTC lock each, to boost it          |
| MEZO gauges      | ThirdPartyVoter | veMEZO     | Pools on other chains, through Wormhole   |
| Validator gauges | ValidatorsVoter | veBTC      | Mezo validators                           |
| Pool gauges      | PoolsVoter      | veBTC      | DEX pools and vaults such as MUSD Savings |

Pro names them by these types everywhere, with an icon for each. Pool gauges are named by their pair, never by address.

## What each pays {#what-each-pays}

Voters on every gauge earn the incentives posted on it for the epoch. Pool gauge voters also earn the pool's trading fees.

veMEZO voters on a veBTC gauge earn that gauge's incentives only. The lock they boost keeps its own fees and incentives.

## Ballots {#ballots}

A lock votes on each of its two voters separately. A ballot can hold up to 30 gauges, and its split always adds up to 100%.

## Killed gauges {#killed-gauges}

A gauge can be killed and later revived. Votes for a killed gauge revert, and Matchscan shows killed gauges with their weight rather than hiding them.

## Expired veBTC gauges {#expired}

When a veBTC lock expires or is withdrawn, its gauge has no weight left to boost. Pro marks it Expired, sorts it last and leaves it out of Optimize.
