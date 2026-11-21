import type {
  Evidence,
  Fact,
  StuartResponse,
} from "@matchbox/stuart-ui/contract"
import { parseBallotScript } from "./ballotScript"
import {
  type NumberWords,
  numberWords,
  withoutNumberWords,
} from "./numberWords"
import { isUntrustedModelKey, type ModelView } from "./outcome"
import {
  type ClaimFigures,
  claimsToHaveActed as claimsIn,
  sentencesOf,
} from "./sourcedClaims"
import { dateIsKnown, dateKeyOf, dateKeys, dateSpans } from "./sourcedDates"
import { plainInstructions } from "./sourcedInstructions"
import {
  asciiDigits,
  disguisedFigures,
  hiddenText,
  knownTld,
  linkKey,
  linkReads,
  ownHost,
  parseLink,
  plainText,
} from "./sourcedText"

// Sourced-by-construction checks. Every digit Stuart shows must trace back to
// a fact (template answers) or to a structured value a tool returned in this
// turn (model answers). Addresses are checked the same way, dates as whole
// dates (sourcedDates.ts), numbers written in words by their value, and
// links only to the project's and Mezo's own domains (sourcedText.ts).
// Claims to have acted are in sourcedClaims.ts, instructions in plain words
// in sourcedInstructions.ts.

const ADDRESS_PATTERN = /0x[0-9a-fA-F]{3,}(?:…|\.\.\.)?[0-9a-fA-F]*/g
const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?/g
/**
 * Digits in groups of three after a space ("5 000"), one number to a
 * reader. NFKC (plainText) has made no-break and thin spaces plain ones.
 */
const SPACE_GROUPED = /(?<![\d.,])\d{1,3}(?: \d{3})+(?![\d]|[.,]\d)/g
/**
 * Digits in groups of three after a dot ("5.000", "12.500.000"): a
 * thousands mark in much of the world, a decimal point in Stuart's own.
 */
const DOT_GROUPED = /(?<![\d.,])[1-9]\d{0,2}(?:\.\d{3})+(?![\d]|[.,]\d)/g

/**
 * A scale written after digits: "3 thousand", "5 grand", "10k", "1.5M",
 * "5MM", "5 M", "2 bn", "2 thou", "5 lakh", "5 crore". "3 thousand" is one
 * value, 3000, never 3 and 1000. A lone lowercase "m" or "b" counts only
 * written on the digits ("5m"); spaced, only in capitals ("5 M").
 */
const SCALE_AFTER =
  /^(?:\s*(hundred|thousand|thou|lakhs?|crores?|million|billion|trillion|grand|mil|mln|mn|bn)\b|\s?(mm|MM|k|K|M|B)(?![\p{L}\d])|(m|b)(?![\p{L}\d]))/u
const SCALE_VALUE: Record<string, bigint> = {
  hundred: 100n,
  thousand: 1_000n,
  thou: 1_000n,
  grand: 1_000n,
  k: 1_000n,
  lakh: 100_000n,
  lakhs: 100_000n,
  million: 1_000_000n,
  mil: 1_000_000n,
  mln: 1_000_000n,
  mn: 1_000_000n,
  m: 1_000_000n,
  mm: 1_000_000n,
  crore: 10_000_000n,
  crores: 10_000_000n,
  billion: 1_000_000_000n,
  bn: 1_000_000_000n,
  b: 1_000_000_000n,
  trillion: 1_000_000_000_000n,
}

/**
 * A token or a unit after a number: what makes it an amount ("5 MUSD",
 * "5 bitcoin", "5 bucks"). Symbols are written with two capitals or more.
 */
const TOKEN_AFTER_SYMBOL =
  /^\s*(?:-\s*)?(?!(?:UTC|GMT|APY|APR)\b)[a-z]{0,2}[A-Z]{2,}(?![\p{L}\d])/u
const TOKEN_AFTER_WORD =
  /^\s*(?:-\s*)?(?:bitcoins?|btc|musd|mezo|usd[ct]?|dollars?|bucks?|sats?|satoshis?|tokens?|coins?|ve(?:btc|mezo)|smusd|eth|ether|worth\s+of)(?![\p{L}\d])/iu
/** A count of things named by a token: "5 veBTC holders", "8 veMEZO locks". */
const COUNTED_AFTER_TOKEN =
  /^\s+(?:holders?|locks?|gauges?|positions?|wallets?|addresses|voters?|pools?|lines?|ballots?|claims?|nfts?|transfers?|transactions?|votes?|incentives?|rewards?|vaults?)\b/i

/**
 * How far after a number a scale or a token is looked for. Reading a
 * bounded window, not the rest of the text, keeps the check linear in the
 * text's length.
 */
const AFTER_WINDOW = 64

/** The text with each span blanked to spaces, in one pass. */
function blanked(
  text: string,
  spans: readonly { start: number; end: number }[],
): string {
  const chars = text.split("")
  for (const span of spans) {
    for (let index = span.start; index < span.end; index += 1) {
      chars[index] = " "
    }
  }
  return chars.join("")
}

/** Whether a token or a unit starts the text (after a number). */
function tokenAfter(text: string): boolean {
  const token = TOKEN_AFTER_SYMBOL.exec(text) ?? TOKEN_AFTER_WORD.exec(text)
  if (token === null) return false
  return !COUNTED_AFTER_TOKEN.test(text.slice(token[0].length))
}

