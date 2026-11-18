import { describe, expect, it } from "vitest"
import {
  BOOST_STEP_WAD,
  BOOST_WAD,
  type BoostTotals,
  boostGap,
  boostWad,
  boostWadFromHundredths,
  formatBoostWad,
  hundredthsFromBoostWad,
  MAX_BOOST_WAD,
  veBtcForBoost,
  veBtcForBoostWad,
  veMezoForBoost,
  veMezoForBoostWad,
  veMezoPerVeBtc,
} from "./boostCalculator"
import { calculateOptimalVeMEZO } from "./optimalVeMEZO"

const wad = BOOST_WAD
const units = (whole: number, fraction = 0): bigint =>
  BigInt(whole) * wad + (BigInt(fraction) * wad) / 10_000n

// The system on 12 Nov 2026, block 13,172,107 (the design's figures).
const totals: BoostTotals = {
  veBtc: units(654, 5200),
  veMezo: units(99_390_000),
}

// ---------------------------------------------------------------------------
// Matchbox Classic's calculator, copied as it runs today, to compare with.
// apps/webapp/src/utils/boostMultiplierFromCalculatorInputs.ts and the two
// solvers in apps/webapp/src/components/BoostCalculator.tsx.
// ---------------------------------------------------------------------------

function classicWad(
  unboostedNftVp: bigint,
  gaugeVeMezoWeight: bigint,
  veBtcSystemTotal: bigint,
  veMezoSystemTotal: bigint,
): bigint {
  if (
    unboostedNftVp === 0n ||
    gaugeVeMezoWeight === 0n ||
    veBtcSystemTotal === 0n ||
    veMezoSystemTotal === 0n
  ) {
    return wad
  }
  const numerator = 4n * veBtcSystemTotal * gaugeVeMezoWeight * wad
  const denominator = unboostedNftVp * veMezoSystemTotal
  const raw = wad + numerator / denominator
  return raw > 5n * wad ? 5n * wad : raw
}

/** The float path Classic's page displays. */
function classicFloat(
  btc: number,
  mezo: number,
  tBtc: number,
  tMezo: number,
): number {
  if (btc <= 0 || mezo <= 0 || tBtc <= 0 || tMezo <= 0) return 1
  return Math.min(5, Math.max(1, 1 + 4 * (tBtc / btc) * (mezo / tMezo)))
}

function classicSolveForMezo(
  target: number,
  btc: number,
  tBtc: number,
  tMezo: number,
): number {
  return ((target - 1) * tMezo * btc) / (4 * tBtc)
}

function classicSolveForBtc(
  target: number,
  mezo: number,
  tBtc: number,
  tMezo: number,
): number {
  return (4 * tBtc * mezo) / (tMezo * (target - 1))
}

/** veBTC, veMEZO votes on its gauge: whole and ten-thousandths. */
const cases: { name: string; veBtc: bigint; veMezo: bigint; shown: string }[] =
  [
    {
      name: "1 BTC for 4 weeks, 100,000 veMEZO (the default)",
      veBtc: units(1),
      veMezo: units(100_000),
      shown: "3.63",
    },
    {
      name: "lock #4120 with lock #2207's votes",
      veBtc: units(0, 6110),
      veMezo: units(41_260),
      shown: "2.77",
    },
    {
      name: "a small lock far past 5×",
      veBtc: units(0, 100),
      veMezo: units(1_000_000),
      shown: "5.00",
    },
    {
      name: "a whale with little veMEZO",
      veBtc: units(50, 137),
      veMezo: units(218_012),
      shown: "1.11",
    },
    {
      name: "just under 5×",
      veBtc: units(1),
      veMezo: units(151_700),
      shown: "4.99",
    },
    {
      name: "one base unit of each",
      veBtc: 1n,
      veMezo: 1n,
      shown: "1.00",
    },
    {
      name: "nothing voted",
      veBtc: units(1),
      veMezo: 0n,
      shown: "1.00",
    },
  ]

