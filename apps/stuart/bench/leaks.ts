import type { BenchCase, Expectation } from "./cases"
import { expectedLiterals, RARE_TARGET, WORLD_NAMES } from "./split"

// Before a results file is published, every public question's text,
// checks and shown answers are searched for the values a held-back
// question expects. A hit fails the publish, unless it is in
// LEAK_EXCEPTIONS with a reviewed reason.
//
// Only distinctive values count, so a short generic number that happens to
// coincide ("0.12%" APY against 0.1180 BTC claimed, "110%" against a
// minimum collateral ratio) is not a leak:
// - a number counts when, written to its check's tolerance, it has at
//   least four significant digits, not counting round zeros
//   ("282,928,843.50", "804.3", "1,353", never "10,000" or "110"), and
//   matches only within that tolerance;
// - an address prefix or a lock id counts as split.ts counts it (never a
//   WORLD_NAME);
// - a ballot target counts only when at most RARE_TARGET questions use it:
//   one most vote questions use (the BTC/MUSD CL200 pool) is the gauge
//   directory, which public answers show by design.

export type LeakException = { literal: string; reason: string }

export const LEAK_EXCEPTIONS: readonly LeakException[] = []

export type Leak = { publicId: string; literal: string; heldIds: string[] }

export class LeakError extends Error {
  override name = "LeakError"
}

/** A number as written has at least four significant digits. */
export function distinctive(value: number, _tolerance = 0): boolean {
  // As the value is written, to four decimals at most.
  const own = String(value).split(".")[1]?.length ?? 0
  const places = Math.min(4, own)
  // Significant digits as written: no leading zeros, no trailing ones
  // ("10,000" and "110.00" are round, "1,353" and "804.3000" are not).
  const written = Math.abs(value).toFixed(places)
  const digits = (written.includes(".") ? written.replace(/0+$/, "") : written)
    .replace(".", "")
    .replace(/^0+/, "")
    .replace(/0+$/, "")
  return digits.length >= 4
}

function numberLiterals(testCase: BenchCase): string[] {
  const expectations: Array<Partial<Expectation>> = [testCase.expect]
  if (testCase.expect.whenModel) expectations.push(testCase.expect.whenModel)
  return expectations.flatMap((expect) =>
    [...(expect.numbers ?? []), ...(expect.answerNumbers ?? [])]
      .filter(({ value, tolerance }) => distinctive(value, tolerance))
      // A count (tolerance 0) still matches as written, to the cent.
      .map(({ value, tolerance }) => `n:${value}:${tolerance}`),
  )
}

/** Every held-back question's distinctive expected values. */
export function heldLiterals(
  cases: readonly BenchCase[],
  publicIds: ReadonlySet<string>,
): Map<string, string[]> {
  const targetUse = new Map<string, number>()
  for (const testCase of cases) {
    for (const literal of expectedLiterals(testCase)) {
      if (literal.startsWith("t:")) {
        targetUse.set(literal, (targetUse.get(literal) ?? 0) + 1)
      }
    }
  }
  const found = new Map<string, string[]>()
  for (const testCase of cases) {
    if (publicIds.has(testCase.id)) continue
    const literals = [
      ...numberLiterals(testCase),
      ...expectedLiterals(testCase).filter(
        (literal) =>
          !literal.startsWith("n:") &&
          !WORLD_NAMES.has(literal) &&
          !(
            literal.startsWith("t:") &&
            (targetUse.get(literal) ?? 0) > RARE_TARGET
          ),
      ),
    ]
    for (const literal of literals) {
      found.set(literal, [...(found.get(literal) ?? []), testCase.id])
    }
  }
  return found
}

function numbersIn(text: string): number[] {
  return [
    ...text.replace(/0x[0-9a-fA-F]+/g, " ").matchAll(/\d[\d,]*(?:\.\d+)?/g),
  ].map((match) => Number(match[0].replace(/,/g, "")))
}

function shows(text: string, literal: string): boolean {
  const kind = literal.slice(0, 1)
  const value = literal.slice(2)
  if (kind === "n") {
    const [wanted = "", tolerance = "0"] = value.split(":")
    return numbersIn(text).some(
      (number) => Math.abs(number - Number(wanted)) <= Number(tolerance) + 1e-9,
    )
  }
  if (kind === "a" || kind === "t") {
    return text.toLowerCase().includes(value.toLowerCase())
  }
  if (kind === "l") return new RegExp(`${value}(?!\\d)`).test(text)
  return false
}

/** Held-back values found in public text, minus the reviewed exceptions. */
export function findLeaks(
  published: ReadonlyArray<{ id: string; text: string }>,
  held: ReadonlyMap<string, string[]>,
  exceptions: readonly LeakException[] = LEAK_EXCEPTIONS,
): Leak[] {
  const allowed = new Set(exceptions.map((each) => each.literal))
  const leaks: Leak[] = []
  for (const { id, text } of published) {
    for (const [literal, heldIds] of held) {
      if (allowed.has(literal)) continue
      if (shows(text, literal)) leaks.push({ publicId: id, literal, heldIds })
    }
  }
  return leaks
}