/** "1,024.80" → "1024.8", "042" → "42", "0.50" → "0.5". */
export function canonicalNumber(token: string): string {
  const plain = token.replace(/,/g, "")
  const [whole = "0", fraction = ""] = plain.split(".")
  const trimmedWhole = whole.replace(/^0+(?=\d)/, "")
  const trimmedFraction = fraction.replace(/0+$/, "")
  return trimmedFraction ? `${trimmedWhole}.${trimmedFraction}` : trimmedWhole
}

/** A canonical number times a whole factor: ("1.5", 1000) → "1500". */
function scaleNumber(canonical: string, factor: bigint): string {
  const [whole = "0", fraction = ""] = canonical.split(".")
  const digits = BigInt(`${whole}${fraction}`) * factor
  if (fraction.length === 0) return digits.toString()
  const text = digits.toString().padStart(fraction.length + 1, "0")
  return canonicalNumber(
    `${text.slice(0, -fraction.length)}.${text.slice(-fraction.length)}`,
  )
}

export function addressTokens(text: string): string[] {
  return [...text.matchAll(ADDRESS_PATTERN)].map((match) => match[0])
}

type NumberSpan = {
  start: number
  end: number
  /** The digits as written, canonical ("10" in "10k"). */
  raw: string
  /** The value with its scale ("10000" for "10k"). */
  value: string
  /**
   * A form a reader may take two ways: "5 000" (5000, or 5 and 0) and
   * "5.000" (5000, or 5). Absent for a plain number.
   */
  grouped?:
    | { kind: "space"; parts: string[] }
    | { kind: "dot"; decimal: string | null; zeros: boolean }
}

/** Every number in digits, with its scale, addresses left out. */
function numberSpans(text: string): NumberSpan[] {
  let masked = text.replace(ADDRESS_PATTERN, (match) =>
    " ".repeat(match.length),
  )
  const spans: NumberSpan[] = []
  for (const match of masked.matchAll(SPACE_GROUPED)) {
    const parts = match[0].split(" ").map(canonicalNumber)
    const value = canonicalNumber(match[0].replace(/ /g, ""))
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: value,
      value,
      grouped: { kind: "space", parts },
    })
  }
  masked = blanked(masked, spans)
  for (const match of masked.matchAll(DOT_GROUPED)) {
    const groups = match[0].split(".")
    const value = canonicalNumber(groups.join(""))
    const single = groups.length === 2
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: value,
      value,
      grouped: {
        kind: "dot",
        decimal: single ? canonicalNumber(match[0]) : null,
        zeros: /^0+$/.test(groups[1] ?? ""),
      },
    })
  }
  masked = blanked(masked, spans)
  for (const match of masked.matchAll(NUMBER_PATTERN)) {
    const raw = canonicalNumber(match[0])
    let end = match.index + match[0].length
    let value = raw
    const scale = SCALE_AFTER.exec(masked.slice(end, end + AFTER_WINDOW))
    const word = scale?.[1] ?? scale?.[2] ?? scale?.[3] ?? ""
    const factor = SCALE_VALUE[word.toLowerCase()]
    if (scale && factor !== undefined) {
      value = scaleNumber(raw, factor)
      end += scale[0].length
    }
    spans.push({ start: match.index, end, raw, value })
  }
  return spans.sort((a, b) => a.start - b.start)
}

/**
 * The values a number in tool output sources. Stuart writes a dot as a
 * decimal point, so "1.250" there is 1.25; "5 000" is 5000.
 */
function spanValues(span: NumberSpan): string[] {
  if (span.grouped?.kind === "dot" && span.grouped.decimal !== null) {
    return [span.grouped.decimal]
  }
  return [span.value]
}

/** Every reading of a number, for the user's own and a tool's arguments. */
function spanReadings(span: NumberSpan): string[] {
  const readings = [span.raw, span.value]
  if (span.grouped?.kind === "space") readings.push(...span.grouped.parts)
  if (span.grouped?.kind === "dot" && span.grouped.decimal !== null) {
    readings.push(span.grouped.decimal)
  }
  return readings
}

export function numberTokens(text: string): string[] {
  return numberSpans(text).flatMap(spanValues)
}

/** Numbers and addresses a tool echoed from its arguments. */
type Echo = { numbers: Set<string>; addresses: string[] }

