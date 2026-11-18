import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { GaugeSummary } from "../../data/view-models"
import { sortGauges } from "./gauge-filter"
import { compactVotes, GaugeTile } from "./gauge-tile"
import { voteSorts } from "./vote-view"

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to: _to,
    params: _params,
    ...rest
  }: {
    children: ReactNode
    to?: string
    params?: unknown
  }) => (
    <a href="/" {...rest}>
      {children}
    </a>
  ),
}))

const wei = (whole: bigint): string => `${whole * 10n ** 18n}`

function gauge(fields: Partial<GaugeSummary> & { name: string }): GaugeSummary {
  return {
    address: `0x${fields.name.length.toString(16).padStart(40, "0")}`,
    voter: "boost",
    picture: { kind: "initials", initials: "AB", hue: 10 },
    color: { light: "#000", dark: "#fff" },
    kind: "vebtc",
    meta: {
      kind: "vebtc",
      tokenId: "5678",
      weight: "0",
      boost: null,
      lock: "expired",
    },
    votesUnit: "veMEZO",
    expired: false,
    tokenId: "5678",
    tagline: null,
    apyBps: 250,
    incentivesUsd: "120.00",
    incentiveTokens: ["MEZO"],
    veBtcWeight: "1.5",
    votes: wei(1_000n),
    optimalVotes: wei(4_000n),
    ...fields,
  }
}

describe("expired veBTC gauges", () => {
  it("show an Expired chip, no boost and a Lock expired band", () => {
    render(
      <GaugeTile
        gauge={gauge({ name: "veBTC #5678", expired: true, veBtcWeight: "0" })}
        picked={false}
        disabled={false}
        votes={1_000n}
        votesWei={1_000n * 10n ** 18n}
        onPickedChange={() => {}}
      />,
    )
    expect(screen.getByText("Expired")).toBeTruthy()
    expect(screen.getByText("No boost")).toBeTruthy()
    expect(screen.getByText("Lock expired")).toBeTruthy()
    expect(screen.queryByText(/to go|over/)).toBeNull()
    expect(screen.getByRole("img", { name: "veBTC gauge" })).toBeTruthy()
  })

  it("sort after every live gauge, in every sort", () => {
    const list = [
      gauge({
        name: "Old",
        expired: true,
        apyBps: 9_000,
        incentivesUsd: "900",
      }),
      gauge({ name: "Live one", apyBps: 100, incentivesUsd: "1" }),
      gauge({ name: "Live two", apyBps: 200, incentivesUsd: "2" }),
    ]
    for (const sort of Object.keys(voteSorts) as (keyof typeof voteSorts)[]) {
      const sorted = sortGauges(list, sort)
      expect(sorted.at(-1)?.name).toBe("Old")
    }
  })
})

describe("gauge types on cards", () => {
  it("show the type icon with its name", () => {
    render(
      <GaugeTile
        gauge={gauge({
          name: "BTC/MUSD",
          kind: "pool",
          voter: "pools",
          votesUnit: "veBTC",
          optimalVotes: null,
          meta: {
            kind: "pool",
            pair: ["BTC", "MUSD"],
            poolKind: "cl",
            tvlUsd: null,
          },
        })}
        picked={false}
        disabled={false}
        votes={1n}
        votesWei={10n ** 18n}
        onPickedChange={() => {}}
      />,
    )
    expect(screen.getByRole("img", { name: "Pool gauge" })).toBeTruthy()
  })
})

describe("pool gauges that share a pair", () => {
  function pool(poolLabel: string | null) {
    return gauge({
      name: "BTC/MUSD",
      poolLabel,
      kind: "pool",
      voter: "pools",
      votesUnit: "veBTC",
      optimalVotes: null,
      tokenId: null,
      meta: {
        kind: "pool",
        pair: ["BTC", "MUSD"],
        poolKind: "cl",
        tvlUsd: null,
      },
    })
  }

  it("name their pool type beside the pair and in the link", () => {
    render(
      <GaugeTile
        gauge={pool("CL200")}
        picked={false}
        disabled={false}
        votes={88n}
        votesWei={88_100_000_000_000_000_000n}
        onPickedChange={() => {}}
      />,
    )
    expect(screen.getByRole("link", { name: "BTC/MUSD CL200" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Add BTC/MUSD CL200 to ballot" }),
    ).toBeTruthy()
    // Seen once (grey, hidden from screen readers), heard once (in the link).
    const shown = screen
      .getAllByText("CL200")
      .filter((element) => element.getAttribute("aria-hidden") === "true")
    expect(shown).toHaveLength(1)
  })

  it("show votes with their unit for the compact row", () => {
    render(
      <GaugeTile
        gauge={pool("Volatile")}
        picked={false}
        disabled={false}
        votes={88n}
        votesWei={88_100_000_000_000_000_000n}
        onPickedChange={() => {}}
      />,
    )
    expect(screen.getByText("88.1000 veBTC")).toBeTruthy()
    expect(compactVotes(5_880_000n, 0n, "veMEZO")).toBe("5.88M veMEZO")
  })

  it("make the card's one link the gauge's name", () => {
    const view = render(
      <GaugeTile
        gauge={pool("Stable")}
        picked={false}
        disabled={false}
        votes={1n}
        votesWei={10n ** 18n}
        onPickedChange={() => {}}
      />,
    )
    const links = view.container.querySelectorAll("a")
    expect(links).toHaveLength(1)
    expect(links[0]?.hasAttribute("data-card-link")).toBe(true)
  })
})
