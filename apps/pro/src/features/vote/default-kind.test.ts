import { describe, expect, it } from "vitest"
import type { GaugeKind, Lock } from "../../data/view-models"
import { voterSample } from "../samples"
import { defaultKind, fundedAlternative } from "./default-kind"

const sampleLock = voterSample.lock
if (sampleLock === null) throw new Error("samples")

const veMezo: Lock = { ...sampleLock, kind: "vemezo" }
const veBtc: Lock = { ...sampleLock, kind: "vebtc" }

/** Mainnet on 19 Nov 2026: pool gauges held every funded incentive. */
const poolsOnly: GaugeKind[] = ["pool"]

describe("the type /vote opens on", () => {
  it("is the type with funded gauges for a signed-out visitor", () => {
    expect(defaultKind([], poolsOnly)).toBe("pool")
  })

  it("keeps veBTC gauges while they are funded", () => {
    expect(defaultKind([], ["pool", "vebtc"])).toBe("vebtc")
  })

  it("prefers the type a wallet's locks vote, when they are of one kind", () => {
    const both: GaugeKind[] = ["pool", "mezo"]
    expect(defaultKind([veMezo], both)).toBe("mezo")
    expect(defaultKind([veBtc], both)).toBe("pool")
    // Locks of both kinds: the most funded of all.
    expect(defaultKind([veMezo, veBtc], both)).toBe("pool")
  })

  it("keeps the locks' first type when none they vote is funded", () => {
    expect(defaultKind([veMezo], poolsOnly)).toBe("vebtc")
    expect(defaultKind([veBtc], ["vebtc"])).toBe("validator")
  })

  it("keeps the current default when nothing is funded at all", () => {
    expect(defaultKind([], [])).toBe("vebtc")
  })
})

describe("the type offered when one has nothing funded", () => {
  it("is the most funded other type", () => {
    expect(fundedAlternative("vebtc", [], poolsOnly)).toEqual({
      kind: "pool",
      needs: null,
    })
    expect(fundedAlternative("pool", [], poolsOnly)).toBeNull()
  })

  it("is one the locks vote first", () => {
    const funded: GaugeKind[] = ["pool", "mezo"]
    expect(fundedAlternative("vebtc", [veMezo], funded)).toEqual({
      kind: "mezo",
      needs: null,
    })
    expect(fundedAlternative("validator", [veBtc], funded)).toEqual({
      kind: "pool",
      needs: null,
    })
  })

  it("names the lock a type needs when the locks vote none funded", () => {
    // A veMEZO-only wallet in Epoch 49: only pool gauges, voted with veBTC.
    expect(fundedAlternative("vebtc", [veMezo], poolsOnly)).toEqual({
      kind: "pool",
      needs: "vebtc",
    })
  })

  it("is none when no type is funded", () => {
    expect(fundedAlternative("vebtc", [], [])).toBeNull()
  })
})