export type SourcedSet = {
  numbers: Set<string>
  addresses: string[]
  /**
   * Numbers and addresses a tool's result stated only as an echo of the
   * arguments the model gave it ("amount": "7777" coming back as "7,777.00
   * MEZO", a subject address coming back as the holder). The model chose
   * them, so they count only where ECHO_RULE allows.
   */
  echo: Echo
  /**
   * Names in this turn's results whose digits are part of the name, not a
   * number to source: written exactly, they pass. Pool names whose only
   * digits are the pool type ("mUSDC/MUSD CL10"), a ballot line the user
   * wrote ("BTC/MUSD-300", from a row's label or an "As written" fact, only
   * when it is a whole ballot target of the user's message) and a prepared
   * proposal's id.
   */
  names: Set<string>
  /**
   * The ballot targets the user's own message names, lowercased: the target
   * of each "N% to X" line the ballot parser finds in it ("vote 100% to
   * BTC/MUSD-300" gives "btc/musd-300"). They vet "as written" names only:
   * tool arguments are the model's, so a line counts as the user's only if
   * it is one of these, whole. They never source a number or an address.
   */
  userTargets: Set<string>
  /**
   * Dates this turn's results state, as keys ("2026-08-15", sourcedDates.ts),
   * and today's date. A date in the answer is sourced only as a whole.
   */
  dates: Set<string>
  /**
   * Names in this turn's results (a gauge's or validator's, a symbol),
   * kept as written. A number word joined to the name's letters inside one
   * word ("Lavender.Five") is part of the name. They never source digits.
   */
  textNames: Set<string>
  /**
   * Token symbols this turn's results hold, as written: chain text, blanked
   * out of every value before its figures are read ("7,770.97 CLAIM 7777
   * MUSD" is 7,770.97 and a symbol).
   */
  symbols: Set<string>
  /**
   * Hosts this turn's tool output names (evidence links, Stuart's own
   * text), lowercased. A link in a model sentence passes only when its
   * host is one of the project's or Mezo's own (OWN_DOMAINS) and is here.
   */
  hosts: Set<string>
  /**
   * Links this turn's tool output names, as host and path
   * ("scan.matchbox.markets/address/0x1"). A link with a path passes only
   * when it is one of these.
   */
  links: Set<string>
  /**
   * Stuart's own lines this turn (the template of the answer being given):
   * a model sentence repeating one word for word is not an instruction.
   */
  own: string[]
  /**
   * This turn prepared an unsigned proposal: "Review and sign in your
   * wallet" is then Stuart's own flow, not someone else's instruction.
   */
  prepared: boolean
  /**
   * The user's own message, lowercased, and its numbers (digits in any
   * script, scales and number words) and addresses (whole, shortened or a
   * prefix). Text a tool composed may echo them (a lock id or an address
   * the user asked about); such an echo never sources them, and a name the
   * user wrote is not a name (textNames).
   */
  user: { text: string; numbers: Set<string>; addresses: string[] }
}

/**
 * Figures Stuart's own prompt states (claude.ts), written exactly: the
 * vote freeze, "Thursday 00:00 to 01:00 UTC". Its digits source nothing
 * else.
 */
const PROMPT_PHRASES = ["00:00 to 01:00 UTC"]

/**
 * Every number a text holds, however written: digits in any script
 * ("٦٠٣٣"), each as written and with its scale ("10k" is 10 and 10000),
 * every reading of a grouped form, and numbers in words ("six thousand
 * thirty three").
 */
function textNumbers(text: string): Set<string> {
  const plain = asciiDigits(text)
  const numbers = new Set<string>()
  for (const span of numberSpans(plain)) {
    for (const each of spanReadings(span)) numbers.add(each)
  }
  for (const each of numberWords(plain)) {
    if (each.value !== "vague") numbers.add(each.value)
  }
  return numbers
}

export function emptySourcedSet(userMessage = ""): SourcedSet {
  return {
    numbers: new Set(),
    addresses: [],
    echo: { numbers: new Set(), addresses: [] },
    names: new Set(PROMPT_PHRASES),
    userTargets: new Set(
      parseBallotScript(userMessage).lines.map((line) =>
        line.target.toLowerCase(),
      ),
    ),
    dates: new Set(),
    textNames: new Set(),
    symbols: new Set(),
    hosts: new Set(),
    links: new Set(),
    own: [],
    prepared: false,
    user: {
      text: userMessage.toLowerCase(),
      numbers: textNumbers(userMessage),
      addresses: addressTokens(asciiDigits(userMessage)).map((each) =>
        each.toLowerCase(),
      ),
    },
  }
}

/**
 * The numbers and addresses in a tool call's arguments, the model's own
 * choice. Read like the user's message: every reading of every number,
 * and addresses whole, shortened or as a prefix.
 */
export function argumentFigures(input: unknown): Echo {
  const numbers = new Set<string>()
  const addresses: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      for (const each of textNumbers(value)) numbers.add(each)
      for (const address of addressTokens(asciiDigits(value))) {
        addresses.push(address.toLowerCase())
      }
    } else if (typeof value === "number" || typeof value === "bigint") {
      for (const each of textNumbers(String(value))) numbers.add(each)
    } else if (Array.isArray(value)) {
      for (const each of value) walk(each)
    } else if (value !== null && typeof value === "object") {
      for (const each of Object.values(value)) walk(each)
    }
  }
  walk(input)
  return { numbers, addresses }
}

/**
 * How a figure a tool echoed from the model's own arguments counts:
 *
 * - "strict": never. Only an independent read (another call, or a value
 *   the call did not take as an argument) sources it.
 * - "amounts": never as an amount (a number with a token or "$" beside
 *   it), never as an address in a sentence telling the user to send,
 *   transfer, repay, approve, deposit or claim; otherwise it counts (a
 *   lock id, a window in days, an address the user asked about named back).
 *
 * Measured on the stored bench answers (internal/matchbench), see the PR.
 */
export const ECHO_RULE: "strict" | "amounts" = "amounts"

const POOL_NAME = /^[^\d\n]{1,60} CL\d{1,5}$/
const PROPOSAL_ID =
  /\b(?:vote|claim|lock|zap|repay|relock|surplus)_[0-9a-f]{8}\b/g
/** Labels "as written" by the user: a line or name, quoted as it was. */
const AS_WRITTEN_LABELS = new Set(["As written"])

