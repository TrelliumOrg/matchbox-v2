import {
  matchCommands,
  registerSearchCommands,
} from "@matchbox/stuart-ui/commands"
import { describe, expect, it, vi } from "vitest"
import type { Lock } from "../data/view-models"
import { lockCommands } from "./lock-commands"
import { keepAddress, registerProCommands, stuartNavigate } from "./navigate"

const viewed = `0x${"59".repeat(20)}`

const lock = (kind: Lock["kind"], tokenId: string, amount: string) =>
  ({ kind, tokenId, amount }) as unknown as Lock

/** A router that records what it was asked to open. */
function recorder() {
  const navigate = vi.fn()
  const router = { navigate } as unknown as Parameters<typeof stuartNavigate>[0]
  return { router, navigate }
}

describe("locks and pages in the search box", () => {
  it("names each lock, says what it holds, and goes to its wallet's Overview", () => {
    expect(
      lockCommands(
        [lock("vemezo", "2207", "48000"), lock("vebtc", "4120", "0.8")],
        viewed.toUpperCase().replace("0X", "0x"),
      ),
    ).toEqual([
      {
        id: "lock-vemezo-2207",
        label: "veMEZO #2207",
        hint: "48,000.00 MEZO locked",
        keywords: ["lock", "locks", "2207"],
        to: `/?address=${viewed}`,
        group: "Locks",
      },
      {
        id: "lock-vebtc-4120",
        label: "veBTC #4120",
        hint: "0.8000 BTC locked",
        keywords: ["lock", "locks", "4120"],
        to: `/?address=${viewed}`,
        group: "Locks",
      },
    ])
  })

  it("opens a viewed wallet's lock on that wallet, not the connected one", () => {
    const { router, navigate } = recorder()
    const [row] = lockCommands([lock("vemezo", "2207", "48000")], viewed)
    stuartNavigate(router, row?.to ?? "")
    expect(navigate).toHaveBeenCalledWith({
      to: "/",
      search: { address: viewed },
    })
  })

  it("keeps the viewed wallet when a page is opened from search", () => {
    const { router, navigate } = recorder()
    stuartNavigate(router, "/protocol")
    const [options] = navigate.mock.calls[0] ?? []
    expect(options.to).toBe("/protocol")
    // The router calls `search` with the current search params.
    expect(options.search({ address: viewed, calc: "1" })).toEqual({
      address: viewed,
    })
    expect(options.search({})).toEqual({})
    expect(keepAddress({ address: undefined })).toEqual({})
  })

  it("finds a lock by its number and a page by its name", () => {
    registerProCommands()
    registerSearchCommands(
      lockCommands([lock("vemezo", "2207", "48000")], viewed),
      "locks",
    )
    expect(matchCommands("2207").map((found) => found.label)).toEqual([
      "veMEZO #2207",
    ])
    expect(matchCommands("proto").map((found) => found.group)).toEqual([
      "Pages",
    ])
    // The calculator, ungrouped, still leads.
    expect(matchCommands("vemezo").map((found) => found.label)).toEqual([
      "Boost calculator",
      "veMEZO #2207",
    ])
    registerSearchCommands([], "locks")
  })
})
