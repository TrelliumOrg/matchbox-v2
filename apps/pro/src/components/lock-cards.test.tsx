import { render, screen, within } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { GaugeRef, Lock } from "../data/view-models"
import { LockCards } from "./lock-cards"

// The cards load the saved splits' code in an effect, for a lock that
// voted. A test can finish before that import does; on the slow check
// runner the environment was then torn down under it and the whole run
// failed with EnvironmentTeardownError (main, 12 Nov 2026). Waiting for
// the same import here lets it settle first.
afterEach(async () => {
  await import("../features/vote/saved-ballots")
})

// Mon 9 Nov 2026 08:00 UTC: Epoch 47 ends Thu 12 Nov 00:00, 2d 16h away.
const endsAt = Date.UTC(2026, 10, 12) / 1000
const now = endsAt - (2 * 86_400 + 16 * 3_600)

vi.mock("../live/live-context", () => ({
  useLive: () => ({
    market: { epoch: { number: 47, startsAt: endsAt - 7 * 86_400, endsAt } },
    store: {},
  }),
  chainNow: () => now,
}))
vi.mock("../live/heads", () => ({ useHead: () => ({ number: 1 }) }))
vi.mock("../lib/viewer", () => ({
  useViewer: () => ({ kind: "connected", address: "0x7c21" }),
}))
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: ComponentProps<"a"> & {
    to: string
    params: { type: string }
  }): ReactNode => (
    <a href={to.replace("$type", params.type)} {...props}>
      {children}
    </a>
  ),
}))
vi.mock("@matchbox/motion", async (original) => ({
  ...(await original<typeof import("@matchbox/motion")>()),
  whenIdle: (task: () => void) => {
    task()
    return () => {}
  },
}))
vi.mock("../data/live-query", async (original) => ({
  ...(await original<typeof import("../data/live-query")>()),
  fetchLive: async () => ({
    gauges: [
      {
        kind: "vebtc",
        tokenId: "4120",
        votes: "5880000000000000000000000",
        optimalVotes: "6970000000000000000000000",
      },
    ],
  }),
}))

const snf: GaugeRef = {
  address: "0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e",
  voter: "boost",
  name: "SNF",
  picture: { kind: "initials", initials: "S", hue: 20 },
  color: { light: "#c33", dark: "#e55" },
}

function lock(overrides: Partial<Lock>): Lock {
  return {
    kind: "vemezo",
    tokenId: "2930",
    amount: "500000",
    usd: "2028.4",
    votingPower: "500000",
    votingPowerWei: "500000000000000000000000",
    unlocksAt: null,
    expired: false,
    autoMax: true,
    votedThisEpoch: true,
    votes: [{ gauge: snf, weight: "1", shareBps: 10_000 }],
    claimableUsd: "3.89",
    projectedUsd: "10.58",
    ifVotedUsd: null,
    boost: null,
    ...overrides,
  }
}

const locks: Lock[] = [
  lock({}),
  lock({
    kind: "vebtc",
    tokenId: "4120",
    amount: "0.8",
    usd: "59112",
    votingPower: "0.611",
    votingPowerWei: "611000000000000000",
    autoMax: false,
    unlocksAt: Date.UTC(2028, 2, 2) / 1000,
    claimableUsd: "203.78",
    projectedUsd: null,
    boost: "4.4",
  }),
  lock({
    tokenId: "3011",
    amount: "4180",
    usd: "17",
    votingPower: "4180",
    votingPowerWei: "4180000000000000000000",
    autoMax: false,
    unlocksAt: Date.UTC(2029, 10, 19) / 1000,
    votedThisEpoch: false,
    votes: [],
    claimableUsd: "0",
    projectedUsd: null,
  }),
  lock({
    tokenId: "977",
    amount: "3200",
    usd: "13",
    votingPower: "0",
    votingPowerWei: "0",
    autoMax: false,
    unlocksAt: Date.UTC(2026, 9, 14) / 1000,
    expired: true,
    votedThisEpoch: false,
    votes: [],
    claimableUsd: "0.00",
    projectedUsd: null,
  }),
]

function front(id: string): HTMLElement {
  const tab = screen.getAllByText(`#${id}`)[0]
  const face = tab?.closest("article")?.querySelector("div > div")
  if (!(face instanceof HTMLElement)) throw new Error(`No card #${id}`)
  return face
}

describe("LockCards", () => {
  it("leads with voting power in its unit, then the meta row", () => {
    render(<LockCards locks={locks} />)
    const voted = front("2930")
    expect(voted.querySelector("p")?.textContent).toBe("500,000veMEZO")
    expect(within(voted).getByRole("img", { name: "Locked MEZO" })).toBeTruthy()
    expect(within(voted).getByText("500,000.00")).toBeTruthy()
    expect(within(voted).getByText("$2,028")).toBeTruthy()
    expect(within(voted).getByRole("img", { name: "Auto max" })).toBeTruthy()

    const vebtc = front("4120")
    expect(vebtc.querySelector("p")?.textContent).toBe("0.6110veBTC")
    expect(within(vebtc).getByText("0.8000")).toBeTruthy()
    expect(within(vebtc).getByRole("img", { name: "Unlocks" })).toBeTruthy()
    expect(within(vebtc).getByText("2 Mar 2028")).toBeTruthy()

    const expired = front("977")
    expect(expired.querySelector("p")?.textContent).toBe("0veMEZO")
    expect(
      within(expired).getByText("Expired", { selector: "span" }),
    ).toBeTruthy()
    expect(within(expired).getByRole("img", { name: "Expired" })).toBeTruthy()
    expect(within(expired).getByText("14 Oct 2026")).toBeTruthy()
  })

  it("lists the epoch's rows for each state", () => {
    render(<LockCards locks={locks} />)
    const voted = front("2930")
    expect(within(voted).getByText("Epoch 47")).toBeTruthy()
    expect(within(voted).getByText("SNF")).toBeTruthy()
    expect(within(voted).getByText("$10.58")).toBeTruthy()

    const needsVote = front("3011")
    expect(within(needsVote).getByText("Not voted in Epoch 47")).toBeTruthy()
    expect(within(needsVote).getByText("2d 16h")).toBeTruthy()
    expect(within(needsVote).queryByText("Claimable")).toBeNull()
  })

  it("gives each card the pill its state calls for", () => {
    render(<LockCards locks={locks} />)
    expect(
      within(front("2930")).getByRole("button", { name: "Claim $3.89" }),
    ).toBeTruthy()
    expect(
      within(front("4120")).getByRole("button", { name: "Claim $203.78" }),
    ).toBeTruthy()
    expect(
      within(front("3011"))
        .getByRole("link", { name: "Vote" })
        .getAttribute("href"),
    ).toBe("/vote/vebtc")
    expect(
      within(front("977")).getByRole("button", {
        name: "Withdraw 3,200.00 MEZO",
      }),
    ).toBeTruthy()
    // The tab's chevron flips cards whose pill does something else.
    expect(
      within(front("3011")).getByRole("button", { name: "Manage" }),
    ).toBeTruthy()
  })

  it("shows a veBTC lock's own boost band once the gauges load", async () => {
    render(<LockCards locks={locks} />)
    expect(
      await within(front("4120")).findByText("of 6.97M veMEZO"),
    ).toBeTruthy()
    expect(within(front("4120")).getByText("4.4×")).toBeTruthy()
  })
})