/**
 * Text facts Stuart composes itself from chain values and its own clock:
 * dates ("15 Aug 2026", "Wed 20 Oct 2027"), short addresses, lock lines
 * ("1 veBTC (#6033) and 8 veMEZO (#1178, #1184 and more)") and a relock
 * ("then 24,120.00 MEZO added to veMEZO #4821"). None holds a name or text
 * the user wrote, so their dates are sourced (as whole dates), and their
 * addresses and numbers except those the user's own message holds (a tool
 * echoes the lock or address it was asked about). Any other text fact is a
 * name. Before adding a label here, check that every tool using it composes
 * its display from chain values only, never from a name or the user's text.
 */
export const COMPOSED_TEXT_LABELS: ReadonlySet<string> = new Set([
  "Since",
  "Period",
  "Read back to",
  "Latest votes",
  "Unlocks",
  "Vesting ends",
  "Epoch ends",
  "Locks",
  "Lock",
  "Relock",
  "Address",
  "Holder",
  "Counterparty",
  "History short for",
])

function addPoolName(set: SourcedSet, text: string): void {
  const name = text.trim()
  if (POOL_NAME.test(name)) set.names.add(name)
}

/**
 * A digit standing free, not attached to a name: "7 BTC", "$5000 bonus",
 * "Your 10000 MUSD". In "BTC/MUSD-300" or "CL200" every digit follows a
 * letter, a digit, "-" or "/".
 */
const FREE_DIGIT = /(?<![\p{L}\d\-/])\d/u

/**
 * A ballot line as written, kept exactly. The tool echoes the model's
 * argument, so it counts only when it is a whole ballot target the user
 * wrote (case aside), never a piece of the user's text, and only when each
 * of its digits belongs to a name: "BTC/MUSD-300", never "300", "7 BTC" or
 * "MUSD-300" cut from "BTC/MUSD-300". Its digits vouch for nothing else.
 */
function addWrittenName(set: SourcedSet, text: string): void {
  const name = text.trim()
  if (
    name.length > 0 &&
    name.length <= 80 &&
    /\d/.test(name) &&
    /\p{L}/u.test(name) &&
    !FREE_DIGIT.test(name) &&
    set.userTargets.has(name.toLowerCase())
  ) {
    set.names.add(name)
  }
}

