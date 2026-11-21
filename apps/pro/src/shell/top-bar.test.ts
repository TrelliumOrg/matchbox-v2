import { describe, expect, it } from "vitest"
import { headerAccount } from "./top-bar"

const mine = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const theirs = "0x147379a0174780570d07d70a14fb244ee5f2d786"
const safe = "0x5afe000000000000000000000000000000000001"

const viewing = (address: string) => ({ kind: "viewing" as const, address })

describe("the header's account button", () => {
  it("is Connect wallet with no wallet on screen", () => {
    const viewer = { kind: "signed-out" } as const
    expect(
      headerAccount({
        viewer,
        other: false,
        own: null,
        connected: false,
        settled: false,
      }),
    ).toBeNull()
  })

  it("is your connected account", () => {
    expect(
      headerAccount({
        viewer: { kind: "connected", address: mine },
        other: false,
        own: mine,
        connected: true,
        settled: true,
      }),
    ).toEqual({ address: mine, connected: true })
  })

  it("keeps your account beside someone else's while it reconnects", () => {
    // A hard load: the server and the hydrating page know only the cookie.
    expect(
      headerAccount({
        viewer: viewing(theirs),
        other: true,
        own: mine,
        connected: false,
        settled: false,
      }),
    ).toEqual({ address: mine, connected: false })
    expect(
      headerAccount({
        viewer: viewing(theirs),
        other: true,
        own: mine,
        connected: true,
        settled: true,
      }),
    ).toEqual({ address: mine, connected: true })
  })

  it("offers Connect wallet once the reconnect failed", () => {
    // A locked extension or an expired WalletConnect session: without a
    // way to connect, the owner was stuck on "Viewing only".
    for (const viewer of [viewing(theirs), viewing(mine), viewing(safe)]) {
      expect(
        headerAccount({
          viewer,
          other: viewer.address === theirs,
          own: mine,
          connected: false,
          settled: true,
        }),
      ).toBeNull()
    }
  })

  it("is Connect wallet beside someone else's with no wallet of yours", () => {
    expect(
      headerAccount({
        viewer: viewing(theirs),
        other: true,
        own: null,
        connected: false,
        settled: false,
      }),
    ).toBeNull()
  })

  it("is your saved Safe, viewed while its owner is connected", () => {
    expect(
      headerAccount({
        viewer: viewing(safe),
        other: false,
        own: mine,
        connected: true,
        settled: true,
      }),
    ).toEqual({ address: safe, connected: false })
  })
})
