import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { summaryText, TraceSummary, uniqueSources } from "./answer"
import { Block, voteAmount } from "./blocks"
import type { Proposal, StuartRequest, UiBlock } from "./contract"
import { uiBlockSchema } from "./contract"
import { fixtureTurn } from "./fixtures"
import { formatToken } from "./format"
import { ProposalCard, tabOf, titleOf } from "./proposal-card"
import { safeBatch } from "./safe-export"
import {
  destinationOf,
  fixtureSearch,
  rowsFor,
  type SearchController,
  SearchResults,
} from "./search"
import { withHost } from "./test-host"

const wallet = {
  address: "0x7c21095156ab25e989c3c084bcb06037c6539e0b",
  mode: "connected" as const,
}

function ask(query: string): ReturnType<typeof fixtureTurn> {
  const request: StuartRequest = {
    version: 1,
    query,
    sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
    turn: 0,
    surface: "palette",
    chainId: 31_612,
    wallet,
  }
  return fixtureTurn(request)
}

function claimProposal(): Proposal {
  const proposal = ask("Claim all my rewards").response.proposedActions[0]
  if (proposal === undefined) throw new Error("claim fixture has a proposal")
  return proposal
}

describe("Ctrl K search", () => {
  it("answers gauges, wallets and transactions from the demo", () => {
    expect(fixtureSearch("")).toEqual([])
    expect(fixtureSearch("snf").map((row) => row.type)).toEqual(["gauge"])
    const hash = `0x${"ab".repeat(32)}`
    expect(fixtureSearch(hash)[0]).toMatchObject({
      type: "transaction",
      url: `https://scan.matchbox.markets/tx/${hash}`,
    })
    const address = `0x${"12".repeat(20)}`
    expect(fixtureSearch(address)[0]).toMatchObject({ type: "wallet", address })
  })

  it("puts Ask Stuart first and sends each result to its place", () => {
    const rows = rowsFor("snf", { kind: "done", results: fixtureSearch("snf") })
    expect(rows.map((row) => row.kind)).toEqual(["ask", "result"])
    const gauge = fixtureSearch("snf")[0]
    if (gauge === undefined) throw new Error("gauge")
    expect(destinationOf(gauge)).toEqual({
      kind: "app",
      to: "/gauges/0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e",
    })
    const wallet = fixtureSearch(`0x${"12".repeat(20)}`)[0]
    if (wallet === undefined) throw new Error("wallet")
    expect(destinationOf(wallet)).toEqual({
      kind: "app",
      to: `/?address=0x${"12".repeat(20)}`,
    })
  })

  it("grows the results from the bar and runs them from the keyboard", async () => {
    const controller = createRef<SearchController | null>()
    const onAsk = vi.fn()
    const onNavigate = vi.fn()
    const onDone = vi.fn()
    const { rerender } = render(
      <SearchResults
        endpoint={null}
        query="snf"
        open
        listId="list"
        controller={controller}
        onActiveChange={() => {}}
        onAsk={onAsk}
        onNavigate={onNavigate}
        onDone={onDone}
      />,
    )
    const option = await screen.findByRole("option", { name: /SNF/ })
    expect(option).toBeTruthy()
    const sheet = document.querySelector(".stuart-search")
    expect(sheet?.getAttribute("data-state")).toBe("open")
    // Reduced motion swaps the grow for a fade through this hook.
    expect(sheet?.hasAttribute("data-mbx-motion")).toBe(true)
    expect(screen.getByRole("img", { name: "veBTC gauge" })).toBeTruthy()
    const key = (name: string) =>
      controller.current?.onKeyDown({
        key: name,
        preventDefault: () => {},
      } as never)
    key("ArrowDown")
    await waitFor(() =>
      expect(option.getAttribute("aria-selected")).toBe("true"),
    )
    key("Enter")
    expect(onNavigate).toHaveBeenCalledWith(
      "/gauges/0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e",
    )
    expect(onDone).toHaveBeenCalled()
    key("ArrowUp")
    await waitFor(() =>
      expect(option.getAttribute("aria-selected")).toBe("false"),
    )
    key("Enter")
    expect(onAsk).toHaveBeenCalledWith("snf")
    rerender(
      <SearchResults
        endpoint={null}
        query="snf"
        open={false}
        listId="list"
        controller={controller}
        onActiveChange={() => {}}
        onAsk={onAsk}
        onNavigate={onNavigate}
        onDone={onDone}
      />,
    )
    // Exits mirror entries: still mounted, shrinking, no clicks.
    expect(
      document.querySelector(".stuart-search")?.getAttribute("data-state"),
    ).toBe("closed")
    await waitFor(() =>
      expect(document.querySelector(".stuart-search")).toBeNull(),
    )
  })

  it("fetches the Worker's /search and validates it", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({
        query: "snf",
        results: fixtureSearch("snf"),
      }),
    )
    render(
      <SearchResults
        endpoint="https://stuart.example/"
        query="snf"
        open
        listId="list"
        controller={createRef<SearchController | null>()}
        onActiveChange={() => {}}
        onAsk={() => {}}
        onNavigate={() => {}}
        onDone={() => {}}
        fetcher={fetcher}
      />,
    )
    await screen.findByRole("option", { name: /SNF/ })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://stuart.example/search?q=snf",
    )
  })
})