describe("against Matchbox Classic's calculator", () => {
  it.each(cases)("gives Classic's exact boost: $name", (entry) => {
    expect(boostWad({ veBtc: entry.veBtc, veMezo: entry.veMezo, totals })).toBe(
      classicWad(entry.veBtc, entry.veMezo, totals.veBtc, totals.veMezo),
    )
    expect(
      formatBoostWad(
        boostWad({ veBtc: entry.veBtc, veMezo: entry.veMezo, totals }),
      ),
    ).toBe(entry.shown)
  })

  it.each(cases)(
    "is within float error of the figure Classic's page computes: $name",
    (entry) => {
      const ours =
        Number(boostWad({ veBtc: entry.veBtc, veMezo: entry.veMezo, totals })) /
        1e18
      const theirs = classicFloat(
        Number(entry.veBtc) / 1e18,
        Number(entry.veMezo) / 1e18,
        Number(totals.veBtc) / 1e18,
        Number(totals.veMezo) / 1e18,
      )
      expect(Math.abs(ours - theirs)).toBeLessThan(1e-9)
    },
  )

  it("differs from Classic's page only in rounding the displayed figure down", () => {
    // 4.996×: Classic's page shows toFixed(2), "5.00", before 5× is
    // reached. Here it reads 4.99 until the lock has 5×.
    const veBtc = units(1)
    const veMezo = units(151_700)
    const value = boostWad({ veBtc, veMezo, totals })
    const float = classicFloat(1, 151_700, 654.52, 99_390_000)
    expect(float.toFixed(2)).toBe("5.00")
    expect(value).toBeLessThan(MAX_BOOST_WAD)
    expect(formatBoostWad(value)).toBe("4.99")
  })

  it("solves for veMEZO as Classic does, rounded up to be enough", () => {
    for (const target of [2, 3, 4, 5] as const) {
      const ours = veMezoForBoost({ target, veBtc: units(0, 6110), totals })
      const theirs = classicSolveForMezo(target, 0.611, 654.52, 99_390_000)
      if (ours === null) throw new Error("no totals")
      expect(Math.abs(Number(ours) / 1e18 - theirs)).toBeLessThan(1e-6)
      // Enough, and not one base unit more than enough.
      const reached = boostWad({ veBtc: units(0, 6110), veMezo: ours, totals })
      expect(reached).toBeGreaterThanOrEqual(BigInt(target) * wad - 1n)
      if (ours > 0n) {
        expect(
          boostWad({ veBtc: units(0, 6110), veMezo: ours - 10n ** 6n, totals }),
        ).toBeLessThan(BigInt(target) * wad)
      }
    }
  })

  it("solves for veBTC as Classic does, rounded down to still reach it", () => {
    for (const target of [2, 3, 4, 5] as const) {
      const ours = veBtcForBoost({ target, veMezo: units(41_260), totals })
      const theirs = classicSolveForBtc(target, 41_260, 654.52, 99_390_000)
      if (ours === null) throw new Error("no totals")
      expect(Math.abs(Number(ours) / 1e18 - theirs)).toBeLessThan(1e-9)
      expect(
        boostWad({ veBtc: ours, veMezo: units(41_260), totals }),
      ).toBeGreaterThanOrEqual(BigInt(target) * wad)
    }
  })
})

describe("the calculator's rows", () => {
  it("matches the design: 151,847 veMEZO per veBTC for 5× at these totals", () => {
    const ratio = veMezoPerVeBtc(5, totals)
    expect(ratio === null ? null : ratio / wad).toBe(151_851n)
  })

  it("agrees with the gauge band's optimal veMEZO to one base unit", () => {
    const veBtc = units(0, 6110)
    const needed = veMezoForBoost({ target: 5, veBtc, totals })
    const band = calculateOptimalVeMEZO(veBtc, 0n, totals.veBtc, totals.veMezo)
    if (needed === null || band === undefined) throw new Error("no totals")
    // The band rounds down, the calculator up.
    expect(needed - band.optimalVeMEZO).toBeLessThanOrEqual(1n)
    expect(needed).toBeGreaterThanOrEqual(band.optimalVeMEZO)
  })

  it("says how much is to go, or how far past the target", () => {
    const veBtc = units(0, 6110)
    const under = boostGap({ target: 5, veBtc, veMezo: units(41_260), totals })
    expect(under?.over).toBe(0n)
    expect(under === null ? null : under.toGo / wad).toBe(51_521n)
    const over = boostGap({ target: 5, veBtc, veMezo: units(120_000), totals })
    expect(over?.toGo).toBe(0n)
    expect(over === null ? null : over.over / wad).toBe(27_218n)
    // To go and what there is add up to what is needed.
    expect((under?.toGo ?? 0n) + units(41_260)).toBe(under?.needed)
  })

  it("has no answer without totals, never a made-up one", () => {
    const none: BoostTotals = { veBtc: 0n, veMezo: 0n }
    expect(veMezoForBoost({ target: 5, veBtc: wad, totals: none })).toBeNull()
    expect(veBtcForBoost({ target: 5, veMezo: wad, totals: none })).toBeNull()
    expect(veMezoPerVeBtc(5, none)).toBeNull()
    expect(
      boostGap({ target: 5, veBtc: wad, veMezo: wad, totals: none }),
    ).toBeNull()
    expect(boostWad({ veBtc: wad, veMezo: wad, totals: none })).toBe(wad)
  })

  it("formats a boost rounded down", () => {
    expect(formatBoostWad(3_634_999_999_999_999_999n)).toBe("3.63")
    expect(formatBoostWad(4_999_999_999_999_999_999n)).toBe("4.99")
    expect(formatBoostWad(MAX_BOOST_WAD)).toBe("5.00")
    expect(formatBoostWad(3_650_000_000_000_000_000n, 1)).toBe("3.6")
    expect(formatBoostWad(wad, 0)).toBe("1")
  })
})

