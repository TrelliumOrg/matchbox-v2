import { beforeEach, describe, expect, it, vi } from "vitest"

const findMezoId = vi.fn()

vi.mock("./mezo-id", () => ({
  findMezoId: (input: { data: { q: string } }) => findMezoId(input),
}))

const { mezoIdAddressPath } = await import("./mezo-id-path")

const wallet = `0x${"4a".repeat(20)}`
const tabs = new Set(["votes", "activity"])

describe("mezoIdAddressPath", () => {
  beforeEach(() => {
    findMezoId.mockReset()
    findMezoId.mockResolvedValue({ mezoId: "alice.mezo", wallets: [wallet] })
  })

  it("sends an ID to its wallet's page, keeping a known tab", async () => {
    expect(
      await mezoIdAddressPath("Alice.mezo", "/address/Alice.mezo", tabs),
    ).toBe(`/address/${wallet}`)
    expect(
      await mezoIdAddressPath("alice.mezo", "/address/alice.mezo/votes", tabs),
    ).toBe(`/address/${wallet}/votes`)
    expect(
      await mezoIdAddressPath(
        "alice.mezo",
        "/address/alice.mezo/evil.example",
        tabs,
      ),
    ).toBe(`/address/${wallet}`)
    expect(findMezoId).toHaveBeenCalledWith({ data: { q: "alice.mezo" } })
  })

  it("sends a Bitcoin address to the EVM address Mezo links with it", async () => {
    const btc = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
    findMezoId.mockResolvedValue({
      mezoId: null,
      wallets: [wallet],
      btcAddress: btc,
    })
    expect(
      await mezoIdAddressPath(
        btc.toUpperCase(),
        `/address/${btc.toUpperCase()}/votes`,
        tabs,
      ),
    ).toBe(`/address/${wallet}/votes`)
    expect(findMezoId).toHaveBeenCalledWith({ data: { q: btc } })
    // No account for it is its own answer; Mezo out is the plain 404.
    findMezoId.mockResolvedValue({ mezoId: null, wallets: [], btcAddress: btc })
    expect(await mezoIdAddressPath(btc, "/", tabs)).toBe("none")
    findMezoId.mockResolvedValue(null)
    expect(await mezoIdAddressPath(btc, "/", tabs)).toBeNull()
  })

  it("is the 404 for a segment that is no ID, asking nothing", async () => {
    for (const segment of [
      "alice",
      "a_b.mezo",
      "..",
      "a/b.mezo",
      "x.eth",
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
    ]) {
      expect(await mezoIdAddressPath(segment, "/", tabs), segment).toBeNull()
    }
    expect(findMezoId).not.toHaveBeenCalled()
  })

  it("is the 404 for an ID with no wallet, or a wallet that is not an address", async () => {
    findMezoId.mockResolvedValue(null)
    expect(await mezoIdAddressPath("nobody.mezo", "/", tabs)).toBeNull()
    findMezoId.mockResolvedValue({
      mezoId: "odd.mezo",
      wallets: ["//evil.example"],
    })
    expect(await mezoIdAddressPath("odd.mezo", "/", tabs)).toBeNull()
  })
})