/** A prepared proposal's id, from the outcome's proposals only. */
export function addProposalIds(set: SourcedSet, text: string): void {
  for (const match of text.matchAll(PROPOSAL_ID)) {
    set.names.add(match[0])
    set.prepared = true
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
}

/**
 * The text with exact names from the results stripped of digits. A name
 * only counts where it starts and ends: "CL10" in "CL100", "CL10k",
 * "CL10%", "CL10 %" or "CL10.5" is not the name "... CL10".
 */
function withoutNames(text: string, set: SourcedSet): string {
  let masked = text
  const names = [...set.names].sort((a, b) => b.length - a.length)
  for (const name of names) {
    const exact = new RegExp(
      `(?<![\\p{L}\\d])${escapeRegExp(name)}(?![\\p{L}\\d%]|\\s*%|[.,]\\d)`,
      "gu",
    )
    masked = masked.replace(exact, name.replace(/\d/g, ""))
  }
  return masked
}

/** The hosts and links of the links in a text Stuart or a tool wrote. */
function addHosts(set: SourcedSet, text: string): void {
  for (const read of linkReads(text)) {
    if (read.defanged) continue
    const parsed = parseLink(read.text)
    if (parsed === null) continue
    set.hosts.add(parsed.host)
    set.links.add(`${parsed.host}${parsed.rest}`)
  }
}

/** An address the user's message holds, in any written form. */
function userAddress(set: SourcedSet, address: string): boolean {
  return set.user.addresses.some((each) => sameAddress(each, address))
}

/** A number into the set, or into its echoes when the call's own. */
function addNumber(set: SourcedSet, value: string, echo: Echo | null): void {
  if (echo?.numbers.has(value)) set.echo.numbers.add(value)
  else set.numbers.add(value)
}

/** An address into the set, or into its echoes when the call's own. */
function addAddress(set: SourcedSet, address: string, echo: Echo | null) {
  const lower = address.toLowerCase()
  if (echo?.addresses.some((each) => sameAddress(each, lower))) {
    set.echo.addresses.push(lower)
  } else {
    set.addresses.push(lower)
  }
}

function addText(set: SourcedSet, text: string, echo: Echo | null = null) {
  for (const token of numberTokens(text)) addNumber(set, token, echo)
  for (const address of addressTokens(text)) addAddress(set, address, echo)
  for (const key of dateKeys(text)) set.dates.add(key)
  addHosts(set, text)
}

type AddressForm = { head: string; tail: string; full: boolean }

/**
 * "0xf365…8bc4" (head and tail), the full 42 characters, or a prefix the
 * user typed with no ellipsis ("0xdeadbe": a head with no tail).
 */
function addressForm(text: string): AddressForm {
  const lower = text.toLowerCase()
  const [head = "", tail = ""] = lower.split(/…|\.\.\./)
  const cut = /…|\.\.\./.test(lower)
  return { head, tail, full: !cut && lower.length === 42 }
}

/** Two written forms that may be one address. */
function sameAddress(a: string, b: string): boolean {
  const x = addressForm(a)
  const y = addressForm(b)
  if (x.full && y.full) return x.head === y.head
  if (x.full || y.full) {
    const [full, cut] = x.full ? [x, y] : [y, x]
    return full.head.startsWith(cut.head) && full.head.endsWith(cut.tail)
  }
  const heads = x.head.startsWith(y.head) || y.head.startsWith(x.head)
  const tails = x.tail.endsWith(y.tail) || y.tail.endsWith(x.tail)
  return heads && tails
}

/**
 * A text fact Stuart composed (COMPOSED_TEXT_LABELS): its dates, and its
 * addresses and numbers less those the user's own message holds. A date
 * is the tool's own reading (a period it read, a day it reached back to),
 * sourced as a whole date only, so it is kept even when the user named it.
 */
function addComposedText(set: SourcedSet, text: string, echo: Echo | null) {
  let rest = withoutStrings(text, [...set.symbols])
  for (const span of dateSpans(rest).reverse()) {
    for (const key of span.keys) set.dates.add(key)
    rest = `${rest.slice(0, span.start)} ${rest.slice(span.end)}`
  }
  for (const address of addressTokens(rest)) {
    if (userAddress(set, address)) continue
    addAddress(set, address, echo)
  }
  for (const token of numberTokens(rest)) {
    if (!set.user.numbers.has(token)) addNumber(set, token, echo)
  }
  addHosts(set, rest)
}

/** The text with each of the given strings blanked wherever it stands whole. */
function withoutStrings(text: string, strings: readonly string[]): string {
  let masked = text
  for (const each of [...strings].sort((a, b) => b.length - a.length)) {
    if (each.trim() === "") continue
    masked = masked.replace(
      new RegExp(`(?<![\\p{L}\\d])${escapeRegExp(each)}(?![\\p{L}\\d])`, "gu"),
      " ",
    )
  }
  return masked
}

/** A row key whose value is a token symbol. */
const SYMBOL_KEY = /(?:^s|S)ymbol$/

/**
 * Every token symbol a turn's results hold, from token facts and from rows'
 * symbol fields: each is chain text, blanked out of every value of the
 * turn, not only its own row's ("native": "7,770.97 CLAIM 7777 MUSD" in a
 * row with no symbol of its own).
 */
export function addSymbols(
  set: SourcedSet,
  facts: readonly Fact[],
  view: ModelView | null = null,
): void {
  for (const fact of facts) {
    if (fact.value.kind === "token") set.symbols.add(fact.value.amount.symbol)
  }
  for (const row of view?.rows ?? []) {
    for (const [key, value] of Object.entries(row)) {
      if (value !== null && SYMBOL_KEY.test(key)) set.symbols.add(value)
    }
  }
}

export function addFacts(
  set: SourcedSet,
  facts: readonly Fact[],
  echo: Echo | null = null,
): void {
  addSymbols(set, facts)
  for (const fact of facts) {
    // Entity names are untrusted text: their digits don't vouch for numbers.
    if (fact.value.kind === "text") {
      if (AS_WRITTEN_LABELS.has(fact.label)) addWrittenName(set, fact.display)
      else if (COMPOSED_TEXT_LABELS.has(fact.label)) {
        addComposedText(set, fact.display, echo)
      } else {
        addPoolName(set, fact.display)
        set.textNames.add(fact.display)
      }
      continue
    }
    // A token's symbol is the token's own text ("7777 MUSD" as a symbol):
    // only the amount before it is a figure.
    addText(set, withoutStrings(fact.display, [...set.symbols]), echo)
  }
}

/** Today's date, as Stuart gives it to the model. */
export function addToday(set: SourcedSet, now: Date): void {
  set.dates.add(dateKeyOf(now))
}

/**
 * A tool's model rows. A value under a name key (isUntrustedModelKey:
 * "name", "label", "symbol", or "…Name", "…Label", "…Symbol") is chain or
 * user text and sources nothing; every other value is composed by Stuart
 * from typed values. A token's display carries its symbol ("50.00 MUSD"),
 * so every symbol of the turn (SourcedSet.symbols) is blanked out of it
 * first. Names are never composed into those values (plantedNames.test.ts),
 * and a value equal to one ("veBTC #5910", a lock id and the name of its
 * gauge) still counts.
 */
export function addModelView(
  set: SourcedSet,
  view: ModelView,
  echo: Echo | null = null,
): void {
  addSymbols(set, [], view)
  for (const row of view.rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value === null || !isUntrustedModelKey(key)) continue
      // A row's name may be a pool name; its label is a line as the user
      // wrote it, a name in its exact form. Neither vouches for numbers,
      // and a symbol never does.
      if (key === "name") addPoolName(set, value)
      if (key === "label") addWrittenName(set, value)
      // A label is a line as the user wrote it, never a name.
      else set.textNames.add(value)
    }
    for (const [key, value] of Object.entries(row)) {
      if (value === null || isUntrustedModelKey(key)) continue
      addText(set, withoutStrings(value, [...set.symbols]), echo)
    }
  }
}

/** Hosts and links of the links a tool's evidence carries (Stuart builds them). */
export function addEvidence(set: SourcedSet, evidence: readonly Evidence[]) {
  for (const item of evidence) {
    if (item.url === undefined) continue
    const key = linkKey(item.url)
    const parsed = parseLink(item.url)
    if (key === null || parsed === null) continue
    set.hosts.add(parsed.host)
    set.links.add(key)
  }
}

export function addAddresses(set: SourcedSet, addresses: readonly string[]) {
  for (const address of addresses) set.addresses.push(address.toLowerCase())
}

function addressIsKnown(token: string, known: readonly string[]): boolean {
  const lower = token.toLowerCase()
  const [head = "", tail = ""] = lower.split(/…|\.\.\./)
  if (!tail) return known.some((address) => address.startsWith(head))
  return known.some(
    (address) => address.startsWith(head) && address.endsWith(tail),
  )
}

