import { matchCommands } from "@matchbox/stuart-ui/commands"
import { rowsFor } from "@matchbox/stuart-ui/search"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Lock } from "../data/view-models"
import { formatVoteAmount } from "../lib/format"
import { calculatorPath, stuartNavigate } from "../stuart/navigate"
import type { CalcSearch } from "./calc-link"
import {
  calcModel,
  fieldValue,
  solvedText,
  typedTotals,
  usableLocks,
  wholeUp,
} from "./calc-model"
import { forgetBoostTotals } from "./totals"

const wad = 10n ** 18n
const totals = {
  veBtc: 654_520_000_000_000_000_000n,
  veMezo: 99_390_000n * wad,
}
const word = (value: bigint): string =>
  `0x${value.toString(16).padStart(64, "0")}`

const navigate = vi.fn()
const viewer = vi.hoisted(() => ({
  current: { kind: "signed-out" } as
    | { kind: "signed-out" }
    | { kind: "viewing"; address: string }
    | { kind: "connected"; address: string },
}))
const opened = vi.hoisted(() => ({ tx: [] as unknown[], wallet: 0 }))
const wallet = vi.hoisted(() => ({ locks: [] as unknown[] }))

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate }),
  useSearch: () => ({}),
}))
vi.mock("../lib/viewer", () => ({ useViewer: () => viewer.current }))
vi.mock("../live/live-context", () => ({
  useLive: () => ({ rpc: "https://rpc.example" }),
}))
vi.mock("../data/live-query", () => ({
  fetchLive: async () => ({ locks: wallet.locks }),
}))
vi.mock("../data/queries", () => ({ overviewQuery: () => ({}) }))
vi.mock("../tx/tx-store", () => ({
  openTx: (_viewer: unknown, request: unknown) => opened.tx.push(request),
  closeTx: () => {},
}))
vi.mock("../wallet/wallet-store", () => ({
  openWallet: () => {
    opened.wallet += 1
  },
  walletIntent: {},
}))

/** Mezo's RPC: a block, then the two totals. `fail` makes every call 503. */
function mockRpc(fail: () => boolean): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      if (fail()) return new Response("", { status: 503 })
      const body: unknown = JSON.parse(String(init.body))
      return new Response(
        JSON.stringify(
          Array.isArray(body)
            ? [
                { jsonrpc: "2.0", id: 1, result: word(totals.veBtc) },
                { jsonrpc: "2.0", id: 2, result: word(totals.veMezo) },
              ]
            : {
                jsonrpc: "2.0",
                id: 1,
                result: { number: "0xc8fd6b", timestamp: "0x6af42f38" },
              },
        ),
      )
    }),
  )
}

async function calculator(fill: CalcSearch = {}): Promise<ReactNode> {
  const { default: BoostCalculator } = await import("./boost-calculator")
  return <BoostCalculator open onClose={() => {}} fill={fill} />
}

