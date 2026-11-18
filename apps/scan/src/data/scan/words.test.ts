import { describe, expect, it } from "vitest"
import { bandTone } from "../../explorer/address/shared"
import { bandWords } from "./words"

describe("health band words", () => {
  it("says No price, in a neutral tone, when debt has no price", () => {
    expect(bandWords.unknown).toBe("No price")
    expect(bandTone.unknown).toBe("text-ink")
    // Only real states carry a colour.
    expect(bandTone.healthy).toBe("text-pos")
    expect(bandTone.liquidatable).toBe("text-neg")
  })
})
