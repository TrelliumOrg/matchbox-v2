import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IdentityLookup } from "../data/pro-api"

/**
 * The tab's identity cache keeps found and not found answers, never a
 * failed lookup, and an address's answer only under the address. The
 * fresh read for a transfer asks past it, then replaces what it held for
 * that ID, here and in the query client.
 */

const state = vi.hoisted(() => ({
  display: [] as (IdentityLookup | Error)[],
  fresh: [] as (IdentityLookup | Error)[],
  displayCalls: 0,
  freshCalls: 0,
  set: [] as [readonly unknown[], unknown][],
  removed: [] as (readonly unknown[])[],
}))

function next(queue: (IdentityLookup | Error)[]): IdentityLookup {
  const answer = queue.shift()
  if (answer === undefined) throw new Error("no answer queued")
  if (answer instanceof Error) throw answer
  return answer
}

vi.mock("../data/live-query", () => ({
  whenRuntime: (
    run: (runtime: {
      client: {
        setQueryData: (key: readonly unknown[], data: unknown) => void
        removeQueries: (filter: { queryKey: readonly unknown[] }) => void
      }
    }) => void,
  ) => {
    run({
      client: {
        setQueryData: (key, data) => state.set.push([key, data]),
        removeQueries: (filter) => state.removed.push(filter.queryKey),
      },
    })
    return () => {}
  },
  fetchLive: async () => {
    state.displayCalls += 1
    const answer = next(state.display)
    // As identityQuery does: unavailable rejects, so nothing keeps it.
    if (answer.status === "unavailable") throw new Error("unavailable")
    return answer
  },
}))
vi.mock("../data/queries", () => ({
  identityQuery: (key: string) => ({ queryKey: ["identity", key] }),
  loadProApi: async () => ({
    getFreshIdentity: async () => {
      state.freshCalls += 1
      return next(state.fresh)
    },
  }),
}))

const { freshMezoIdWallet, lookupIdentity, resetIdentities } = await import(
  "./identity"
)

const wallet = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const moved = "0x00000000000000000000000000000000000000a1"
const found = (address: string): IdentityLookup => ({
  status: "found",
  identity: { address, mezoId: "pyke.mezo" },
})

beforeEach(() => {
  resetIdentities()
  state.display = []
  state.fresh = []
  state.displayCalls = 0
  state.freshCalls = 0
  state.set = []
  state.removed = []
})

describe("lookupIdentity", () => {
  it("never keeps a failed lookup as 'no such ID'", async () => {
    state.display.push({ status: "unavailable" }, found(wallet))
    expect(await lookupIdentity("pyke.mezo")).toEqual({ status: "unavailable" })
    expect(await lookupIdentity("pyke.mezo")).toEqual(found(wallet))
    // Found is kept: no third request.
    expect(await lookupIdentity("pyke.mezo")).toEqual(found(wallet))
    expect(state.displayCalls).toBe(2)
  })

  it("keeps a not found answer for the tab", async () => {
    state.display.push({ status: "not-found" })
    await lookupIdentity("nobody.mezo")
    expect(await lookupIdentity("nobody.mezo")).toEqual({ status: "not-found" })
    expect(state.displayCalls).toBe(1)
  })

  it("keeps an address's answer under the address only", async () => {
    // Mezo named this address pyke.mezo; that is no answer for the ID.
    state.display.push(found(wallet), found(moved))
    await lookupIdentity(wallet)
    expect(await lookupIdentity("pyke.mezo")).toEqual(found(moved))
    expect(state.displayCalls).toBe(2)
  })

  it("answers unavailable when the request itself fails", async () => {
    state.display.push(new Error("network"))
    expect(await lookupIdentity("pyke.mezo")).toEqual({ status: "unavailable" })
  })
})

describe("freshMezoIdWallet", () => {
  it("asks every time, past the tab's cache", async () => {
    state.display.push(found(wallet))
    await lookupIdentity("pyke.mezo")
    state.fresh.push(found(moved), found(moved))
    expect(await freshMezoIdWallet("pyke.mezo")).toEqual(found(moved))
    expect(await freshMezoIdWallet("pyke.mezo")).toEqual(found(moved))
    expect(state.freshCalls).toBe(2)
  })

  it("replaces what the tab and the query client held for the ID", async () => {
    state.display.push(found(wallet))
    await lookupIdentity("pyke.mezo")
    state.fresh.push(found(moved))
    await freshMezoIdWallet("Pyke.mezo")
    // The next sheet shows the new wallet while typing, with no request.
    expect(await lookupIdentity("pyke.mezo")).toEqual(found(moved))
    expect(state.displayCalls).toBe(1)
    expect(state.set).toEqual([[["identity", "pyke.mezo"], found(moved)]])
    // The old wallet no longer reads as the ID's.
    expect(state.removed).toEqual([["identity", wallet]])
    state.display.push({ status: "not-found" })
    expect(await lookupIdentity(wallet)).toEqual({ status: "not-found" })
  })

  it("keeps nothing from a fresh read that failed", async () => {
    state.fresh.push({ status: "unavailable" })
    await freshMezoIdWallet("pyke.mezo")
    expect(state.set).toEqual([])
    state.display.push(found(wallet))
    expect(await lookupIdentity("pyke.mezo")).toEqual(found(wallet))
  })

  it("answers unavailable when the read fails", async () => {
    state.fresh.push(new Error("network"))
    expect(await freshMezoIdWallet("pyke.mezo")).toEqual({
      status: "unavailable",
    })
  })
})