/** "Lavender.Five," → "Lavender.Five": a word without the marks around it. */
function bareWord(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
}

/**
 * Words of this turn's names in which a number word is joined to other
 * letters ("Lavender.Five"), as written. Not a name the user's message
 * holds (a ballot line echoed as a target is the user's text).
 */
function joinedNameWords(set: SourcedSet): Set<string> {
  const words = new Set<string>()
  for (const name of set.textNames) {
    if (set.user.text.includes(name.toLowerCase())) continue
    for (const word of name.split(/\s+/).map(bareWord)) {
      if (
        numberWords(word).length > 0 &&
        /\p{L}/u.test(withoutNumberWords(word))
      ) {
        words.add(word)
      }
    }
  }
  return words
}

/**
 * A number word that is part of a name: joined to the name's letters in
 * one word, written exactly as the name has it ("Lavender.Five"). A number
 * word standing as a word of its own is always read ("Five Thousand Club").
 */
function inJoinedName(
  text: string,
  word: NumberWords,
  joined: ReadonlySet<string>,
): boolean {
  if (joined.size === 0) return false
  // A word of a name is short: look no further than a window either side.
  const from = Math.max(0, word.index - AFTER_WINDOW)
  const start = text.lastIndexOf(" ", word.index) + 1
  const stop = text.indexOf(" ", word.index)
  const end = stop === -1 ? text.length : stop
  if (start < from || end - word.index > AFTER_WINDOW) return false
  return joined.has(bareWord(text.slice(start, end)))
}

/** A token, a unit or "$" beside a number: it is an amount. */
function amountAt(text: string, start: number, end: number): boolean {
  return (
    tokenAfter(text.slice(end, end + AFTER_WINDOW)) ||
    /\$\s*$/.test(text.slice(Math.max(0, start - AFTER_WINDOW), start))
  )
}

/**
 * Words a sentence tells the user to move funds with: an echoed address
 * never counts in one (ECHO_RULE "amounts").
 */
const FUND_IMPERATIVE =
  /(?:^|[,:;]\s+|\b(?:and|then|so|please|just|now|first|you\s+(?:can|should|must|need\s+to|have\s+to)))\s*(?:send|transfer|repay|approve|deposit|claim|pay|bridge|move|withdraw|refund)\b/i

/** Whether this turn sources a number, at its place in the text. */
function numberKnown(set: SourcedSet, value: string, amount: boolean): boolean {
  if (set.numbers.has(value)) return true
  return ECHO_RULE === "amounts" && !amount && set.echo.numbers.has(value)
}

/** Whether a number as written is sourced, every reading of it considered. */
function spanKnown(set: SourcedSet, span: NumberSpan, text: string): boolean {
  const amount = amountAt(text, span.start, span.end)
  const known = (value: string) => numberKnown(set, value, amount)
  const grouped = span.grouped
  if (grouped === undefined) return known(span.value)
  if (grouped.kind === "space") {
    // "5 000": 5000 to most readers. Read as its parts only when each is
    // sourced and no token follows to make 5000 an amount.
    return known(span.value) || (!amount && grouped.parts.every(known))
  }
  // "5.000": 5000 in much of the world. As a decimal ("250.166 BTC") only
  // when that is sourced and its digits are not bare zeros.
  if (known(span.value)) return true
  return grouped.decimal !== null && !grouped.zeros && known(grouped.decimal)
}

/**
 * Words next to a token or a unit that read as an amount but are none of
 * the forms read here ("5ish MUSD", "a zillion MUSD", "2x BTC"): never
 * shown, since what they say cannot be checked.
 */
