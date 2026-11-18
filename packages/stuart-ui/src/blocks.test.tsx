import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Block } from "./blocks"
import {
  type Evidence,
  type StuartRequest,
  type UiBlock,
  uiBlockSchema,
} from "./contract"
import { fixtureTurn } from "./fixtures"
import { withHost } from "./test-host"

const request: StuartRequest = {
  version: 1,
  query: "Which gauges pay best?",
  sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
  turn: 0,
  surface: "composer",
  chainId: 31_612,
}

const evidence: Evidence[] = [
  {
    id: "e.gauges",
    kind: "indexer",
    label: "Matchbox gauges",
    source: "BoostVoter",
    blockNumber: "13078795",
    epoch: 47,
    fetchedAt: "2026-11-08T11:53:00.000Z",
    status: "live",
  },
]

const base = { version: 1, evidenceRefs: ["e.gauges"] }
const address = "0x2ba614a598cffa5a19d683cdca97bac3a49313d1"
const mezo = (
  raw: string,
): { raw: string; decimals: number; symbol: string } => ({
  raw,
  decimals: 18,
  symbol: "MEZO",
})

function block(value: Record<string, unknown>): UiBlock {
  return uiBlockSchema.parse({ ...base, ...value })
}

function show(value: UiBlock, overrides = {}): ReturnType<typeof render> {
  return render(
    withHost(<Block block={value} evidence={evidence} />, overrides),
  )
}