describe("summary row", () => {
  it("lists each source once and adds the block", () => {
    const response = ask("Claim all my rewards").response
    const sources = uniqueSources(
      [...response.evidence, ...response.evidence],
      "13078801",
    )
    expect(sources.map((source) => source.text)).toEqual([
      "Matchbox gauges",
      "Prices",
      "Simulation",
      "block 13,078,801",
    ])
    expect(summaryText(null, "13078801")).toBe(
      "Checked sources, block 13,078,801",
    )
  })

  it("collapses to one row and expands to the steps", async () => {
    const response = ask("Claim all my rewards").response
    render(<TraceSummary response={response} />)
    const row = screen.getByRole("button", {
      name: "Checked 1 lock and prices, block 13,078,795",
    })
    expect(row.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("Read claimable rewards")).toBeNull()
    fireEvent.click(row)
    expect(screen.getByText("Read claimable rewards")).toBeTruthy()
    expect(
      screen.getByText("veMEZO #2930, boost rewards from veBTC #6033"),
    ).toBeTruthy()
    const sources = screen.getByRole("list", { name: "Sources" })
    expect(sources.textContent).toContain("Prices")
    fireEvent.click(row)
    const body = document.querySelector(".stuart-summary-body")
    expect(body?.getAttribute("data-state")).toBe("closed")
    await waitFor(() =>
      expect(document.querySelector(".stuart-summary-body")).toBeNull(),
    )
  })
})

