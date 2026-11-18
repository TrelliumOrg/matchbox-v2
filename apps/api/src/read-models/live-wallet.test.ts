import {
  walletActivitySchema,
  walletOverviewSchema,
  walletRewardsSchema,
} from "@matchbox/contracts/read-models"
import {
  demoGaugeCards,
  demoGaugeDirectory,
  demoNow,
  demoPrices,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import {
  buildLiveWalletDocuments,
  type LiveWalletSnapshot,
} from "./live-wallet"
import { gaugeCardsFrom } from "./wallet-extras"

const wad = 10n ** 18n
const wallet = `0x${"ab".repeat(20)}`
const kiln = demoGaugeCards.kilnLabs.gauge.address
const mezo = "0x7b7c000000000000000000000000000000000001"
const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"

const snapshot: LiveWalletSnapshot = {
  block: 13_100_000,
  locks: [
    {
      escrow: "vemezo",
      tokenId: "2207",
      amount: 48_000n * wad,
      end: 1_894_147_200,
      isPermanent: false,
      votingPower: 41_260n * wad,
      votes: [{ gauge: kiln, voter: "boost", weight: 41_260n * wad }],
      lastVotedAt: demoNow - 3_600,
      earned: [
        { gauge: kiln, token: mezo, amount: (4_730n * wad) / 100n },
        { gauge: kiln, token: musd, amount: 2n * wad },
      ],
    },
    {
      escrow: "vebtc",
      tokenId: "9",
      amount: wad / 2n,
      end: 0,
      isPermanent: true,
      votingPower: wad / 2n,
      votes: [],
      lastVotedAt: 0,
      earned: [],
    },
  ],
}

describe("live wallet documents", () => {
  it("builds an overview, rewards and empty activity that parse", () => {
    const documents = buildLiveWalletDocuments({
      address: wallet,
      snapshot,
      cards: gaugeCardsFrom(demoGaugeDirectory),
      prices: demoPrices,
      nowSeconds: demoNow,
    })
    const overview = walletOverviewSchema.parse(documents.overview)
    walletRewardsSchema.parse(documents.rewards)
    walletActivitySchema.parse(documents.activity)
    const [vemezo, vebtc] = overview.locks
    expect(vemezo).toMatchObject({
      tab: "vemezo",
      locked: { amount: "48000", usd: "8832.00" },
      votingPower: "41260",
      vote: {
        status: "voted",
        votes: "41260",
        allocations: [{ gauge: { name: "Kiln Labs" }, basisPoints: 10_000 }],
      },
      claimable: { usd: "10.70" },
    })
    expect(vemezo?.projected?.tokens[0]?.amount).toBe("45.000345306122448979")
    expect(vebtc).toMatchObject({
      tab: "vebtc",
      isPermanent: true,
      unlocksAt: null,
      vote: { status: "not-voted" },
      projected: null,
    })
    // 47.30 MEZO at $0.184 plus 2 MUSD.
    expect(overview.claimable.usd).toBe("10.70")
    expect(overview.claimableEpoch?.number).toBe(46)
    // The permanent veBTC lock has power and no vote this epoch.
    expect(overview.suggestion).toMatchObject({
      type: "vote",
      lock: { escrow: "vebtc", tokenId: "9" },
    })
    expect(documents.rewards.byLock).toEqual([
      expect.objectContaining({
        lock: { escrow: "vemezo", tokenId: "2207" },
        gauges: [expect.objectContaining({ usd: "10.70" })],
      }),
    ])
    expect(documents.activity.rows).toEqual([])
  })

  it("renders a wallet with nothing on chain", () => {
    const documents = buildLiveWalletDocuments({
      address: wallet,
      snapshot: { block: 1, locks: [] },
      cards: new Map(),
      prices: demoPrices,
      nowSeconds: demoNow,
    })
    expect(documents.overview).toMatchObject({
      locks: [],
      claimable: { usd: "0.00", tokens: [] },
      claimableEpoch: null,
      projected: null,
      suggestion: null,
    })
  })
})
