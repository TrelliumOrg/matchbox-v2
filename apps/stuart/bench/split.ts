import type { BenchCase, Expectation } from "./cases"

// Families of questions that must sit on the same side of the public split
// (public.ts): a public question must never give a held-back one away.
// Joined, transitively, are questions that
// - are listed together in NEAR_DUPLICATES (the same ask in other words),
// - have the same text, or share a long opening (a pasted post),
// - expect the same specific literal: a number that is not a small count,
//   an address prefix ("0x5959"), a lock id ("#2930"), a ballot's lock,
//   or a ballot's target that at most three questions use. WORLD_NAMES are how questions name the world, not
//   answers to give away: SNF's two addresses and its lock, and the bench
//   wallet's own locks, which wallet.locks (public) shows anyway.

const LONG_PREFIX = 150
/** Who SNF is: named by many questions on both sides of the split. */
/** A ballot target shared by more questions is directory vocabulary. */
export const RARE_TARGET = 3

export const WORLD_NAMES = new Set([
  "a:0xf365",
  "a:0x1473",
  "l:#6033",
  "l:#6100",
  "l:#4821",
  "l:#4966",
])

function commonPrefix(a: string, b: string): number {
  let index = 0
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1
  }
  return index
}

/** The specific values a case's checks expect to see. */
export function expectedLiterals(testCase: BenchCase): string[] {
  const found = new Set<string>()
  const expectations: Array<Partial<Expectation>> = [testCase.expect]
  if (testCase.expect.whenModel) expectations.push(testCase.expect.whenModel)
  for (const expect of expectations) {
    for (const { value } of [
      ...(expect.numbers ?? []),
      ...(expect.answerNumbers ?? []),
    ]) {
      if (!Number.isInteger(value) || Math.abs(value) >= 100) {
        found.add(`n:${Number(value.toFixed(2))}`)
      }
    }
    const proposal = "proposal" in expect ? expect.proposal : undefined
    for (const address of Object.keys(proposal?.allocations ?? {})) {
      found.add(`t:${address.slice(0, 6).toLowerCase()}`)
    }
    for (const tokenId of proposal?.tokenIds ?? []) found.add(`l:#${tokenId}`)
    for (const pattern of [...(expect.shown ?? []), ...(expect.answer ?? [])]) {
      for (const match of pattern.source.matchAll(/0x[0-9a-fA-F]{4}/g)) {
        found.add(`a:${match[0].toLowerCase()}`)
      }
      for (const match of pattern.source.matchAll(/#\d{3,}/g)) {
        found.add(`l:${match[0]}`)
      }
    }
  }
  return [...found]
}

/** Each case's family root, joining groups, texts and shared literals. */
export function families(
  cases: readonly BenchCase[],
  groups: readonly (readonly string[])[],
): Map<string, string> {
  const parent = new Map(cases.map((each) => [each.id, each.id]))
  const root = (id: string): string => {
    const up = parent.get(id) ?? id
    if (up === id) return id
    const top = root(up)
    parent.set(id, top)
    return top
  }
  const join = (a: string, b: string) => parent.set(root(a), root(b))
  for (const group of groups) {
    for (const id of group) join(group[0] ?? id, id)
  }
  const byLiteral = new Map<string, string[]>()
  for (const testCase of cases) {
    for (const literal of expectedLiterals(testCase)) {
      byLiteral.set(literal, [...(byLiteral.get(literal) ?? []), testCase.id])
    }
  }
  for (const [literal, ids] of byLiteral) {
    if (WORLD_NAMES.has(literal)) continue
    // A ballot target most vote questions use (sMUSD, BTC/MUSD CL200) is the
    // gauge directory; one few questions use is an answer.
    if (literal.startsWith("t:") && ids.length > RARE_TARGET) continue
    for (const id of ids) join(ids[0] ?? id, id)
  }
  for (let i = 0; i < cases.length; i += 1) {
    for (let j = i + 1; j < cases.length; j += 1) {
      const a = cases[i]
      const b = cases[j]
      if (a === undefined || b === undefined) continue
      if (a.query === b.query || commonPrefix(a.query, b.query) > LONG_PREFIX) {
        join(a.id, b.id)
      }
    }
  }
  return new Map(cases.map((each) => [each.id, root(each.id)]))
}