describe("Block renderers", () => {
  it("renders a gauge ranking with pictures, coins, APY and entity links", () => {
    const navigate = vi.fn()
    const ranking = fixtureTurn(request).response.uiBlocks.find(
      (item) => item.type === "gauge_ranking",
    )
    if (ranking === undefined) throw new Error("fixture has a ranking")
    show(ranking, { navigate })
    const table = screen.getByRole("table")
    expect(
      within(table).getByRole("columnheader", { name: "APY" }),
    ).toBeTruthy()
    const row = within(table).getByRole("row", { name: /Sats Collective/ })
    expect(within(row).getByText("3.30%")).toBeTruthy()
    expect(within(row).getByText("$388.00")).toBeTruthy()
    expect(within(row).getByRole("img", { name: "BTC, MEZO" })).toBeTruthy()
    const link = within(row).getByRole("link", { name: "Sats Collective" })
    expect(link.getAttribute("href")).toMatch(/^\/gauges\/0x/)
    fireEvent.click(link)
    expect(navigate).toHaveBeenCalledWith(link.getAttribute("href"))
  })

  it("renders untrusted names as text, never markup", () => {
    const hostile = '<img src=x onerror="alert(1)">'
    const ranking = fixtureTurn(request).response.uiBlocks.find(
      (item) => item.type === "gauge_ranking",
    )
    if (ranking?.type !== "gauge_ranking") throw new Error("ranking")
    const first = ranking.rows[0]
    if (first === undefined) throw new Error("row")
    const { container } = show({
      ...ranking,
      rows: [{ ...first, name: hostile, picture: null }],
    })
    expect(screen.getByText(hostile)).toBeTruthy()
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })

  it("renders a gauge explanation as a figure with the band", () => {
    show(
      block({
        type: "gauge_explain",
        id: "b.explain",
        target: {
          targetAddress: address,
          name: "Kiln Labs",
          nameSource: "profile",
          tokenId: "7",
          branch: "boost",
          isAlive: true,
          picture: { type: "initials", text: "KL" },
        },
        incentivesUsd: "1180.000000",
        pricingStatus: "complete",
        incentives: [],
        weight: mezo("5880000000000000000000000"),
        apyBps: 256,
        boostWad: "4400000000000000000",
        optimalVeMEZO: mezo("6970000000000000000000000"),
        additionalVeMEZO: mezo("1090000000000000000000000"),
        epochs: [],
        historyStatus: "live",
        notSelectedReason: null,
        snapshotBlock: "13078795",
      }),
    )
    expect(screen.getByText("To 5×")).toBeTruthy()
    expect(screen.getByText("1.09M")).toBeTruthy()
    expect(screen.getByText("5,880,000")).toBeTruthy()
    expect(screen.getByText("4.4×")).toBeTruthy()
    expect(screen.getByText("$1,180.00")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Kiln Labs" })).toBeTruthy()
  })

  it("renders a metric summary", () => {
    show(
      block({
        type: "metric_summary",
        id: "b.metric",
        label: "Projected this epoch",
        primaryUsd: "86.400000",
        primaryStatus: "projected",
        secondary: null,
        apyBps: 1480,
        apyStatus: "extrapolated",
        objectiveNote: null,
        snapshotBlock: "13078795",
      }),
    )
    expect(screen.getByText("Projected this epoch")).toBeTruthy()
    expect(screen.getByText("$86.40")).toBeTruthy()
    expect(screen.getByText("14.80%")).toBeTruthy()
  })

  it("renders a claim review with a total and unpriced rows", () => {
    show(
      block({
        type: "claim_review",
        id: "b.claim",
        proposalId: null,
        rows: [
          {
            rowKey: "boost_bribes:4120",
            source: "boost_bribes",
            contract: address,
            tokenId: "4120",
            rewards: [
              {
                token: "0x7b7c000000000000000000000000000000000001",
                amount: mezo("1000"),
                usd: null,
              },
            ],
            usd: "203.780000",
            unpricedCount: 0,
          },
          {
            rowKey: "validator_bribes:wallet",
            source: "validator_bribes",
            contract: address,
            tokenId: null,
            rewards: [],
            usd: null,
            unpricedCount: 1,
          },
        ],
        totalUsd: "212.480000",
        unpricedCount: 1,
        signatures: { count: 2, atomic: false },
        irreversibilityNote: "claim_final",
      }),
    )
    expect(screen.getByText("Boost incentives")).toBeTruthy()
    expect(screen.getByText("#4120")).toBeTruthy()
    expect(screen.getByText("$203.78")).toBeTruthy()
    expect(screen.getByText("Unpriced")).toBeTruthy()
    expect(screen.getByText("$212.48")).toBeTruthy()
  })

  it("renders a loan position, a scenario and a repay review", () => {
    const btc = { raw: "500000000000000000", decimals: 18, symbol: "BTC" }
    const musd = {
      raw: "20000000000000000000000",
      decimals: 18,
      symbol: "MUSD",
    }
    show(
      block({
        type: "loan_position",
        id: "b.loan",
        troveOwner: address,
        status: "active",
        collateral: btc,
        collateralUsd: "52855.000000",
        collateralPriceUsd: "105710.000000",
        priceStatus: "live",
        principal: musd,
        interest: { ...musd, raw: "0" },
        debt: musd,
        interestRateBps: 100,
        collateralRatioBps: 26_427,
        minCollateralRatioBps: 11_000,
        criticalCollateralRatioBps: 15_000,
        totalCollateralRatioBps: null,
        recoveryMode: false,
        health: "near_liquidation",
        liquidationPriceUsd: "44000.000000",
        dropToLiquidationBps: 5_800,
        gasCompensation: { ...musd, raw: "200000000000000000000" },
        maxPartialRepay: null,
        musdBalance: null,
        surplusCollateral: null,
        snapshotBlock: "13078795",
        history: [],
        historyStatus: "live",
        actions: [],
      }),
    )
    expect(screen.getByText("0.5000 BTC")).toBeTruthy()
    expect(screen.getByText("264.27%")).toBeTruthy()
    expect(screen.getByText("At risk")).toBeTruthy()
    screen.getByText("$44,000")
  })

  it("renders a liquidation scenario table", () => {
    show(
      block({
        type: "liquidation_scenario",
        id: "b.scenario",
        asset: "BTC",
        base: {
          priceUsd: "105710.000000",
          collateralRatioBps: 26_427,
          liquidationPriceUsd: "44000.000000",
        },
        rows: [
          {
            shockBps: -3_500,
            priceUsd: "68711.500000",
            collateralRatioBps: 17_177,
            band: "healthy",
            requested: true,
            isLiquidationRow: false,
          },
        ],
        thresholds: { minCollateralRatioBps: 11_000, nearBandBps: 13_000 },
        requestedOutcome: "safe",
        snapshotBlock: "13078795",
      }),
    )
    expect(screen.getByText("−35%")).toBeTruthy()
    expect(screen.getByText("171.77%")).toBeTruthy()
  })

  it("renders a repay review", () => {
    show(
      block({
        type: "repay_review",
        id: "b.repay",
        proposalId: "repay_1",
        title: "Repay 5,000.00 MUSD",
        amount: { raw: "5000000000000000000000", decimals: 18, symbol: "MUSD" },
        effects: [
          {
            key: "debt",
            label: "Debt",
            before: "20,000.00 MUSD",
            after: "15,000.00 MUSD",
            unchanged: false,
            factRefs: [],
          },
        ],
        approval: "not_required",
        simulation: "passed",
        signatures: { count: 1, atomic: true },
        irreversibilityNote: "repay_not_reversible",
      }),
    )
    expect(screen.getByText("Repay 5,000.00 MUSD")).toBeTruthy()
    expect(screen.getByText("20,000.00 MUSD to 15,000.00 MUSD")).toBeTruthy()
  })

  it("renders an allocation diff and a vote composer", () => {
    const { unmount } = show(
      block({
        type: "allocation_diff",
        id: "b.diff",
        proposalId: "vote_1",
        refreshedProposalId: "vote_1",
        refreshedAtBlock: "13078801",
        material: false,
        reasons: [],
        beforeProjectedUsd: "8.750000",
        afterProjectedUsd: "11.580000",
        projectedDeltaBps: 3234,
        beforeNative: null,
        afterNative: null,
        rows: [
          {
            ballotKey: "boost:2207",
            targetId: "a",
            name: "Sats Collective",
            beforeBps: 0,
            afterBps: 7000,
            deltaProjectedUsd: null,
          },
        ],
        manualEditsPreserved: false,
        actions: [],
      }),
    )
    expect(screen.getByText("$11.58")).toBeTruthy()
    expect(screen.getByText("was $8.75")).toBeTruthy()
    expect(screen.getByText("+$2.83")).toBeTruthy()
    expect(screen.getByText("70%")).toBeTruthy()
    unmount()
    show(
      block({
        type: "vote_composer",
        id: "b.composer",
        proposalId: "vote_1",
        ballots: [
          {
            ballotKey: "boost:2207",
            branch: "boost",
            governanceAsset: "veMEZO",
            votingContract: address,
            tokenId: "2207",
            votingPower: "41260000000000000000000",
            selected: true,
            allocations: [
              {
                targetId: address,
                targetAddress: address,
                name: "Kiln Labs",
                bps: 10_000,
                projectedUsd: null,
              },
            ],
          },
        ],
        editable: true,
        manualOverride: false,
        nonAtomicNotice: false,
      }),
    )
    expect(screen.getByText("veMEZO #2207")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Kiln Labs" })).toBeTruthy()
    expect(screen.getByText("100%")).toBeTruthy()
  })

  it("asks with the clarification when an option is picked", () => {
    const ask = vi.fn()
    show(
      block({
        type: "clarification_card",
        id: "b.clarify",
        cardId: "lock-selection",
        prompt: "Which lock?",
        options: [
          {
            id: "2207",
            label: "veMEZO #2207",
            detail: "41.26k votes",
            availability: "available",
          },
          {
            id: "1842",
            label: "veMEZO #1842",
            detail: "Expired",
            availability: "unavailable",
          },
        ],
      }),
      { ask },
    )
    expect(screen.getByRole("group", { name: "Which lock?" })).toBeTruthy()
    const unavailable = screen.getByRole("button", { name: /#1842/ })
    expect(unavailable.hasAttribute("disabled")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: /#2207/ }))
    expect(ask).toHaveBeenCalledWith("veMEZO #2207", {
      clarification: { cardId: "lock-selection", optionId: "2207" },
    })
  })

  it("renders the compact blocks and leaves trace and sources to the summary", () => {
    show(
      block({
        type: "activity_trace",
        id: "b.trace",
        items: [
          {
            id: "1",
            label: "Compared 34 gauges",
            detail: null,
            tool: null,
            durationMs: 12,
            status: "ok",
          },
        ],
      }),
    )
    // Steps render once, in the answer's summary row, never as a block.
    expect(screen.queryByText("Compared 34 gauges")).toBeNull()
    cleanupAndShow(
      block({
        type: "zap_route",
        id: "b.zap",
        proposalId: null,
        status: "quoted",
        unavailableReason: null,
        destination: {
          vaultId: "musd",
          name: "MUSD vault",
          address: null,
          kind: "single_sided",
        },
        steps: [
          { index: 1, kind: "swap", label: "Swap MEZO to MUSD", amount: null },
        ],
        youPay: mezo("271000000000000000000"),
        youPayUsd: "50.000000",
        quotedOut: null,
        minReceived: null,
        feeBps: 30,
        priceImpactBps: 12,
        priceImpactLevel: "ok",
        slippageBps: 50,
        slippageEditable: true,
        approvals: [],
        shares: null,
        sharesExact: true,
        quoteExpiresAt: null,
        callCount: 2,
        atomicity: "sequential_non_atomic",
      }),
    )
    expect(screen.getByText("Swap MEZO to MUSD")).toBeTruthy()
    expect(screen.getByText("271.00 MEZO")).toBeTruthy()
    cleanupAndShow(
      block({
        type: "bridge_records",
        id: "b.bridge",
        records: [
          {
            id: "r1",
            provider: "Wormhole",
            direction: "in",
            sourceChain: "Ethereum",
            destinationChain: "Mezo",
            sourceAsset: "USDC",
            destinationAsset: "mUSDC",
            sourceAmount: "100 USDC",
            destinationAmount: "100 mUSDC",
            usdValue: null,
            feeUsd: null,
            status: "completed",
            happenedAt: "Thu 5 Nov",
            sourceHash: "0x1",
            destinationHash: null,
          },
        ],
        providerFilter: null,
        totalUsd: null,
      }),
    )
    expect(screen.getByText("Ethereum to Mezo")).toBeTruthy()
    cleanupAndShow(block({ type: "source_cluster", id: "b.sources" }))
    expect(screen.queryByText(/Matchbox gauges/)).toBeNull()
  })
})

function cleanupAndShow(value: UiBlock): void {
  cleanup()
  show(value)
}
