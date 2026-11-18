import { describe, expect, it } from "vitest"
import { flattenPaste, pastedValue } from "./paste"

describe("pasting into one-line inputs", () => {
  it("keeps a post's lines apart", () => {
    expect(
      flattenPaste(
        "Vote accordingly.\r\n25% to the BTC/MUSD-200\n\n20% to the MUSD Savings Vault\n",
      ),
    ).toBe(
      "Vote accordingly. | 25% to the BTC/MUSD-200 | 20% to the MUSD Savings Vault",
    )
    expect(flattenPaste("one line")).toBe("one line")
  })

  it("pastes over the selection and caps the length", () => {
    expect(
      pastedValue({
        value: "vote: X",
        pasted: "60% to A\n40% to B",
        start: 6,
        end: 7,
        max: 2_000,
      }),
    ).toBe("vote: 60% to A | 40% to B")
    expect(
      pastedValue({ value: "", pasted: "a\nb", start: 0, end: 0, max: 3 }),
    ).toBe("a |")
    expect(
      pastedValue({ value: "", pasted: "plain", start: 0, end: 0, max: 9 }),
    ).toBeNull()
  })
})