beforeEach(() => {
  forgetBoostTotals()
  viewer.current = { kind: "signed-out" }
  opened.tx = []
  opened.wallet = 0
  wallet.locks = []
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const boost = (hundredths: bigint): bigint => hundredths * 10n ** 16n

describe("the calculator's figures", () => {
  it("answers the default question: 1 veBTC, how much veMEZO for 5×", () => {
    const model = calcModel({
      solve: "vemezo",
      veBtc: "1",
      veMezo: "",
      totals,
    })
    expect(model.boost).toBe(5n * wad)
    expect(model.missing).toBeNull()
    expect(model.veMezo === null ? null : model.veMezo / wad).toBe(151_851n)
    // Shown rounded up: 151,851 would give 4.99×.
    expect(solvedText(model)).toBe("151852")
    expect(model.ratio).toBe(model.veMezo)
  })

  it("works out the veBTC that veMEZO takes to a boost, rounded down", () => {
    const model = calcModel({
      solve: "vebtc",
      veBtc: "",
      veMezo: "100000",
      target: boost(325n),
      totals,
    })
    expect(model.missing).toBeNull()
    expect(solvedText(model)).toBe("1.170732")
    const back = calcModel({
      solve: "boost",
      veBtc: solvedText(model),
      veMezo: "100000",
      totals,
    })
    expect(back.boost).toBeGreaterThanOrEqual(boost(325n))
  })

  it("works out the boost from both, and the veMEZO past 5× that adds nothing", () => {
    const at = calcModel({
      solve: "boost",
      veBtc: "1",
      veMezo: "100000",
      totals,
    })
    expect(at.boost).toBe(3_634_148_304_658_416_339n)
    expect(at.over).toBeNull()
    const over = calcModel({
      solve: "boost",
      veBtc: "0.611",
      veMezo: "120000",
      totals,
    })
    expect(over.boost).toBe(5n * wad)
    expect(over.over === null ? null : over.over / wad).toBe(27_218n)
    // No veMEZO at all is 1×, not a missing answer.
    expect(
      calcModel({ solve: "boost", veBtc: "1", veMezo: "", totals }).boost,
    ).toBe(wad)
  })

  it("needs no veMEZO for 1×, and has no veBTC answer at 1× or without veMEZO", () => {
    const one = calcModel({
      solve: "vemezo",
      veBtc: "1",
      veMezo: "",
      target: wad,
      totals,
    })
    expect(one.veMezo).toBe(0n)
    expect(solvedText(one)).toBe("0")
    expect(
      calcModel({
        solve: "vebtc",
        veBtc: "",
        veMezo: "100000",
        target: wad,
        totals,
      }).missing,
    ).toBe("at-one")
    expect(
      calcModel({ solve: "vebtc", veBtc: "", veMezo: "0", totals }).missing,
    ).toBe("no-vemezo")
    expect(
      calcModel({ solve: "vebtc", veBtc: "", veMezo: "", totals }).missing,
    ).toBe("vemezo")
    expect(
      calcModel({ solve: "vemezo", veBtc: "0", veMezo: "", totals }).missing,
    ).toBe("vebtc")
  })

  it("has no figures without totals", () => {
    for (const solve of ["vemezo", "vebtc", "boost"] as const) {
      const model = calcModel({
        solve,
        veBtc: "1",
        veMezo: "100000",
        target: boost(300n),
        totals: null,
      })
      expect(model.missing).toBe("totals")
      expect(model.ratio).toBeNull()
      expect(model.forMax).toBeNull()
      expect(solvedText(model)).toBe("")
    }
    expect(typedTotals("654.52", "")).toBeNull()
    expect(typedTotals("654.52", "99390000")).toEqual(totals)
  })

  it("rounds a needed veMEZO figure up to a whole veMEZO", () => {
    expect(wholeUp(151_851n * wad + 1n)).toBe(151_852n * wad)
    expect(wholeUp(151_851n * wad)).toBe(151_851n * wad)
    expect(wholeUp(0n)).toBe(0n)
  })

  it("offers the wallet's live locks, largest first", () => {
    const locks = [
      lock("1", { votingPowerWei: `${5n * wad}` }),
      lock("2", { votingPowerWei: `${9n * wad}` }),
      lock("3", { expired: true, votingPowerWei: `${99n * wad}` }),
      lock("4", { votingPowerWei: "0" }),
      lock("5", { kind: "vebtc" }),
    ]
    expect(usableLocks(locks, "vemezo").map((each) => each.tokenId)).toEqual([
      "2",
      "1",
    ])
    expect(fieldValue(611_000_000_000_000_000n, 4)).toBe("0.611")
    expect(fieldValue(41_260n * wad + 5n, 0)).toBe("41260")
  })
})

function lock(tokenId: string, fields: Partial<Lock>): Lock {
  return {
    kind: "vemezo",
    tokenId,
    amount: "1",
    usd: "1",
    votingPower: "1",
    votingPowerWei: `${wad}`,
    unlocksAt: null,
    expired: false,
    autoMax: true,
    votedThisEpoch: false,
    votes: [],
    claimableUsd: "0",
    ...fields,
  }
}

const field = (name: string): HTMLInputElement =>
  screen.getByRole<HTMLInputElement>("textbox", { name })
const veBtcField = (): HTMLInputElement => field("veBTC voting power")
const veMezoField = (): HTMLInputElement => field("veMEZO on its gauge")
const calcToggle = (unit: "veBTC" | "veMEZO"): HTMLElement =>
  screen.getByRole("button", { name: `Calculate ${unit}` })
const slider = (): HTMLInputElement =>
  screen.getByRole<HTMLInputElement>("slider")
const solving = (): string =>
  document.querySelector("[data-calc-solving]")?.textContent ?? ""
const figure = (): string =>
  document.querySelector("[data-boost-figure]")?.textContent ?? ""
const announced = (): string =>
  document.querySelector("[data-calc-announce]")?.textContent ?? ""

describe("the calculator sheet", () => {
  it("opens on 1 veBTC and works out the veMEZO for 5×", async () => {
    mockRpc(() => false)
    render(await calculator())
    expect(veBtcField().value).toBe("1")
    expect(veBtcField().readOnly).toBe(false)
    expect(calcToggle("veMEZO").getAttribute("aria-pressed")).toBe("true")
    expect(calcToggle("veBTC").getAttribute("aria-pressed")).toBe("false")
    expect(veMezoField().readOnly).toBe(true)
    expect(solving()).toBe("Calculating the veMEZO needed for 5.00×")
    await waitFor(() => expect(veMezoField().value).toBe("151852"))
    expect(slider().disabled).toBe(false)
    expect(slider().value).toBe("500")
    expect(slider().getAttribute("aria-valuetext")).toBe("5.00×")
    // The toggle says what it does, in words, not only with an icon.
    expect(calcToggle("veMEZO").textContent).toBe("Calculate veMEZO")
    // Signed out: both fields offer the wallet, and so does the primary.
    expect(screen.getAllByText("Use your locks")).toHaveLength(2)
    const primary = screen
      .getAllByRole("button", { name: "Connect wallet" })
      .at(-1)
    if (primary === undefined) throw new Error("no primary")
    fireEvent.click(primary)
    expect(opened.wallet).toBe(1)
  })

  it("follows the slider and the veBTC typed", async () => {
    mockRpc(() => false)
    render(await calculator())
    await waitFor(() => expect(veMezoField().value).toBe("151852"))
    fireEvent.change(slider(), { target: { value: "325" } })
    expect(veMezoField().value).toBe("85417")
    expect(figure()).toBe("3.25×")
    expect(solving()).toBe("Calculating the veMEZO needed for 3.25×")
    fireEvent.change(veBtcField(), { target: { value: "2" } })
    expect(veMezoField().value).toBe("170834")
    fireEvent.click(screen.getByRole("button", { name: "Aim for 5×" }))
    expect(veMezoField().value).toBe("303704")
  })

  it("works out the boost when veMEZO's Calculate is pressed again", async () => {
    mockRpc(() => false)
    render(await calculator())
    await waitFor(() => expect(veMezoField().value).toBe("151852"))
    fireEvent.click(calcToggle("veMEZO"))
    expect(calcToggle("veMEZO").getAttribute("aria-pressed")).toBe("false")
    // The worked-out figure stays, now typed.
    expect(veMezoField().readOnly).toBe(false)
    expect(veMezoField().value).toBe("151852")
    expect(figure()).toBe("5.00×")
    // The slider still works: it is how a boost is chosen.
    expect(slider().disabled).toBe(false)
    expect(solving()).toBe(
      "Calculating the boost from the veBTC and veMEZO entered",
    )
    expect(announced()).toBe(
      "Calculating the boost from the veBTC and veMEZO entered",
    )
    expect(
      screen.getByText(
        "Choose a boost on the slider to calculate the veMEZO it needs.",
      ),
    ).toBeTruthy()
    fireEvent.change(veMezoField(), { target: { value: "100000" } })
    expect(figure()).toBe("3.63×")
    expect(slider().value).toBe("363")
    expect(screen.getByText("51,852 veMEZO to go")).toBeTruthy()
  })

  it("works out the veBTC with its Calculate, keeping the boost there was", async () => {
    mockRpc(() => false)
    render(
      await calculator({ calc: 1, vebtc: "1", vemezo: "100000", for: "5" }),
    )
    await waitFor(() => expect(figure()).toBe("3.63×"))
    expect(calcToggle("veMEZO").getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(calcToggle("veBTC"))
    expect(calcToggle("veBTC").getAttribute("aria-pressed")).toBe("true")
    expect(veBtcField().readOnly).toBe(true)
    expect(veBtcField().value).toBe("1")
    expect(solving()).toBe("Calculating the veBTC this veMEZO takes to 3.63×")
    fireEvent.change(slider(), { target: { value: "500" } })
    expect(veBtcField().value).toBe("0.658537")
    // Straight across to the other field: the veBTC shown is now typed.
    fireEvent.click(calcToggle("veMEZO"))
    expect(veBtcField().value).toBe("0.658537")
    expect(veMezoField().value).toBe("100000")
  })

  it("says why veBTC has no answer at 1× or without veMEZO", async () => {
    mockRpc(() => false)
    render(
      await calculator({ calc: 1, vemezo: "100000", solve: "vebtc", for: 3 }),
    )
    await waitFor(() => expect(veBtcField().value).not.toBe(""))
    fireEvent.click(screen.getByRole("button", { name: "Aim for 1×" }))
    expect(veBtcField().value).toBe("")
    expect(
      screen.getByText(
        "No amount of veBTC lands on exactly 1×: any veMEZO lifts a veBTC lock above it. Choose a higher boost.",
      ),
    ).toBeTruthy()
    fireEvent.change(slider(), { target: { value: "300" } })
    fireEvent.change(veMezoField(), { target: { value: "0" } })
    expect(
      screen.getByText(
        "No amount of veBTC reaches 3.00× without veMEZO: every veBTC lock stays at 1×.",
      ),
    ).toBeTruthy()
  })

  it("needs no veMEZO at 1×, and asks for veBTC when there is none", async () => {
    mockRpc(() => false)
    render(await calculator())
    await waitFor(() => expect(veMezoField().value).toBe("151852"))
    fireEvent.change(slider(), { target: { value: "100" } })
    expect(veMezoField().value).toBe("0")
    expect(screen.getByText("At 1× no veMEZO is needed.")).toBeTruthy()
    fireEvent.change(veBtcField(), { target: { value: "0" } })
    expect(veMezoField().value).toBe("")
    expect(
      screen.getByText("Enter veBTC to work out the veMEZO it needs."),
    ).toBeTruthy()
  })

  it("shows 5× past the cap and says the extra veMEZO adds nothing", async () => {
    mockRpc(() => false)
    render(
      await calculator({ calc: 1, vebtc: "0.611", vemezo: "120000", for: 4 }),
    )
    await waitFor(() => expect(figure()).toBe("5.00×"))
    expect(
      screen.getByText(
        "5× is the most a veBTC lock gets. The last 27,218 veMEZO adds nothing.",
      ),
    ).toBeTruthy()
  })

  it("calculates the veMEZO for a boost chosen while the boost was calculated", async () => {
    mockRpc(() => false)
    render(
      await calculator({ calc: 1, vebtc: "1", vemezo: "100000", for: "5" }),
    )
    await waitFor(() => expect(figure()).toBe("3.63×"))
    expect(solving()).toBe(
      "Calculating the boost from the veBTC and veMEZO entered",
    )
    // The keyboard and a drag both arrive as a change of the range input.
    fireEvent.change(slider(), { target: { value: "325" } })
    expect(calcToggle("veMEZO").getAttribute("aria-pressed")).toBe("true")
    expect(veBtcField().value).toBe("1")
    expect(veMezoField().readOnly).toBe(true)
    expect(veMezoField().value).toBe("85417")
    expect(figure()).toBe("3.25×")
    expect(solving()).toBe("Calculating the veMEZO needed for 3.25×")
    expect(announced()).toBe("Calculating the veMEZO needed for 3.25×")
    // Further steps change the figure, not what is announced.
    fireEvent.change(slider(), { target: { value: "326" } })
    expect(announced()).toBe("Calculating the veMEZO needed for 3.25×")
  })

  it("calculates the veMEZO from a mark pressed while the boost was calculated", async () => {
    mockRpc(() => false)
    render(
      await calculator({ calc: 1, vebtc: "2", vemezo: "100000", for: "5" }),
    )
    await waitFor(() => expect(figure()).not.toBe("…"))
    fireEvent.click(screen.getByRole("button", { name: "Aim for 5×" }))
    expect(veBtcField().value).toBe("2")
    expect(veMezoField().value).toBe("303704")
    expect(solving()).toBe("Calculating the veMEZO needed for 5.00×")
  })

  it("never calls the Calculate toggle a lock, in any of the three modes", async () => {
    mockRpc(() => false)
    render(
      await calculator({ calc: 1, vebtc: "1", vemezo: "100000", for: "5" }),
    )
    await waitFor(() => expect(figure()).toBe("3.63×"))
    const sheet = (): Element => {
      const found = document.querySelector("[data-boost-calculator]")
      if (found === null) throw new Error("no sheet")
      return found
    }
    const said = (): string[] => [
      ...[...sheet().querySelectorAll("p, label, button, dt, dd, span")].map(
        (each) => each.textContent ?? "",
      ),
      ...[...sheet().querySelectorAll("[title], [aria-label]")].flatMap(
        (each) => [
          each.getAttribute("title") ?? "",
          each.getAttribute("aria-label") ?? "",
        ],
      ),
    ]
    const check = (): void => {
      for (const text of said()) {
        // "lock" may name a token lock ("veBTC lock", "Your locks",
        // "New lock"), never the control or an instruction to press it.
        expect(text).not.toMatch(
          /\b(un)?lock (veBTC|veMEZO|a field|the field|this field|one)\b/i,
        )
        expect(text).not.toMatch(/^(un)?lock\b/i)
        expect(text).not.toMatch(/padlock/i)
      }
      for (const toggle of sheet().querySelectorAll("[data-calc-toggle]")) {
        expect(toggle.textContent ?? "").not.toMatch(/lock/i)
        expect(toggle.getAttribute("title") ?? "").not.toMatch(/lock/i)
      }
    }
    check()
    fireEvent.click(calcToggle("veMEZO"))
    check()
    fireEvent.click(calcToggle("veBTC"))
    check()
  })

  it("leaves no control that looks available and does nothing, whoever is viewing", async () => {
    mockRpc(() => false)
    const address = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
    const states = [
      { viewer: { kind: "signed-out" as const }, locks: [] },
      {
        viewer: { kind: "viewing" as const, address },
        locks: [lock("41", { votingPowerWei: `${100_000n * wad}` })],
      },
      {
        viewer: { kind: "connected" as const, address },
        locks: [lock("41", { votingPowerWei: `${100_000n * wad}` })],
      },
      { viewer: { kind: "connected" as const, address }, locks: [] },
    ]
    for (const state of states) {
      viewer.current = state.viewer
      wallet.locks = state.locks
      const view = render(await calculator())
      await waitFor(() => expect(figure()).not.toBe("…"))
      if (state.locks.length > 0) {
        await waitFor(() => expect(veMezoField().value).toBe("100000"))
        expect(
          screen.getByText(
            `${state.viewer.kind === "connected" ? "Your" : "This wallet's"} lock #41, 100,000 veMEZO`,
          ),
        ).toBeTruthy()
      }
      // Nothing is disabled, so nothing looks available without working
      // or looks unavailable without a reason beside it.
      const sheet = document.querySelector("[data-boost-calculator]")
      expect(sheet?.querySelectorAll(":disabled").length).toBe(0)
      expect(sheet?.querySelectorAll("[aria-disabled=true]").length).toBe(0)
      // The slider works in every mode it opens in.
      fireEvent.change(slider(), { target: { value: "400" } })
      expect(solving()).toMatch(/for 4\.00×$|to 4\.00×$/)
      view.unmount()
    }
  })

  it("opens from a link that asks for a figure and a boost", async () => {
    mockRpc(() => false)
    render(
      await calculator({
        calc: 1,
        vemezo: 100000,
        for: 3.25,
        solve: "vebtc",
      }),
    )
    await waitFor(() => expect(veBtcField().value).toBe("1.170732"))
    expect(slider().value).toBe("325")
  })

  it("fills veMEZO from the wallet's largest lock and works out the boost", async () => {
    mockRpc(() => false)
    viewer.current = {
      kind: "connected",
      address: "0x7c21095156ab25e989c3c084bcb06037c6539e0b",
    }
    wallet.locks = [
      lock("11", { votingPowerWei: `${41_260n * wad}` }),
      lock("12", { votingPowerWei: `${100_000n * wad}` }),
    ]
    render(await calculator())
    await waitFor(() => expect(veMezoField().value).toBe("100000"))
    expect(calcToggle("veMEZO").getAttribute("aria-pressed")).toBe("false")
    await waitFor(() => expect(figure()).toBe("3.63×"))
    // Using a wallet's lock in the worked-out field makes it typed again.
    fireEvent.click(calcToggle("veMEZO"))
    expect(veMezoField().readOnly).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Use" }))
    fireEvent.click(screen.getByRole("button", { name: "#11, 41,260 veMEZO" }))
    expect(veMezoField().readOnly).toBe(false)
    expect(veMezoField().value).toBe("41260")
    expect(calcToggle("veMEZO").getAttribute("aria-pressed")).toBe("false")
  })

  it("shows no number when the totals were never read, and lets them be typed", async () => {
    mockRpc(() => true)
    render(await calculator({ calc: 1, vebtc: "1", vemezo: "100000" }))
    await waitFor(() =>
      expect(screen.getByText("System totals could not be read")).toBeTruthy(),
    )
    // No boost, no placeholder totals: the result waits.
    expect(screen.queryByText(/^\d\.\d\d×$/)).toBeNull()
    expect(figure()).toBe("Needs the system totals")
    fireEvent.change(
      screen.getByRole("textbox", { name: "veBTC voting power, all locks" }),
      { target: { value: "654.52" } },
    )
    fireEvent.change(
      screen.getByRole("textbox", { name: "veMEZO voting power, all locks" }),
      { target: { value: "99390000" } },
    )
    expect(figure()).toBe("3.63×")
    expect(screen.getByText("Edited")).toBeTruthy()
  })

  it("links the totals' block on Matchscan in a new tab", async () => {
    mockRpc(() => false)
    render(await calculator({ calc: 1, vebtc: "1", vemezo: "100000" }))
    const block = await screen.findByRole("link", { name: /^Block 13,172,075/ })
    expect(block.getAttribute("href")).toBe(
      "https://scan.matchbox.markets/block/13172075",
    )
    expect(block.getAttribute("target")).toBe("_blank")
    expect(block.getAttribute("rel")).toBe("noreferrer noopener")
  })

  it("keeps the last good totals, named by block, when a later read fails", async () => {
    let failing = false
    mockRpc(() => failing)
    const first = render(
      await calculator({ calc: 1, vebtc: "1", vemezo: "100000" }),
    )
    await waitFor(() => expect(figure()).toBe("3.63×"))
    first.unmount()
    failing = true
    render(await calculator({ calc: 1, vebtc: "1", vemezo: "100000" }))
    await waitFor(() =>
      expect(screen.getByText(/^Totals from block 13,172,075/)).toBeTruthy(),
    )
    expect(figure()).toBe("3.63×")
    failing = false
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() =>
      expect(screen.queryByText(/^Totals from block/)).toBeNull(),
    )
  })

  it("tries other totals and goes back to the live ones", async () => {
    mockRpc(() => false)
    render(await calculator({ calc: 1, vebtc: "1", vemezo: "100000" }))
    await waitFor(() => expect(figure()).toBe("3.63×"))
    fireEvent.click(screen.getByRole("button", { name: "System totals" }))
    expect(screen.getByText("654.52 veBTC")).toBeTruthy()
    expect(screen.getByText("99.39M veMEZO")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Try other totals" }))
    fireEvent.change(
      screen.getByRole("textbox", { name: "veMEZO voting power, all locks" }),
      { target: { value: "134060000" } },
    )
    expect(figure()).toBe("2.95×")
    fireEvent.click(screen.getByRole("button", { name: "Use live totals" }))
    expect(figure()).toBe("3.63×")
  })

  it("leads to New lock for a connected wallet", async () => {
    mockRpc(() => false)
    viewer.current = {
      kind: "connected",
      address: "0x7c21095156ab25e989c3c084bcb06037c6539e0b",
    }
    render(await calculator())
    fireEvent.click(screen.getByRole("button", { name: "New lock" }))
    expect(opened.tx).toEqual([{ flow: "new-lock", kind: "vebtc" }])
  })
})

const account = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"

async function panel(
  kind: "vebtc" | "vemezo",
  votingPower: bigint,
): Promise<ReactNode> {
  const { LockBoostPanel } = await import("./lock-boost-panel")
  return (
    <LockBoostPanel kind={kind} votingPower={votingPower} account={account} />
  )
}

const mainLine = (): string =>
  document.querySelector("[data-lock-boost-main]")?.textContent ?? ""
const walletLine = (): string | null =>
  document.querySelector("[data-lock-boost-wallet]")?.textContent ?? null

/** The search the panel's link navigates to, beside a wallet address. */
function linked(): unknown {
  const [call] = navigate.mock.calls
  return call?.[0]?.search({ address: "0xabc" })
}

describe("the Boost panel in New lock", () => {
  it("BTC: says the veMEZO this lock needs for 5× as it is typed", async () => {
    mockRpc(() => false)
    const view = render(await panel("vebtc", 0n))
    expect(mainLine()).toBe(
      "Enter an amount to see the veMEZO it needs for the maximum 5× boost.",
    )
    view.rerender(await panel("vebtc", wad))
    await waitFor(() =>
      expect(mainLine()).toBe(
        "You will need about 151,852 veMEZO on this lock's gauge for the maximum 5× boost.",
      ),
    )
    view.rerender(await panel("vebtc", 2n * wad))
    expect(mainLine()).toBe(
      "You will need about 303,704 veMEZO on this lock's gauge for the maximum 5× boost.",
    )
    // No veMEZO in the wallet: no second line.
    expect(walletLine()).toBeNull()
  })

  it("BTC: says what the wallet's veMEZO gives and what more it needs", async () => {
    mockRpc(() => false)
    wallet.locks = [
      lock("21", { votingPowerWei: `${60_000n * wad}` }),
      lock("22", { votingPowerWei: `${40_000n * wad}` }),
    ]
    const view = render(await panel("vebtc", 0n))
    await waitFor(() =>
      expect(walletLine()).toBe("You hold 100,000 veMEZO to vote with."),
    )
    view.rerender(await panel("vebtc", wad))
    await waitFor(() =>
      expect(walletLine()).toBe(
        "Your 100,000 veMEZO, all on its gauge, would give about 3.63×: about 51,852 veMEZO more for 5×.",
      ),
    )
  })

  it("BTC: says when the wallet's veMEZO already reaches 5×", async () => {
    mockRpc(() => false)
    wallet.locks = [lock("21", { votingPowerWei: `${200_000n * wad}` })]
    render(await panel("vebtc", wad))
    await waitFor(() =>
      expect(walletLine()).toBe(
        "Your 200,000 veMEZO, all on its gauge, already reaches the maximum 5×.",
      ),
    )
  })

  it("BTC: tries a veMEZO figure and carries both to the calculator", async () => {
    mockRpc(() => false)
    render(await panel("vebtc", wad))
    await waitFor(() => expect(mainLine()).toMatch(/151,852 veMEZO/))
    expect(screen.getByText("1.0× until veMEZO votes for it")).toBeTruthy()
    navigate.mockClear()
    fireEvent.click(
      screen.getByRole("button", { name: "Open boost calculator" }),
    )
    expect(linked()).toEqual({
      address: "0xabc",
      calc: 1,
      vebtc: 1,
      for: 5,
      solve: "vemezo",
    })
    fireEvent.change(
      screen.getByRole("textbox", { name: /If its gauge gets/ }),
      { target: { value: "100,000" } },
    )
    expect(screen.getByText("3.63×")).toBeTruthy()
    navigate.mockClear()
    fireEvent.click(
      screen.getByRole("button", { name: "Open boost calculator" }),
    )
    expect(linked()).toEqual({
      address: "0xabc",
      calc: 1,
      vebtc: 1,
      vemezo: 100000,
      for: 5,
      solve: "boost",
    })
  })

  it("MEZO: says how much veBTC this veMEZO brings to 5×, against the wallet's locks", async () => {
    mockRpc(() => false)
    const view = render(await panel("vemezo", 0n))
    expect(mainLine()).toBe(
      "Enter an amount to see how much veBTC it can bring to the maximum 5× boost.",
    )
    view.rerender(await panel("vemezo", 100_000n * wad))
    const carries = formatVoteAmount(658_537_076_164_604_084n, "veBTC")
    await waitFor(() =>
      expect(mainLine()).toBe(
        `This lock's voting power can bring up to about ${carries} to the maximum 5× boost.`,
      ),
    )
    expect(walletLine()).toBeNull()
    navigate.mockClear()
    fireEvent.click(
      screen.getByRole("button", { name: "Open boost calculator" }),
    )
    expect(linked()).toEqual({
      address: "0xabc",
      calc: 1,
      vemezo: 100000,
      for: 5,
      solve: "vebtc",
    })
  })

  it("MEZO: says whether the wallet's veBTC locks are covered", async () => {
    mockRpc(() => false)
    wallet.locks = [
      lock("31", { kind: "vebtc", votingPowerWei: "611000000000000000" }),
    ]
    const view = render(await panel("vemezo", 100_000n * wad))
    const small = formatVoteAmount(611_000_000_000_000_000n, "veBTC")
    await waitFor(() =>
      expect(walletLine()).toBe(
        `That is enough for your veBTC lock (${small}) to reach 5×.`,
      ),
    )
    view.unmount()
    wallet.locks = [
      lock("31", { kind: "vebtc", votingPowerWei: `${wad}` }),
      lock("32", { kind: "vebtc", votingPowerWei: `${wad}` }),
    ]
    render(await panel("vemezo", 100_000n * wad))
    const two = formatVoteAmount(2n * wad, "veBTC")
    await waitFor(() =>
      expect(walletLine()).toBe(
        `Your veBTC locks hold ${two}: spread over their gauges, it would give them about 2.31×.`,
      ),
    )
  })

  it("says the totals could not be read, with no figure", async () => {
    mockRpc(() => true)
    for (const kind of ["vebtc", "vemezo"] as const) {
      const view = render(await panel(kind, wad))
      await waitFor(() =>
        expect(mainLine()).toBe(
          "System totals could not be read, so there is no figure yet.",
        ),
      )
      expect(screen.queryByText(/\d veMEZO/)).toBeNull()
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
      view.unmount()
    }
  })
})

describe("Ctrl K", () => {
  it('lists the calculator for "boost", ahead of Ask Stuart', () => {
    expect(matchCommands("boost").map((command) => command.label)).toEqual([
      "Boost calculator",
    ])
    expect(matchCommands("boo calc")).toHaveLength(1)
    expect(matchCommands("5x")).toHaveLength(1)
    expect(matchCommands("snf")).toEqual([])
    expect(matchCommands("  ")).toEqual([])
    const rows = rowsFor("boost", { kind: "idle" })
    expect(rows.map((row) => row.kind)).toEqual(["command", "ask"])
  })

  it("opens the calculator over the current page", () => {
    const router = { navigate: vi.fn() }
    stuartNavigate(router as never, calculatorPath)
    const [options] = router.navigate.mock.calls[0] ?? []
    expect(options).toMatchObject({ to: ".", resetScroll: false })
    expect(options.search({ address: "0xabc" })).toEqual({
      address: "0xabc",
      calc: 1,
    })
  })
})
