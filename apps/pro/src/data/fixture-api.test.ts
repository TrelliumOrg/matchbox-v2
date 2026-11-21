import {
  chainHeadSchema,
  gaugeDirectoryResponseSchema,
  gaugeProfileResponseSchema,
  pricesResponseSchema,
  proSummaryResponseSchema,
  protocolResponseSchema,
  walletActivityResponseSchema,
  walletBalancesResponseSchema,
  walletOverviewResponseSchema,
  walletRewardsResponseSchema,
} from "@matchbox/contracts/read-models"
import {
  demoGaugeProfile,
  demoGauges,
  demoWallet,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { formatIncentives } from "../lib/format/money"
import * as adapt from "./adapters"
import {
  boostedLockId,
  boostedWallet,
  fixtureEpochReference,
  fixtureResponse,
  twoLockWallet,
} from "./fixture-api"
import {
  liveSizedGaugeCount,
  poolsOnlyGaugeDirectory,
  smallPoolGauges,
  spoofedPriceGauge,
  unpricedPoolGauges,
} from "./fixture-gauges"

const now = Date.UTC(2026, 10, 8, 12)
const emptyWallet = `0x3f90${"0".repeat(32)}a17c`

function body(path: string, at = now): unknown {
  const response = fixtureResponse(path, at)
  if (response.status !== 200) throw new Error(`${path} returned 404`)
  return response.body
}

describe("fixture API", () => {
  it("serves a wallet with two veMEZO locks that have not voted", () => {
    const { data } = walletOverviewResponseSchema.parse(
      body(`/internal/pro/wallets/${twoLockWallet}/overview`),
    )
    expect(
      data.locks.map((lock) => [lock.escrow, lock.tokenId, lock.vote.status]),
    ).toEqual([
      ["vemezo", "1485", "not-voted"],
      ["vemezo", "2631", "not-voted"],
    ])
  })

  it("serves a veBTC lock with a boost gauge that voted across many gauges", () => {
    const { data } = walletOverviewResponseSchema.parse(
      body(`/internal/pro/wallets/${boostedWallet}/overview`),
    )
    const [lock] = data.locks
    expect(lock?.escrow).toBe("vebtc")
    expect(lock?.boost).not.toBeNull()
    if (lock?.vote.status !== "voted") throw new Error("the lock voted")
    expect(lock.vote.allocations.length).toBeGreaterThanOrEqual(12)
    for (const voter of lock.vote.byVoter) {
      const total = voter.allocations.reduce(
        (sum, allocation) => sum + allocation.basisPoints,
        0,
      )
      expect(total).toBe(10_000)
    }
    // The card's band finds the lock's own boost gauge in the directory.
    const directory = gaugeDirectoryResponseSchema.parse(
      body("/internal/pro/gauges"),
    )
    expect(
      directory.data.gauges.find(
        (card) =>
          card.gauge.kind === "vebtc" &&
          card.gauge.vebtcTokenId === boostedLockId,
      )?.optimalVotes,
    ).not.toBeNull()
    const activity = walletActivityResponseSchema.parse(
      body(`/internal/pro/wallets/${boostedWallet}/activity`),
    )
    expect(activity.data.rows.map((row) => row.type)).toEqual(["vote"])
  })

  it("serves every route in the shared envelopes", () => {
    expect(() =>
      z.object({ data: chainHeadSchema }).parse(body("/internal/pro/head")),
    ).not.toThrow()
    expect(() =>
      pricesResponseSchema.parse(body("/internal/pro/prices")),
    ).not.toThrow()
    expect(() =>
      gaugeDirectoryResponseSchema.parse(body("/internal/pro/gauges")),
    ).not.toThrow()
    expect(() =>
      protocolResponseSchema.parse(body("/internal/pro/protocol")),
    ).not.toThrow()
    for (const gauge of Object.values(demoGauges)) {
      if (gauge.voter !== "boost") continue
      expect(() =>
        gaugeProfileResponseSchema.parse(
          body(`/internal/pro/gauges/${gauge.address}`),
        ),
      ).not.toThrow()
    }
    for (const wallet of [demoWallet, emptyWallet]) {
      const base = `/internal/pro/wallets/${wallet}`
      expect(() =>
        walletOverviewResponseSchema.parse(body(`${base}/overview`)),
      ).not.toThrow()
      expect(() =>
        walletRewardsResponseSchema.parse(body(`${base}/rewards`)),
      ).not.toThrow()
      expect(() =>
        walletActivityResponseSchema.parse(
          body(`${base}/activity?category=claims`),
        ),
      ).not.toThrow()
    }
  })

  it("filters activity by category and answers 404 for unknown paths", () => {
    const claims = walletActivityResponseSchema.parse(
      body(`/internal/pro/wallets/${demoWallet}/activity?category=claims`),
    )
    expect(claims.data.rows.length).toBeGreaterThan(0)
    expect(claims.data.rows.every((row) => row.type === "claim")).toBe(true)
    expect(
      fixtureResponse(`/internal/pro/gauges/0x${"0".repeat(40)}`, now).status,
    ).toBe(404)
    expect(fixtureResponse("/internal/pro/nope", now).status).toBe(404)
  })

  it("advances the head with time", () => {
    const head = z.object({ data: chainHeadSchema })
    const first = head.parse(body("/internal/pro/head"))
    const later = head.parse(body("/internal/pro/head", now + 38_000))
    expect(later.data.block - first.data.block).toBe(10)
  })
})

describe("adapters on the shared demo data", () => {
  const overview = walletOverviewResponseSchema.parse(
    body(`/internal/pro/wallets/${demoWallet}/overview`),
  ).data
  const directory = gaugeDirectoryResponseSchema.parse(
    body("/internal/pro/gauges"),
  ).data
  const protocol = protocolResponseSchema.parse(
    body("/internal/pro/protocol"),
  ).data

  it("builds Overview the frames show", () => {
    const view = adapt.overview(overview, fixtureEpochReference, 9)
    expect(view.claimable.usd).toBe("212.48")
    expect(view.locks.map((lock) => [lock.kind, lock.tokenId])).toEqual([
      ["vebtc", "4120"],
      ["vemezo", "2207"],
    ])
    const mezo = view.locks[1]
    expect(mezo?.votes.map((vote) => vote.shareBps)).toEqual([7000, 3000])
    expect(mezo?.votes[0]?.weight).toBe(`${28_882n * 10n ** 18n}`)
    expect(view.activity).toHaveLength(3)
  })

  it("picks the veMEZO lock for the ballot", () => {
    const voter = adapt.voter(overview)
    expect(voter.lock?.tokenId).toBe("2207")
    expect(voter.lock?.votingPowerWei).toBe(`${41_260n * 10n ** 18n}`)
  })

  it("maps gauges, APY and the boost band", () => {
    const list = adapt.gaugeList(directory)
    const kiln = list.gauges.find((gauge) => gauge.name === "Kiln Labs")
    expect(kiln?.apyBps).toBe(256)
    expect(kiln?.votes).toBe(`${5_880_000n * 10n ** 18n}`)
    expect(kiln?.optimalVotes).toBe(`${6_970_000n * 10n ** 18n}`)
    expect(list.funded).toBeLessThanOrEqual(list.total)
  })

  it("derives the signed-out home from the summary and the funded top four", () => {
    const summary = proSummaryResponseSchema.parse(
      body("/internal/pro/summary"),
    ).data
    const top = gaugeDirectoryResponseSchema.parse(
      body("/internal/pro/gauges?funded=true&sort=incentives&limit=4"),
    ).data
    const home = adapt.home(summary, top)
    expect(home.epoch).toBe(47)
    // The total is the summary's, never the length of a page of gauges,
    // and a page of four funded gauges counts "4+".
    expect(home.gaugesTotal).toBe(summary.gaugeCount)
    expect(home.gaugesFunded).toBe(4)
    expect(home.gaugesFundedMore).toBe(true)
    expect(home.incentivesUsd).toBe(summary.incentives.usd)
    expect(home.topGauges).toHaveLength(4)
    expect(home.topGauges[0]?.name).toBe("Kiln Labs")
    // Every top gauge is funded, largest incentives first.
    const usd = home.topGauges.map((gauge) => Number(gauge.incentivesUsd))
    expect(usd.every((value) => value > 0)).toBe(true)
    expect([...usd].sort((a, b) => b - a)).toEqual(usd)
  })

  it("does not count a page of the directory as the directory", () => {
    const summary = proSummaryResponseSchema.parse(
      body("/internal/pro/summary"),
    ).data
    const page = gaugeDirectoryResponseSchema.parse(
      body("/internal/pro/gauges?funded=true&sort=incentives&limit=2"),
    ).data
    expect(page.gauges).toHaveLength(2)
    const home = adapt.home({ ...summary, gaugeCount: 782 }, page)
    expect(home.gaugesTotal).toBe(782)
    expect(home.topGauges).toHaveLength(2)
  })

  it("counts a cent and more as funded, and no APY on a few cents (P6)", () => {
    const list = adapt.gaugeList(directory)
    const tiny = list.gauges.find(
      (gauge) => gauge.address === smallPoolGauges.tiny.gauge.address,
    )
    const dust = list.gauges.find(
      (gauge) => gauge.address === smallPoolGauges.dust.gauge.address,
    )
    // The API rates them 3,648.26% and 13.00%: Pro shows neither.
    expect(smallPoolGauges.tiny.apy).toBe("3648.26")
    expect(tiny?.apyBps).toBeNull()
    expect(tiny?.incentivesUsd).toBe("0.28")
    expect(dust?.apyBps).toBeNull()
    const kiln = list.gauges.find((gauge) => gauge.name === "Kiln Labs")
    expect(kiln?.apyBps).toBe(256)
    const apiFunded = directory.gauges.filter(
      (card) => card.isAlive && card.incentives.tokens.length > 0,
    ).length
    // The dust and the unregistered token are the gauges the API counts
    // and Pro does not.
    expect(list.funded).toBe(apiFunded - 2)
  })

  it("shows no APY change beside an APY it does not show", () => {
    const tiny = gaugeProfileResponseSchema.parse(
      body(`/internal/pro/gauges/${smallPoolGauges.tiny.gauge.address}`),
    ).data
    expect(tiny.apyChange).toBe("12.57")
    const view = adapt.gaugeProfile(tiny)
    expect(view.gauge.apyBps).toBeNull()
    expect(view.apyChangeBps).toBeNull()
    // A gauge with an APY keeps its change.
    expect(adapt.gaugeProfile(demoGaugeProfile).apyChangeBps).toBe(31)
  })

  it("counts Overview's funded gauges above a cent from a whole page", () => {
    const summary = proSummaryResponseSchema.parse(
      body("/internal/pro/summary"),
    ).data
    const page = gaugeDirectoryResponseSchema.parse(
      body("/internal/pro/gauges?funded=true&sort=incentives&limit=100"),
    ).data
    expect(page.gauges).toHaveLength(page.total)
    const home = adapt.home(summary, page)
    expect(summary.fundedCount).toBe(page.total)
    expect(home.gaugesFunded).toBe(summary.fundedCount - 2)
    expect(home.gaugesFundedMore).toBe(false)
    expect(home.topGauges).toHaveLength(4)
  })

  it("reads 100+ when a full page of 100 funded gauges is not the list", () => {
    const summary = proSummaryResponseSchema.parse(
      body("/internal/pro/summary"),
    ).data
    const kiln = directory.gauges.find(
      (card) => card.gauge.name === "Kiln Labs",
    )
    if (kiln === undefined) throw new Error("fixture")
    // 100 funded gauges, none of them dust, of 140 the API counts funded.
    const page = {
      ...directory,
      total: 140,
      gauges: Array.from({ length: 100 }, () => kiln),
    }
    const home = adapt.home({ ...summary, fundedCount: 140 }, page)
    expect(home.gaugesFunded).toBe(100)
    expect(home.gaugesFundedMore).toBe(true)
  })

  it("leaves dust out of Protocol's funded list and count (P6)", () => {
    const shared = protocolResponseSchema.parse(
      body("/internal/pro/protocol"),
    ).data
    const protocol = adapt.protocol(shared)
    const listed = shared.funded.gauges.length
    // Less the dust and the unregistered token.
    expect(protocol.funded).toHaveLength(listed - 2)
    expect(protocol.fundedTotal).toBe(shared.funded.count - 2)
    expect(protocol.funded.map((entry) => entry.usd)).toContain("0.28")
    expect(protocol.funded.map((entry) => entry.usd)).not.toContain("0.004")
    const row = (name: string) =>
      protocol.funded.find((entry) => entry.name === name)
    expect(row("mUSDT/MUSD CL50")).toMatchObject({ priced: false, unpriced: 1 })
    expect(row("MUSD/mUSDT Stable")).toMatchObject({
      priced: true,
      unpriced: 1,
    })
    expect(row("FAKEBTC/MUSD Stable")).toBeUndefined()
  })

  it("decides unpriced funding on the server, by Stuart's rule", () => {
    const list = adapt.gaugeList(directory)
    const find = (address: string) =>
      list.gauges.find((gauge) => gauge.address === address)
    // A registry token without a USD value funds the gauge, unpriced.
    expect(find(unpricedPoolGauges.unpriced.gauge.address)).toMatchObject({
      funded: true,
      priced: false,
      unpriced: 1,
      apyBps: null,
    })
    expect(find(unpricedPoolGauges.mixed.gauge.address)).toMatchObject({
      funded: true,
      priced: true,
      unpriced: 1,
      apyBps: 52,
    })
    // An unregistered token never funds it, and never earns an APY.
    expect(find(unpricedPoolGauges.unregistered.gauge.address)).toMatchObject({
      funded: false,
      priced: false,
      unpriced: 1,
      apyBps: null,
    })
    expect(find(smallPoolGauges.dust.gauge.address)).toMatchObject({
      funded: false,
      unpriced: 0,
    })
  })

  it("counts registry tokens' dollars only, whatever the API totals", () => {
    // $0.02 of MUSD and a token named "BTC" outside the registry that the
    // read model values at $500,000, over 20,000 veMEZO of votes.
    const card = spoofedPriceGauge()
    expect(card.incentives.usd).toBe("500000.02")
    const gauge = adapt.gaugeSummary(card)
    expect(gauge).toMatchObject({
      incentivesUsd: "0.02",
      funded: true,
      priced: true,
      unpriced: 1,
      apyBps: null,
      apyMinVotes: null,
    })
    expect(
      formatIncentives({
        usd: gauge.incentivesUsd,
        priced: gauge.priced,
        unpriced: gauge.unpriced,
      }),
    ).toBe("$0.02 + 1 unpriced")
    // Over a dollar of registry tokens the floor holds, but the API's APY
    // counts the $500,000 and is not shown.
    const [musd, spoofed] = card.incentives.tokens
    if (musd === undefined || spoofed === undefined) throw new Error("fixture")
    const richer = adapt.gaugeSummary({
      ...card,
      incentives: {
        usd: "500005.00",
        tokens: [{ ...musd, amount: "5", usd: "5.00" }, spoofed],
      },
    })
    expect(richer).toMatchObject({
      incentivesUsd: "5.00",
      apyMinVotes: `${10n ** 22n}`,
      apyBps: null,
    })
    // The type totals, the funded types and Protocol's row add $0.02.
    const list = adapt.gaugeList({ ...directory, gauges: [card] })
    expect(list.kindTotals.vebtc.incentivesUsd).toBe("0.02")
    expect(list.fundedKinds).toEqual(["vebtc"])
    const row = adapt
      .protocol({
        ...protocol,
        funded: {
          count: 1,
          gauges: [
            { gauge: card.gauge, incentives: card.incentives, deposits: 1 },
          ],
        },
      })
      .funded.find((entry) => entry.id === card.gauge.address)
    expect(row).toMatchObject({ usd: "0.02", priced: true, unpriced: 1 })
  })

  it("ranks the funded types on the server, unpriced ones last", () => {
    const poolsOnly = poolsOnlyGaugeDirectory()
    expect(adapt.gaugeList(poolsOnly).fundedKinds).toEqual(["pool"])
    // A MEZO gauge holding only an unpriced registry token is funded, by
    // an amount no priced type can be ranked against.
    const unpriced = unpricedPoolGauges.unpriced.incentives
    const withMezo = {
      ...poolsOnly,
      gauges: poolsOnly.gauges.map((card) =>
        card.gauge.kind === "mezo" ? { ...card, incentives: unpriced } : card,
      ),
    }
    expect(adapt.gaugeList(withMezo).fundedKinds).toEqual(["pool", "mezo"])
  })

  it("totals each type's gauges and incentives on the server", () => {
    const list = adapt.gaugeList(poolsOnlyGaugeDirectory())
    const kinds = Object.values(list.kindTotals)
    expect(kinds.reduce((sum, kind) => sum + kind.count, 0)).toBe(list.total)
    expect(list.kindTotals.vebtc.incentivesUsd).toBe("0.00")
    expect(list.kindTotals.pool.incentivesUsd).not.toBe("0.00")
  })

  it("names Protocol's funded pools with their type, over their address (P7)", () => {
    const rows = adapt.protocol(protocol).funded
    const names = rows.map((entry) => entry.name)
    expect(names).toContain("BTC/MUSD Volatile")
    expect(names).toContain("mUSDC/MUSD Stable")
    expect(names).toContain("MUSD/mSolvBTC CL200")
    for (const entry of rows) expect(entry.subline).not.toBe("")
    const pool = rows.find((entry) => entry.name === "BTC/MUSD Volatile")
    expect(pool?.subline).toBe("0xb7c0…d00d")
  })

  it("numbers epochs like the demo or like the chain", () => {
    const thursday = Date.UTC(2026, 10, 5) / 1000
    expect(adapt.epochFor(thursday + 3600, fixtureEpochReference)).toEqual({
      number: 47,
      startsAt: thursday,
      endsAt: thursday + 604_800,
    })
    expect(adapt.percentToBps("2.56")).toBe(256)
    expect(adapt.percentToBps("-2.405")).toBe(-241)
    expect(adapt.toWei("1.5")).toBe("1500000000000000000")
  })

  it("words the protocol feed", () => {
    const view = adapt.protocol(protocol)
    expect(view.events.length).toBeGreaterThan(0)
    expect(view.events.every((event) => event.amount.length > 0)).toBe(true)
    expect(view.incentivesUsd).toBe(protocol.incentives.usd)
  })

  it("lets every epoch in the chart be picked", () => {
    const view = adapt.protocol(protocol)
    expect(view.browsableEpochs).toEqual(
      protocol.incentivesByEpoch.map((bar) => bar.epoch.number),
    )
    expect(view.browsableEpochs.length).toBeGreaterThan(1)
  })

  it("shows a past epoch from its snapshot, or from its bar without one", () => {
    const bars = protocol.incentivesByEpoch
    const past = bars.at(-3)
    const before = bars.at(-4)
    if (past === undefined || before === undefined) throw new Error("bars")
    const bare = adapt.protocol(protocol, {
      epoch: past.epoch.number,
      snapshot: null,
    })
    expect(bare.epoch).toBe(past.epoch.number)
    // Today's feed is not a past epoch's: it shows none.
    expect(bare.events).toEqual([])
    expect(bare.eventsTotal).toBe(0)
    expect(adapt.protocol(protocol).events.length).toBeGreaterThan(0)
    expect(bare.latestEpoch).toBe(protocol.epoch.number)
    expect(bare.incentivesUsd).toBe(past.totalUsd)
    expect(bare.funded).toEqual([])
    expect(Number(bare.incentivesChangeUsd)).toBeCloseTo(
      Number(past.totalUsd) - Number(before.totalUsd),
      2,
    )
    const unknown = adapt.protocol(protocol, { epoch: 9_999, snapshot: null })
    expect(unknown.epoch).toBe(protocol.epoch.number)
  })
})

describe("the demo's votes follow the live epoch", () => {
  const week = 7 * 86_400
  const demoStart = fixtureEpochReference.start
  const times = {
    "in the demo week": Date.UTC(2026, 10, 8, 12),
    "at the flip to Epoch 48": (demoStart + week) * 1000,
    "an hour into Epoch 48": (demoStart + week + 3600) * 1000,
    "late in Epoch 48": (demoStart + 2 * week - 60) * 1000,
    "a year on": (demoStart + 52 * week + 3 * 86_400) * 1000,
  }

  it.each(Object.entries(times))("%s", (_name, at) => {
    const overview = walletOverviewResponseSchema.parse(
      body(`/internal/pro/wallets/${demoWallet}/overview`, at),
    ).data
    const now = Math.floor(at / 1000)
    const liveStart = demoStart + Math.floor((now - demoStart) / week) * week
    const voted = overview.locks.flatMap((lock) =>
      lock.vote.status === "voted" ? [lock.vote.votedAt] : [],
    )
    // The demo wallet has a lock that voted this epoch and one that voted
    // in an earlier one, at any date the fixtures are run.
    expect(voted.some((votedAt) => votedAt >= liveStart)).toBe(true)
    expect(voted.some((votedAt) => votedAt < liveStart)).toBe(true)
    for (const votedAt of voted) expect(votedAt).toBeLessThanOrEqual(now)
  })
})

describe("wallet balances and the Overview suggestion", () => {
  const overview = walletOverviewResponseSchema.parse(
    body(`/internal/pro/wallets/${demoWallet}/overview`),
  ).data
  const balances = walletBalancesResponseSchema.parse(
    body(`/internal/pro/wallets/${emptyWallet}/balances`),
  ).data

  it("shows a wallet without locks what it could lock", () => {
    const empty = walletOverviewResponseSchema.parse(
      body(`/internal/pro/wallets/${emptyWallet}/overview`),
    ).data
    const view = adapt.overview(empty, fixtureEpochReference, 47, balances)
    expect(view.locks).toEqual([])
    expect(view.wallet?.btc).toMatchObject({ symbol: "BTC", amount: "0.0412" })
    expect(view.wallet?.mezo).toMatchObject({ symbol: "MEZO" })
    // BTC 4355.25 + MEZO 2300.00; MUSD is not lockable and not counted.
    expect(view.wallet?.usd).toBe("6655.25")
    expect(adapt.voter(empty, balances).wallet).toEqual(view.wallet)
  })

  it("keeps the screens up when the balances cannot be read", () => {
    expect(
      adapt.overview(overview, fixtureEpochReference, 47).wallet,
    ).toBeNull()
    expect(adapt.voter(overview, null).wallet).toBeNull()
  })

  it("leaves an unpriced balance out of the total", () => {
    const view = adapt.wallet({
      ...balances,
      mezo: { ...balances.mezo, usd: null },
    })
    expect(view?.usd).toBe("4355.25")
  })

  it("passes on the API's boost suggestion and no other kind", () => {
    const gauge = demoGauges.kilnLabs
    const lock = { escrow: "vemezo" as const, tokenId: "2207" }
    const boost = adapt.overview(
      {
        ...overview,
        suggestion: {
          type: "boost",
          gauge,
          lock,
          boost: "4.2",
          votes: "5880000",
          optimalVotes: "6970000",
          missingVotes: "1090000",
        },
      },
      fixtureEpochReference,
      47,
    )
    expect(boost.suggestion?.gauge.address).toBe(gauge.address)
    expect(boost.suggestion?.votesToMax).toBe(`${1_090_000n * 10n ** 18n}`)
    const full = adapt.overview(
      {
        ...overview,
        suggestion: {
          type: "boost",
          gauge,
          lock,
          boost: "5",
          votes: "6970000",
          optimalVotes: "6970000",
          missingVotes: "0",
        },
      },
      fixtureEpochReference,
      47,
    )
    expect(full.suggestion).toBeNull()
    const claim = adapt.overview(
      {
        ...overview,
        suggestion: {
          type: "claim",
          epoch: overview.claimableEpoch ?? { number: 46, start: 0, end: 1 },
          claimable: overview.claimable,
        },
      },
      fixtureEpochReference,
      47,
    )
    expect(claim.suggestion).toBeNull()
  })
})

describe("activity pages", () => {
  const path = `/internal/pro/wallets/${demoWallet}/activity`
  const read = (query: string) =>
    walletActivityResponseSchema.parse(body(`${path}${query}`)).data

  it("pages by cursor like the API, to the last row", () => {
    const all = read("").rows
    expect(all.length).toBeGreaterThan(4)
    const ids: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = read(`?limit=2${cursor === null ? "" : `&cursor=${cursor}`}`)
      expect(page.rows.length).toBeLessThanOrEqual(2)
      ids.push(...page.rows.map((row) => row.id))
      cursor = page.nextCursor
      pages += 1
    } while (cursor !== null && pages < 100)
    expect(ids).toEqual(all.map((row) => row.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("is one page when everything fits", () => {
    expect(read("?limit=100").nextCursor).toBeNull()
  })
})

describe("the demo wallet's voted lock", () => {
  it("counts as voted this epoch through its own voter, whatever the date", () => {
    // Vote reads "voted this epoch" per voter (byVoter). The demo moves the
    // lock's vote into the live epoch; when it moved only the lock's overall
    // time, the demo lock stopped counting and the smoke test's "Save for
    // Epoch 48" failed (12 Nov 2026). `check` runs this; it has no browser.
    const live = Date.now()
    const overview = walletOverviewResponseSchema.parse(
      body(`/internal/pro/wallets/${demoWallet}/overview`, live),
    ).data
    const voter = adapt.voter(overview)
    const voted = voter.locks.find((lock) => lock.tokenId === "2207")
    expect(voted?.votedThisEpoch).toBe(true)
    expect(voted?.votedVoters).toEqual(["boost"])
    // A lock that last voted before the demo week stays where it was.
    const earlier = voter.locks.find((lock) => lock.tokenId === "4120")
    expect(earlier?.votedVoters).toEqual([])
  })
})

describe("the gauge directory in pages", () => {
  const page = (query: string, options?: { directory: "live" }) => {
    const response = fixtureResponse(`/internal/pro/gauges${query}`, 0, options)
    if (response.status !== 200) throw new Error("no directory")
    return gaugeDirectoryResponseSchema.parse(response.body).data
  }

  it("pages by cursor, the offset of the page, like the API", () => {
    const first = page("?limit=10")
    expect(first.gauges).toHaveLength(10)
    expect(first.nextCursor).toBe("10")
    const second = page("?limit=10&cursor=10")
    expect(second.gauges[0]?.gauge.address).not.toBe(
      first.gauges[0]?.gauge.address,
    )
    const all = page("")
    expect(all.gauges).toHaveLength(all.total)
    expect(all.nextCursor).toBeNull()
    // The pages together are the whole directory, in order.
    expect([...first.gauges, ...second.gauges]).toEqual(all.gauges.slice(0, 20))
  })

  it("serves a directory the size of mainnet's when asked, and only then", () => {
    expect(page("?limit=100").total).toBeLessThan(100)
    const live = { directory: "live" } as const
    const first = page("?limit=100", live)
    expect(first.total).toBe(liveSizedGaugeCount)
    expect(first.gauges).toHaveLength(100)
    // Every page parses and the last one ends the list.
    let seen = first.gauges.length
    let cursor = first.nextCursor
    while (cursor !== null) {
      const next = page(`?limit=100&cursor=${cursor}`, live)
      seen += next.gauges.length
      cursor = next.nextCursor
    }
    expect(seen).toBe(liveSizedGaugeCount)
    // The first page is the same gauges either way.
    expect(first.gauges.slice(0, 24)).toEqual(page("?limit=24").gauges)
  })
})