function unreadAmounts(text: string, spans: readonly NumberSpan[]): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/\S+/g)) {
    const word = match[0]
    const end = match.index + word.length
    // A word ending a sentence or a clause is not next to the token.
    if (/[.!?;:,]$/.test(word)) continue
    if (!tokenAfter(text.slice(end, end + AFTER_WINDOW)) || /0x/i.test(word)) {
      continue
    }
    // A code before the digits ("CL10.5") is a name's, read elsewhere.
    const core = word
      .replace(/^[$~≈+±#(]+|[%)]+$/gu, "")
      .replace(/^[A-Za-z]{1,6}(?=\d)/, "")
    if (core === "" || /^\d{1,2}:\d{2}$/.test(core)) continue
    const at = match.index + word.indexOf(core)
    if (/\d/.test(core)) {
      // What the numbers read here leave of the word: only marks between
      // them ("50/50") or a multiplier ("5x"), never letters ("5ish").
      let rest = core
      for (const span of spans) {
        const from = Math.max(span.start - at, 0)
        const to = Math.min(span.end - at, core.length)
        if (to > from) {
          rest = `${rest.slice(0, from)}${" ".repeat(to - from)}${rest.slice(to)}`
        }
      }
      if (!/^[\s/.,x×%-]*$/u.test(rest)) found.push(core)
    } else if (/illions?$/i.test(core) && numberWords(core).length === 0) {
      found.push(core)
    }
  }
  return found
}

/** The text with every link this turn's output named whole blanked. */
function withoutSourcedLinks(text: string, set: SourcedSet): string {
  let rest = text
  for (const read of linkReads(text)) {
    if (read.defanged) continue
    const key = linkKey(read.text)
    if (key !== null && set.links.has(key)) {
      rest = rest.split(read.text).join(" ")
    }
  }
  return rest
}

export function unsourcedTokens(text: string, set: SourcedSet): string[] {
  const named = withoutNames(withoutSourcedLinks(text, set), set)
  // Dates first, each as a whole: one the results do not state is
  // unsourced even when each of its numbers is.
  const missingDates: string[] = []
  let undated = named
  for (const span of dateSpans(named).reverse()) {
    if (!dateIsKnown(span, set.dates)) missingDates.unshift(span.text)
    undated = `${undated.slice(0, span.start)} ${undated.slice(span.end)}`
  }
  const spans = numberSpans(undated)
  // Digits with their scale are one number: "3 thousand" is not also
  // "thousand" in words.
  const wordsOnly = blanked(undated, spans)
  const joined = joinedNameWords(set)
  const missingWords = numberWords(wordsOnly)
    .filter((each) => {
      if (inJoinedName(wordsOnly, each, joined)) return false
      const amount = amountAt(
        wordsOnly,
        each.index,
        each.index + each.text.length,
      )
      return !numberKnown(set, each.value, amount)
    })
    .map((each) => each.text)
  const missingNumbers = spans
    .filter((span) => !spanKnown(set, span, undated))
    .map((span) => span.value)
  const unread = unreadAmounts(undated, spans)
  const missingAddresses = sentencesOf(text).flatMap((sentence) => {
    const echoCounts =
      ECHO_RULE === "amounts" && !FUND_IMPERATIVE.test(sentence)
    return addressTokens(sentence).filter(
      (token) =>
        !addressIsKnown(token, set.addresses) &&
        !(echoCounts && addressIsKnown(token, set.echo.addresses)),
    )
  })
  return [
    ...missingDates,
    ...missingWords,
    ...missingNumbers,
    ...unread,
    ...missingAddresses,
  ]
}

/** Whether the text is part of a name this turn's results hold, exactly. */
function inName(text: string, set: SourcedSet): boolean {
  if (set.user.text.includes(text.toLowerCase())) return false
  for (const name of [...set.textNames, ...set.names]) {
    if (name.includes(text)) return true
  }
  return false
}

/**
 * Links and domains a model sentence may not show. A link passes only
 * when it is https (or written without a scheme), holds no "@" or
 * backslash, is on the project's or Mezo's own domains, names a host this
 * turn's tool output named, and, if it has a path, is a link the output
 * named whole. Defanged links ("mezo-claim[.]xyz", "hxxp://") and bare
 * schemes ("javascript:") never pass. A dotted word under a top-level
 * domain not on the known list that a result's name holds exactly
 * ("Lavender.Five") is that name, not a link.
 */
export function unsourcedLinks(text: string, set: SourcedSet): string[] {
  return linkReads(text)
    .filter((read) => {
      if (read.defanged) return true
      const parsed = parseLink(read.text)
      if (parsed === null) return true
      if (parsed.scheme !== null && parsed.scheme !== "https") return true
      if (!ownHost(parsed.host) || !set.hosts.has(parsed.host)) {
        return knownTld(read.text) || !inName(read.text, set)
      }
      return (
        parsed.rest !== "" && !set.links.has(`${parsed.host}${parsed.rest}`)
      )
    })
    .map((read) => read.text)
}

/** Figures a passive verb may be about (sourcedClaims.ts): independent only. */
function claimFigures(set: SourcedSet): ClaimFigures {
  const undated = (text: string) => {
    let rest = withoutNames(text, set)
    for (const span of dateSpans(rest).reverse()) {
      rest = `${rest.slice(0, span.start)} ${rest.slice(span.end)}`
    }
    return rest
  }
  return {
    amount: (text) => {
      const rest = undated(text)
      // The token may follow a word or two later: "9,658.43 claimed MUSD".
      const near = (start: number, end: number) => {
        const skip = /^(?:\s+[a-z][\w'’-]*){0,2}/.exec(
          rest.slice(end, end + AFTER_WINDOW),
        )
        return (
          amountAt(rest, start, end) ||
          amountAt(rest, start, end + (skip?.[0].length ?? 0))
        )
      }
      return (
        numberSpans(rest).some(
          (span) => near(span.start, span.end) && set.numbers.has(span.value),
        ) ||
        numberWords(rest).some(
          (each) =>
            near(each.index, each.index + each.text.length) &&
            set.numbers.has(each.value),
        )
      )
    },
    address: (text) =>
      addressTokens(text).some((token) => addressIsKnown(token, set.addresses)),
    place: (text) => {
      const plain = text
        .replace(/^\s*(?:(?:the|a|an|its|their|this|that)\s+)*/i, "")
        .toLowerCase()
      return [...set.textNames, ...set.symbols, ...set.names].some(
        (name) =>
          name.trim().length >= 2 &&
          plain.startsWith(name.trim().toLowerCase()),
      )
    },
  }
}

/** Whether the text claims Stuart acted (sourcedClaims.ts). */
export function claimsToHaveActed(text: string, set: SourcedSet): boolean {
  return claimsIn(text, claimFigures(set))
}

const GREETING =
  /^\s*(hi|hello|hey|sure|great|certainly|of course|absolutely|happy to|i'd be happy|thanks)\b/i

export type ModelAnswerCheck =
  | { ok: true }
  | {
      ok: false
      reason:
        | "empty"
        | "too_many_sentences"
        | "too_long"
        | "greeting"
        | "claim"
        | "instruction"
        | "unsourced"
      detail: string[]
    }

/** Answer limits: two short sentences, three (400 chars) for Mezo support. */
export type AnswerLimits = { sentences: number; chars: number }

export const DEFAULT_LIMITS: AnswerLimits = { sentences: 2, chars: 280 }
export const SUPPORT_LIMITS: AnswerLimits = { sentences: 3, chars: 400 }

/**
 * The text with names, dates and addresses blanked: what is left is read
 * for figures in disguise (disguisedFigures).
 */
function disguiseCheckText(text: string): string {
  let rest = text.replace(ADDRESS_PATTERN, " ")
  for (const span of dateSpans(rest).reverse()) {
    rest = `${rest.slice(0, span.start)} ${rest.slice(span.end)}`
  }
  return rest
}

export function checkModelAnswer(
  text: string,
  sourced: SourcedSet,
  limits: AnswerLimits = DEFAULT_LIMITS,
  options: {
    /**
     * The sentence as the model wrote it, before semicolons became commas
     * for display: a semicolon still ends a sentence for the limit.
     */
    written?: string
    /** A tool's own template, reused: no length limit, every other check. */
    lengthExempt?: boolean
  } = {},
): ModelAnswerCheck {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, reason: "empty", detail: [] }
  const sentences = sentencesOf(options.written ?? trimmed)
  if (!options.lengthExempt && sentences.length > limits.sentences) {
    return {
      ok: false,
      reason: "too_many_sentences",
      detail: [`${sentences.length}`],
    }
  }
  if (!options.lengthExempt && trimmed.length > limits.chars) {
    return { ok: false, reason: "too_long", detail: [`${trimmed.length}`] }
  }
  // Characters that hide or fake a figure: never shown in Stuart's voice.
  const hidden = hiddenText(trimmed)
  if (hidden.length > 0) {
    return { ok: false, reason: "unsourced", detail: hidden }
  }
  // Read in one plain form: "ｆｉｖｅ" is "five".
  const plain = plainText(trimmed)
  const disguised = disguisedFigures(
    disguiseCheckText(withoutSourcedLinks(plain, sourced)),
    [...sourced.names, ...sourced.textNames],
  )
  if (disguised.length > 0) {
    return { ok: false, reason: "unsourced", detail: disguised }
  }
  if (GREETING.test(plain)) return { ok: false, reason: "greeting", detail: [] }
  if (claimsToHaveActed(plain, sourced)) {
    return { ok: false, reason: "claim", detail: [] }
  }
  const instructions = plainInstructions(plain, sourced.own, {
    prepared: sourced.prepared,
  })
  if (instructions.length > 0) {
    return { ok: false, reason: "instruction", detail: instructions }
  }
  const missing = [
    ...unsourcedTokens(plain, sourced),
    ...unsourcedLinks(plain, sourced),
  ]
  if (missing.length > 0) {
    return { ok: false, reason: "unsourced", detail: missing }
  }
  return { ok: true }
}

export type SourcedViolation = {
  kind:
    | "answer_number"
    | "why_number"
    | "fact_evidence"
    | "block_evidence"
    | "answer_evidence"
    | "result_without_evidence"
  detail: string
}

/**
 * The invariant every response passes before it leaves the Worker. Template
 * answers may only print numbers held by the facts they reference.
 */
export function sourcedViolations(
  response: StuartResponse,
  turnSet: SourcedSet,
): SourcedViolation[] {
  const violations: SourcedViolation[] = []
  const evidenceIds = new Set(response.evidence.map((item) => item.id))
  const factsById = new Map(response.facts.map((fact) => [fact.id, fact]))

  for (const fact of response.facts) {
    for (const ref of fact.evidenceRefs) {
      if (!evidenceIds.has(ref)) {
        violations.push({ kind: "fact_evidence", detail: `${fact.id}:${ref}` })
      }
    }
  }
  for (const block of response.uiBlocks) {
    for (const ref of block.evidenceRefs) {
      if (!evidenceIds.has(ref)) {
        violations.push({
          kind: "block_evidence",
          detail: `${block.id}:${ref}`,
        })
      }
    }
  }
  for (const ref of response.answer.evidenceRefs) {
    if (!evidenceIds.has(ref)) {
      violations.push({ kind: "answer_evidence", detail: ref })
    }
  }
  if (response.answer.kind === "result" && response.evidence.length === 0) {
    violations.push({ kind: "result_without_evidence", detail: "" })
  }

  function referencedSet(refs: readonly string[]): SourcedSet {
    const set = emptySourcedSet()
    const facts = refs.flatMap((ref) => {
      const fact = factsById.get(ref)
      return fact ? [fact] : []
    })
    for (const fact of facts) addText(set, fact.display)
    addAddresses(set, [response.wallet.address])
    return set
  }

  // Model answers are held to everything the turn's tools returned (facts and
  // structured row values); template answers to the facts they reference.
  const answerSet =
    response.answer.origin === "model"
      ? turnSet
      : referencedSet(response.answer.factRefs)
  for (const token of unsourcedTokens(response.answer.text, answerSet)) {
    violations.push({ kind: "answer_number", detail: token })
  }
  for (const item of response.why?.items ?? []) {
    const set = referencedSet(item.factRefs)
    for (const token of unsourcedTokens(item.text, set)) {
      violations.push({ kind: "why_number", detail: token })
    }
  }
  return violations
}