describe("solving for any boost on the slider", () => {
  const targets = [101, 125, 200, 325, 363, 450, 499, 500].map(
    boostWadFromHundredths,
  )
  const veBtcs = [1n, units(0, 6110), units(1), units(50, 137), units(400)]
  const veMezos = [1n, units(41_260), units(100_000), units(5_000_000)]

  it("solves for veMEZO: that much veMEZO gives the target, one less does not", () => {
    for (const targetWad of targets) {
      for (const veBtc of veBtcs) {
        const veMezo = veMezoForBoostWad({ targetWad, veBtc, totals })
        if (veMezo === null) throw new Error("no totals")
        expect(boostWad({ veBtc, veMezo, totals })).toBeGreaterThanOrEqual(
          targetWad,
        )
        if (veMezo > 0n) {
          expect(boostWad({ veBtc, veMezo: veMezo - 1n, totals })).toBeLessThan(
            targetWad,
          )
        }
      }
    }
  })

  it("solves for veBTC: that much veBTC reaches the target, more does not", () => {
    for (const targetWad of targets) {
      for (const veMezo of veMezos) {
        const veBtc = veBtcForBoostWad({ targetWad, veMezo, totals })
        if (veBtc === null) throw new Error("no answer")
        if (veBtc === 0n) continue
        expect(boostWad({ veBtc, veMezo, totals })).toBeGreaterThanOrEqual(
          targetWad,
        )
        expect(boostWad({ veBtc: veBtc + 1n, veMezo, totals })).toBeLessThan(
          targetWad === MAX_BOOST_WAD ? MAX_BOOST_WAD + 1n : targetWad + 1n,
        )
      }
    }
  })

  it("goes round: a boost from two figures solves back to the same figures", () => {
    const veBtc = units(1)
    const veMezo = units(100_000)
    const boost = boostWad({ veBtc, veMezo, totals })
    expect(formatBoostWad(boost)).toBe("3.63")
    const backMezo = veMezoForBoostWad({ targetWad: boost, veBtc, totals })
    const backBtc = veBtcForBoostWad({ targetWad: boost, veMezo, totals })
    if (backMezo === null || backBtc === null) throw new Error("no answer")
    // The boost was rounded down to a base unit, so the way back lands a
    // hair under what went in (under a millionth of a veMEZO here), and
    // never short of the boost.
    expect(veMezo - backMezo).toBeLessThan(10n ** 12n)
    expect(backMezo).toBeLessThanOrEqual(veMezo)
    expect(backBtc).toBeGreaterThanOrEqual(veBtc)
    expect(boostWad({ veBtc: backBtc, veMezo, totals })).toBe(boost)
  })

  it("agrees with the whole-number solvers at 2× to 5×", () => {
    for (const target of [2, 3, 4, 5] as const) {
      const targetWad = BigInt(target) * wad
      expect(
        veMezoForBoostWad({ targetWad, veBtc: units(0, 6110), totals }),
      ).toBe(veMezoForBoost({ target, veBtc: units(0, 6110), totals }))
      expect(
        veBtcForBoostWad({ targetWad, veMezo: units(41_260), totals }),
      ).toBe(veBtcForBoost({ target, veMezo: units(41_260), totals }))
    }
  })

  it("needs no veMEZO for 1×, and has no veBTC answer at 1× or without veMEZO", () => {
    expect(veMezoForBoostWad({ targetWad: wad, veBtc: units(1), totals })).toBe(
      0n,
    )
    expect(
      veBtcForBoostWad({ targetWad: wad, veMezo: units(100_000), totals }),
    ).toBeNull()
    expect(
      veBtcForBoostWad({ targetWad: 3n * wad, veMezo: 0n, totals }),
    ).toBeNull()
  })

  it("holds a target to 1× to 5×", () => {
    const at5 = veMezoForBoostWad({
      targetWad: MAX_BOOST_WAD,
      veBtc: wad,
      totals,
    })
    expect(veMezoForBoostWad({ targetWad: 9n * wad, veBtc: wad, totals })).toBe(
      at5,
    )
    expect(veMezoForBoostWad({ targetWad: 0n, veBtc: wad, totals })).toBe(0n)
  })

  it("has no answer without totals", () => {
    const none: BoostTotals = { veBtc: 0n, veMezo: units(1) }
    expect(
      veMezoForBoostWad({ targetWad: 3n * wad, veBtc: wad, totals: none }),
    ).toBeNull()
    expect(
      veBtcForBoostWad({ targetWad: 3n * wad, veMezo: wad, totals: none }),
    ).toBeNull()
  })

  it("moves between hundredths and wad without floats", () => {
    expect(boostWadFromHundredths(325)).toBe(325n * BOOST_STEP_WAD)
    expect(boostWadFromHundredths(50)).toBe(wad)
    expect(boostWadFromHundredths(900)).toBe(MAX_BOOST_WAD)
    expect(hundredthsFromBoostWad(3_634_999_999_999_999_999n)).toBe(363)
    expect(hundredthsFromBoostWad(MAX_BOOST_WAD)).toBe(500)
    expect(hundredthsFromBoostWad(0n)).toBe(100)
  })
})
