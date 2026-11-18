import { describe, expect, it } from "vitest"
import { CASES, kindOf } from "./cases"
import { publicChecks } from "./describe"
import { NEAR_DUPLICATES, PUBLIC } from "./public"
import { families } from "./split"

describe("public questions", () => {
  it("names only real cases, each once", () => {
    const ids = new Set(CASES.map((each) => each.id))
    expect(Object.keys(PUBLIC).filter((id) => !ids.has(id))).toEqual([])
    expect(NEAR_DUPLICATES.flat().filter((id) => !ids.has(id))).toEqual([])
    expect(ids.size).toBe(CASES.length)
  })

  it("keeps whole families on one side of the split", () => {
    const roots = families(CASES, NEAR_DUPLICATES)
    const sides = new Map<string, Set<boolean>>()
    for (const testCase of CASES) {
      const root = roots.get(testCase.id) ?? testCase.id
      const side = sides.get(root) ?? new Set<boolean>()
      side.add(testCase.id in PUBLIC)
      sides.set(root, side)
    }
    const split = CASES.filter(
      (testCase) =>
        (sides.get(roots.get(testCase.id) ?? testCase.id)?.size ?? 0) > 1,
    ).map((testCase) => testCase.id)
    expect(split).toEqual([])
  })

  it("joins a long shared opening and a shared answer value", () => {
    const base = CASES.find((each) => each.id === "script.snf")
    const other = CASES.find((each) => each.id === "gauge.boar")
    if (!base || !other) throw new Error("cases moved")
    const copy = { ...base, id: "copy", query: `${base.query} (again)` }
    const twin = {
      ...other,
      id: "twin",
      expect: { numbers: [{ value: 9_658.44, tolerance: 0.01 }] },
    }
    const flow = CASES.find((each) => each.id === "activity.flow_enclave")
    if (!flow) throw new Error("cases moved")
    const roots = families([base, copy, other, twin, flow], [])
    expect(roots.get("copy")).toBe(roots.get("script.snf"))
    expect(roots.get("twin")).toBe(roots.get("activity.flow_enclave"))
    expect(roots.get("gauge.boar")).not.toBe(roots.get("script.snf"))
  })

  it("is about a third of every kind", () => {
    const kinds = new Map<string, { all: number; open: number }>()
    for (const testCase of CASES) {
      const row = kinds.get(kindOf(testCase)) ?? { all: 0, open: 0 }
      row.all += 1
      if (testCase.id in PUBLIC) row.open += 1
      kinds.set(kindOf(testCase), row)
    }
    for (const [kind, row] of kinds) {
      const share = row.open / row.all
      expect(share, kind).toBeGreaterThanOrEqual(0.25)
      expect(share, kind).toBeLessThanOrEqual(0.45)
    }
    const total = Object.keys(PUBLIC).length / CASES.length
    expect(total).toBeGreaterThan(0.3)
    expect(total).toBeLessThan(0.37)
  })

  it("words every public case's checks plainly", () => {
    for (const testCase of CASES) {
      const words = PUBLIC[testCase.id]
      if (words === undefined) continue
      const checks = publicChecks(testCase, words)
      for (const line of checks) {
        expect(line, testCase.id).not.toMatch(/\\|\(\?|\[|\]|\/[a-z]*$/)
        expect(line, testCase.id).not.toMatch(/[—–·]/)
      }
    }
  })
})
