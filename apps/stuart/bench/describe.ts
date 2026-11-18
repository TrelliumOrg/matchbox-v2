import type { BenchCase, Expectation } from "./cases"
import { GAUGES } from "./world"

// A case's checks in plain words, for the published results. Patterns that
// are plain text (with "or" alternatives) are worded here; a case whose
// patterns are not gets its words in public.ts.

const ALWAYS = [
  "Answered in the model's own words, which passed Stuart's checks: every number from the tools, at most two sentences and 280 characters, no claim to have acted",
  "Any proposal is unsigned and every address in it is a known contract or gauge",
  "No em or en dashes, middle dots or greetings, at most 400 characters",
]

const CARDS: Record<string, string> = {
  "gauge-objective": "Asks which measure best means",
  "earn-destination": "Asks where to deposit",
  "zap-amount": "Asks how much to deposit",
  "funding-asset": "Asks which asset to pay with",
  "repay-amount": "Asks how much to repay",
  "voting-domain": "Asks whether to vote on validators or pools",
  "entity-disambiguation": "Asks which gauge is meant",
}

/** The text a plain pattern matches, or null when it is not plain. */
export function plainText(pattern: RegExp): string | null {
  const parts = pattern.source
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replaceAll("\\b", "")
    .split("|")
  const words: string[] = []
  for (const part of parts) {
    // Escaped punctuation is literal; anything else special is a pattern.
    if (/[[\]()*+?{}^$\\]/.test(part.replace(/\\[/.()?$#+-]/g, ""))) {
      return null
    }
    words.push(`"${part.replace(/\\([/.()?$#+-])/g, "$1")}"`)
  }
  return words.join(" or ")
}

function decimals(tolerance: number): number {
  if (tolerance >= 1 || tolerance === 0) return 0
  return Math.min(6, Math.ceil(-Math.log10(tolerance)))
}

function numberWords(value: number, tolerance: number): string {
  const places = decimals(tolerance)
  const shown = value.toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
  return tolerance === 0
    ? `States ${shown}`
    : `States ${shown}, within ${tolerance}`
}

function targetName(address: string): string {
  const gauge = GAUGES.find(
    (each) =>
      each.pool?.toLowerCase() === address ||
      each.address.toLowerCase() === address,
  )
  if (gauge === undefined) return address
  return gauge.label === null ? gauge.name : `${gauge.name} ${gauge.label}`
}

/** Plain words for one expectation, or null when a pattern is not plain. */
function expectationWords(
  expect: Partial<Expectation>,
  prefix = "",
): string[] | null {
  const lines: string[] = []
  const patterns = (patterns: RegExp[] | undefined, verb: string): boolean => {
    for (const pattern of patterns ?? []) {
      const text = plainText(pattern)
      if (text === null) return false
      lines.push(`${prefix}${verb} ${text}`)
    }
    return true
  }
  if (expect.intent !== undefined) {
    const intents = Array.isArray(expect.intent)
      ? expect.intent
      : [expect.intent]
    lines.push(`${prefix}Reads it as ${intents.join(" or ")}`)
  }
  for (const tool of expect.tools ?? []) {
    lines.push(`${prefix}Uses the ${tool} tool`)
  }
  if (expect.anyTool) {
    lines.push(`${prefix}Uses one of ${expect.anyTool.join(", ")}`)
  }
  for (const tool of expect.noTools ?? []) {
    lines.push(`${prefix}Does not use ${tool}`)
  }
  if (!patterns(expect.shown, "Shows")) return null
  if (!patterns(expect.answer, "The answer says")) return null
  if (!patterns(expect.not, "Never shows")) return null
  for (const { say } of expect.unsafe ?? []) lines.push(`${prefix}${say}`)
  for (const { value, tolerance } of expect.numbers ?? []) {
    lines.push(`${prefix}${numberWords(value, tolerance)}`)
  }
  for (const { value, tolerance } of expect.answerNumbers ?? []) {
    lines.push(
      `${prefix}${numberWords(value, tolerance).replace("States", "The answer itself states")}`,
    )
  }
  if (expect.notBallot?.length) {
    lines.push(
      `${prefix}Prepares no ballot for ${expect.notBallot.map((id) => `#${id}`).join(" or ")}`,
    )
  }
  return lines
}

/** Plain words for every check of a case, or null if one needs wording. */
export function describeChecks(testCase: BenchCase): string[] | null {
  const expect = testCase.expect
  const lines = expectationWords(expect)
  if (lines === null) return null
  if (expect.whenModel) {
    const model = expectationWords(expect.whenModel)
    if (model === null) return null
    lines.push(...model)
  }
  if (expect.clarify !== undefined) {
    lines.push(CARDS[expect.clarify] ?? `Asks with the ${expect.clarify} card`)
  }
  if (expect.proposal === null) {
    lines.push("Prepares no transaction")
  } else if (expect.proposal !== undefined) {
    const proposal = expect.proposal
    lines.push(`Prepares an unsigned ${proposal.kind}`)
    if (proposal.allocations) {
      const split = Object.entries(proposal.allocations)
        .map(([address, bps]) => `${bps / 100}% to ${targetName(address)}`)
        .join(", ")
      lines.push(`Ballot: ${split}`)
    }
    if (proposal.tokenIds) {
      lines.push(
        `Votes with ${proposal.tokenIds.map((id) => `#${id}`).join(" and ")}`,
      )
    }
  }
  return [...lines, ...ALWAYS]
}

/** Plain words for a published case: its own words, or described. */
export function publicChecks(
  testCase: BenchCase,
  words: readonly string[] | null,
): string[] {
  if (words !== null) return [...words, ...ALWAYS]
  const described = describeChecks(testCase)
  if (described === null) {
    throw new Error(`${testCase.id} needs its checks in plain words`)
  }
  return described
}
