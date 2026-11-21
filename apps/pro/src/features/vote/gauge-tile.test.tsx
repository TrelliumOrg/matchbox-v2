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
    funded: true,
    priced: true,
    unpriced: 0,
    apyMinVotes: "0",
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

  it("show the dollars and no APY when there is too little for one (P6)", () => {
    const view = render(
      <GaugeTile
        gauge={{ ...pool("CL200"), apyBps: null, incentivesUsd: "0.28" }}
        picked={false}
        disabled={false}
        votes={0n}
        votesWei={4_000_000_000_000n}
        onPickedChange={() => {}}
      />,
    )
    expect(view.getByText("n/a")).toBeTruthy()
    expect(view.getByText("$0.28")).toBeTruthy()
    expect(view.queryByText("No incentives")).toBeNull()
    view.unmount()
    render(
      <GaugeTile
        gauge={{
          ...pool("Stable"),
          apyBps: null,
          incentivesUsd: "0.004",
          funded: false,
          priced: false,
        }}
        picked={false}
        disabled={false}
        votes={0n}
        votesWei={5n * 10n ** 17n}
        onPickedChange={() => {}}
      />,
    )
    expect(screen.getByText("No incentives")).toBeTruthy()
  })

  it("show unpriced incentives as held, never as none", () => {
    const tile = (fields: Partial<GaugeSummary>) =>
      render(
        <GaugeTile
          gauge={{ ...pool("CL50"), apyBps: null, ...fields }}
          picked={false}
          disabled={false}
          votes={1n}
          votesWei={10n ** 18n}
          onPickedChange={() => {}}
        />,
      )
    // Only a registry token without a USD value: funded, of unknown size.
    const unpriced = tile({
      incentivesUsd: "0.00",
      incentiveTokens: ["USDC"],
      priced: false,
      unpriced: 1,
    })
    expect(unpriced.getByText("Unpriced")).toBeTruthy()
    expect(unpriced.getByText("n/a")).toBeTruthy()
    expect(
      unpriced.getAllByRole("img", { name: "USDC" }).length,
    ).toBeGreaterThan(0)
    expect(unpriced.queryByText("No incentives")).toBeNull()
    unpriced.unmount()
    // Priced and unpriced together.
    const mixed = tile({
      incentivesUsd: "1.15",
      incentiveTokens: ["MUSD", "USDC"],
      unpriced: 1,
    })
    // The unpriced part is secondary text after the dollars.
    expect(mixed.getByText("+ 1 unpriced")).toBeTruthy()
    expect(mixed.container.textContent).toContain("$1.15 + 1 unpriced")
    mixed.unmount()
    // An unregistered token is held, but never funds the gauge.
    const unregistered = tile({
      incentivesUsd: "0.00",
      incentiveTokens: ["FAKEBTC"],
      funded: false,
      priced: false,
      unpriced: 1,
    })
    expect(unregistered.getByText("Unpriced")).toBeTruthy()
    expect(unregistered.queryByText("No incentives")).toBeNull()
  })

  it("show no falling arrow beside an APY they do not show", () => {
    // The down arrow after the APY, in the accent ink.
    const arrow = "[data-mbx-motion].text-acc-ink"
    const tile = (apyBps: number | null) =>
      render(
        <GaugeTile
          gauge={{ ...pool("CL200"), apyBps, incentivesUsd: "0.28" }}
          picked
          disabled={false}
          votes={10n}
          votesWei={10n * 10n ** 18n}
          onPickedChange={() => {}}
        />,
      )
    const hidden = tile(null)
    expect(hidden.getByText("n/a")).toBeTruthy()
    expect(hidden.container.querySelector(arrow)).toBeNull()
    hidden.unmount()
    const shown = tile(250)
    expect(shown.container.querySelector(arrow)).not.toBeNull()
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

describe("the draft APY", () => {
  it("shows n/a when the ballot takes a gauge under the votes an APY needs", () => {
    // 12,000 veMEZO, 11,000 of them this wallet's, and an APY at 10,000.
    const forge = gauge({
      name: "Forge Partners",
      apyBps: 250,
      votes: wei(12_000n),
      apyMinVotes: wei(10_000n),
    })
    const tile = (fields: Partial<GaugeSummary>, votes: bigint) =>
      render(
        <GaugeTile
          gauge={{ ...forge, ...fields }}
          picked={false}
          disabled={false}
          votes={votes}
          votesWei={votes * 10n ** 18n}
          onPickedChange={() => {}}
        />,
      )
    const kept = tile({}, 12_000n)
    expect(kept.queryByText("n/a")).toBeNull()
    kept.unmount()
    // A draft that drops the wallet's votes leaves 1,000: twelve times
    // the APY, which signing would turn to n/a.
    const dropped = tile({}, 1_000n)
    expect(dropped.getByText("n/a")).toBeTruthy()
    dropped.unmount()
    // No number from the server: no APY, however it is voted.
    const missing = tile({ apyMinVotes: null }, 12_000n)
    expect(missing.getByText("n/a")).toBeTruthy()
  })
})
