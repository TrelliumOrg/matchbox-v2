import { describe, expect, it } from "vitest"
import { shortPrimary } from "./ballot-panel"
import { bandLabel } from "./ballot-rail"

describe("allocation band", () => {
  it("says what is left, or how far over in red", () => {
    expect(bandLabel(9_200)).toEqual({ over: false, text: "8% left" })
    expect(bandLabel(10_000)).toEqual({ over: false, text: "0 left" })
    expect(bandLabel(11_200)).toEqual({ over: true, text: "12% over" })
    expect(bandLabel(10_050)).toEqual({ over: true, text: "0.5% over" })
    expect(bandLabel(8_750)).toEqual({ over: false, text: "12.5% left" })
  })

  it("drops the signature count from the phone bar's button", () => {
    expect(shortPrimary("Review and sign, 14 signatures")).toBe(
      "Review and sign",
    )
    expect(shortPrimary("Save for Epoch 49")).toBe("Save for Epoch 49")
  })
})