describe("proposal card", () => {
  it("titles claims, relocks and lock actions in plain words", () => {
    const claim = claimProposal()
    expect(titleOf(claim)).toBe("Claim, #2930")
    expect(tabOf(claim).tone).toBe("mezo")
    const merge: Proposal = {
      ...claim,
      kind: "lock",
      content: {
        kind: "lock",
        action: "merge",
        escrow: "veMEZO",
        tokenId: "3011",
        intoTokenId: "2930",
        amount: null,
        unlocksAt: null,
        recipient: null,
        resets: 0,
      },
    }
    expect(titleOf(merge)).toBe("Merge #3011 into #2930")
    const transfer: Proposal = {
      ...merge,
      content: {
        ...merge.content,
        action: "transfer",
        escrow: "veBTC",
      } as never,
    }
    expect(titleOf(transfer)).toBe("Transfer veBTC #3011")
    expect(tabOf(transfer).tone).toBe("btc")
    const relock: Proposal = {
      ...claim,
      kind: "claim_relock",
      content: {
        kind: "claim_relock",
        rows: claim.content.kind === "claim" ? claim.content.rows : [],
        totalUsd: "3.940000",
        unpricedCount: 0,
        relockTokenId: "2930",
        relockAmount: {
          raw: "958960000000000000000",
          decimals: 18,
          symbol: "MEZO",
        },
      },
    }
    expect(titleOf(relock)).toBe("Claim and relock into #2930")
  })

  it("shows plain-word steps, the simulation and both ways to sign", () => {
    render(
      withHost(<ProposalCard proposal={claimProposal()} diff={null} />, {
        signer: async () => ({ outcome: "success", hashes: [] }),
      }),
    )
    expect(screen.getByText("Claim veMEZO #2930")).toBeTruthy()
    expect(screen.getByText("Boost rewards from Epoch 46")).toBeTruthy()
    expect(screen.getByText("Simulation passed")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Review and sign" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Export for Safe" })).toBeTruthy()
  })

  it("leads with Export for Safe when signing is multisig", () => {
    render(
      withHost(<ProposalCard proposal={claimProposal()} diff={null} />, {
        signer: async () => ({ outcome: "success", hashes: [] }),
        signing: { mode: "multisig", safe: null },
      }),
    )
    const primary = screen.getByRole("button", { name: "Export for Safe" })
    expect(primary.className).not.toContain("stuart-link")
    expect(
      screen.getByRole("button", { name: "Review and sign" }).className,
    ).toContain("stuart-link")
  })

  it("exports a Transaction Builder batch with the exact calldata", () => {
    const proposal = claimProposal()
    const file = safeBatch({
      proposal,
      name: "Claim, #2930",
      createdAt: 1_794_200_000_000,
      safe: "0xf365000000000000000000000000000000008bc4",
    })
    expect(file).toEqual({
      version: "1.0",
      chainId: "31612",
      createdAt: 1_794_200_000_000,
      meta: {
        name: "Claim, #2930",
        description: "Claim veMEZO #2930, Boost rewards from Epoch 46",
        createdFromSafeAddress: "0xf365000000000000000000000000000000008bc4",
      },
      transactions: [
        {
          to: proposal.calls[0]?.to,
          value: "0",
          data: proposal.calls[0]?.data,
        },
      ],
    })
  })
})

describe("gauge kinds and units", () => {
  it("draws the type icon in ranking rows with amounts in their unit", () => {
    const ranking = ask("which gauges pay best").response.uiBlocks.find(
      (block): block is Extract<UiBlock, { type: "gauge_ranking" }> =>
        block.type === "gauge_ranking",
    )
    if (ranking === undefined) throw new Error("ranking")
    const row = ranking.rows[0]
    if (row === undefined) throw new Error("row")
    const validator = uiBlockSchema.parse({
      ...ranking,
      domain: {
        ...ranking.domain,
        branch: "validators",
        governanceAsset: "veBTC",
      },
      rows: [
        { ...row, kind: "validator", competingWeight: "800000000000000000" },
      ],
    })
    render(withHost(<Block block={validator} />))
    expect(screen.getByRole("img", { name: "Validator gauge" })).toBeTruthy()
    expect(screen.getByText("0.8000 veBTC")).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\bvotes\b/)
  })

  it("rounds veBTC to 4 decimals, tiny amounts to 3 figures", () => {
    expect(voteAmount("22150000000000000000000", "veMEZO")).toBe(
      "22.15k veMEZO",
    )
    expect(voteAmount("800000000000000000", "veBTC")).toBe("0.8000 veBTC")
    expect(
      formatToken({ raw: "12345000000000", decimals: 18, symbol: "BTC" }),
    ).toBe("0.0000123 BTC")
    expect(
      formatToken({ raw: "500000000000", decimals: 18, symbol: "veBTC" }),
    ).toBe("<0.000001 veBTC")
  })
})
