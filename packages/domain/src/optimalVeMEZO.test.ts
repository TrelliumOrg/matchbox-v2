import { describe, expect, it } from "vitest"
import calculateOptimalVeMEZO, {
  oversubscribedRedWidthPercent,
  weightToOptimalRatio,
} from "./optimalVeMEZO"

const WAD = 10n ** 18n

describe("calculateOptimalVeMEZO", () => {
  it("scales the lock's veBTC share of the veMEZO supply", () => {
    expect(
      calculateOptimalVeMEZO(10n * WAD, 3n * WAD, 100n * WAD, 50n * WAD),
    ).toEqual({ optimalVeMEZO: 5n * WAD, optimalAdditionalVeMEZO: 2n * WAD })
  })

  it("floors instead of rounding and never asks for negative weight", () => {
    expect(calculateOptimalVeMEZO(1n, 5n, 3n, 2n)).toEqual({
      optimalVeMEZO: 0n,
      optimalAdditionalVeMEZO: 0n,
    })
  })

  it("is undefined without supplies or veBTC weight", () => {
    expect(calculateOptimalVeMEZO(undefined, 0n, WAD, WAD)).toBeUndefined()
    expect(calculateOptimalVeMEZO(WAD, 0n, 0n, WAD)).toBeUndefined()
  })
})

// Classic's ratio helpers had no tests in Matchbox.
describe("oversubscription", () => {
  it("measures weight against the optimum", () => {
    expect(weightToOptimalRatio(15n * WAD, 10n * WAD)).toBe(1.5)
    expect(weightToOptimalRatio(WAD, 0n)).toBe(1)
  })

  it("fills from 1x to 2x and stays full", () => {
    expect(oversubscribedRedWidthPercent(0.8)).toBe(0)
    expect(oversubscribedRedWidthPercent(1.25)).toBe(25)
    expect(oversubscribedRedWidthPercent(3)).toBe(100)
  })
})
