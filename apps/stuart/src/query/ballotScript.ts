import { percentToBps } from "@matchbox/domain/voteMath"
import type { VoteBranch } from "@matchbox/stuart-ui/contract"

// Vote scripts: a pasted governance post ("25% to the BTC/MUSD-200 pool, 20%
// to the MUSD Savings Vault, ...") turned into ballot lines, and each line's
// name resolved to a live gauge by code, never by the model. A name that
// matches nothing, or more than one gauge, stays unresolved and is shown to
// the user; nothing is guessed and no address is made up.

export type ScriptLine = {
  /** 0-based position in the script. */
  index: number
  /** The line as written, trimmed: "25% to the BTC/MUSD-200 pool". */
  raw: string
  /** The name part: "the BTC/MUSD-200 pool". */
  target: string
  percent: string
  /** Basis points; null when the percent is not a valid 0 to 100. */
  bps: number | null
  /** Written "N% to X" (or "on", "for", ":"), not "N% X". */
  linked: boolean
}

export type ParsedScript = {
  lines: ScriptLine[]
  /** The escrow the post says it votes with, when it says. */
  asset: "veBTC" | "veMEZO" | null
  /** "Keep the same MEZO gauge votes as last epoch." */
  keepMezoGauges: boolean
}

/** One votable gauge, as the resolver sees it. */
export type DirectoryEntry = {
  branch: VoteBranch
  /** Lower case vote target (the pool for PoolsVoter, else the gauge). */
  target: string
  /** Lower case gauge address. */
  gauge: string
  /** Name without the pool type: "BTC/MUSD", "sMUSD", "Boar". */
  name: string
  /** "CL200", "Volatile", "Stable", "CL"; null for non-pair gauges. */
  label: string | null
  /** veBTC gauges: the boosted lock's token id. */
  tokenId: string | null
  isAlive: boolean
}

export type Resolution =
  | { kind: "match"; entry: DirectoryEntry }
  | { kind: "ambiguous"; options: DirectoryEntry[] }
  | {
      kind: "none"
      /** Why: what was looked for, in a few words ("no BTC/MUSD CL300"). */
      reason: string
      /** Close gauges the user may have meant; never chosen for them. */
      options: DirectoryEntry[]
    }

const PERCENT = String.raw`(\d{1,3}(?:\.\d{1,2})?)\s*%`
const LINK = "(?:to|on|for|into|->|=>|:)?"

/**
 * Splits a post into its "N% to X" lines. Works on the post as typed or
 * pasted: one line each, separated by commas or semicolons, or run
 * together by an input that dropped the newlines ("...pool20% to the...").
 */
export function parseBallotScript(text: string): ParsedScript {
  const lower = text.toLowerCase()
  const lines: ScriptLine[] = []
  // Each allocation starts at a percent that is not part of a longer number
  // or a name ("-200", "CL200"), and runs to the next allocation.
  const starts = [
    ...text.matchAll(
      new RegExp(
        String.raw`(?<!\d\.)(?<![\d\-/A-Za-z])${PERCENT}\s*${LINK}\s*`,
        "g",
      ),
    ),
  ]
  // "Pool20% to": a percent glued to the end of the previous name.
  const glued = [
    ...text.matchAll(
      new RegExp(
        String.raw`(?<=[a-z])${PERCENT}\s*(?:to|on|for|into)\s+`,
        "gi",
      ),
    ),
  ]
  const all = [...starts, ...glued]
    .filter((match) => match.index !== undefined)
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .filter(
      (match, index, list) =>
        index === 0 || match.index !== list[index - 1]?.index,
    )
  all.forEach((match, position) => {
    const start = (match.index ?? 0) + match[0].length
    const next = all[position + 1]?.index ?? text.length
    let target = text.slice(start, next)
    // A name ends at a line break, a list separator or a sentence end.
    // " | " is how Stuart's inputs keep pasted lines apart.
    target = (target.split(/\r?\n|;|\||,(?=\s*\d)|\.(?=\s+[A-Z])/)[0] ?? "")
      .replace(/\b(?:and|plus)\s*$/i, "")
      .replace(/[\s.,;:!?]+$/, "")
      .trim()
    // A trailing sentence that is not part of the name ("... pool. We
    // are"), glued on when an input dropped the newline ("poolWe are"),
    // and the lock it votes with ("sMUSD with my veBTC").
    target = target
      .replace(/\.\s.*$/, "")
      .replace(/\b(pool|vault|gauge|validator)(?=[A-Z][a-z]).*$/, "$1")
      .replace(
        /\s+(?:with|using|from)\s+(?:my|our|the|all)?\s*(?:vebtc|vemezo|locks?)\b.*$/i,
        "",
      )
      .trim()
    const percent = match[1] ?? ""
    if (target === "") return
    lines.push({
      index: lines.length,
      raw: `${percent}% to ${target}`,
      target: target.slice(0, 80),
      percent,
      bps: percentToBps(percent),
      linked: /%\s*(?:to|on|for|into|->|=>|:)/i.test(match[0]),
    })
  })
  // "veBTC #98" names a gauge, not the lock that votes.
  const vebtc =
    /\bvebtc\b(?!\s*#)|\blocked btc\b|\bbtc locks?\b|\bbtc lock\b/.test(lower)
  const vemezoVoting =
    /\b(?:with|using|from) (?:my |our |the |all )?vemezo\b|\bvemezo (?:votes?|ballot)\b/.test(
      lower,
    )
  return {
    lines,
    asset: vebtc ? "veBTC" : vemezoVoting ? "veMEZO" : null,
    keepMezoGauges:
      /\bmezo gauges?\b/.test(lower) &&
      /\b(?:same|unchanged|keep|carry|previous|last) /.test(lower) &&
      /\b(?:epoch|votes?)\b/.test(lower),
  }
}

// ---------------------------------------------------------------------------
// Name resolution

// Mezo's bridged tokens and the names posts give them ("USDC" for mUSDC).
// Only these: an "m" in front of any other symbol is a different token
// ("USD" is not MUSD).
const BRIDGED: Readonly<Record<string, string>> = {
  musdc: "usdc",
  musdt: "usdt",
  msolvbtc: "solvbtc",
  mxsolvbtc: "xsolvbtc",
  mcbbtc: "cbbtc",
}

/** Token symbols match ignoring case and a bridged token's "m" prefix. */
export function sameToken(left: string, right: string): boolean {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  return a === b || BRIDGED[a] === b || BRIDGED[b] === a
}

function samePair(
  left: readonly [string, string],
  right: readonly [string, string],
): boolean {
  return (
    (sameToken(left[0], right[0]) && sameToken(left[1], right[1])) ||
    (sameToken(left[0], right[1]) && sameToken(left[1], right[0]))
  )
}

const TOKEN = "[a-z0-9.]+"

/** "BTC/MUSD" as a pair; null for any other name. */
export function pairOf(name: string): [string, string] | null {
  const match = new RegExp(`^(${TOKEN})\\s*/\\s*(${TOKEN})$`, "i").exec(
    name.trim(),
  )
  return match ? [match[1] ?? "", match[2] ?? ""] : null
}

type PoolKind =
  | { kind: "cl"; spacing: number | null }
  | { kind: "volatile" }
  | { kind: "stable" }
  | { kind: "basic" }

type Wanted =
  | { kind: "address"; address: string }
  | { kind: "pair"; pair: [string, string]; pool: PoolKind; text: string }
  | { kind: "savings" }
  | { kind: "vault"; words: string[]; text: string }
  | { kind: "name"; text: string }

const FILLER =
  /^(?:the|a|an|new|our|my)\s+|\s+(?:gauges?|pools?|validators?|lp|liquidity pool)$/gi

function stripFiller(text: string): string {
  let out = text.trim()
  for (let pass = 0; pass < 4; pass += 1) {
    const next = out.replace(FILLER, "").trim()
    if (next === out) break
    out = next
  }
  return out
}

/** What a script line names: an address, a pair pool, a vault or a name. */
export function wantedFor(text: string): Wanted {
  const cleaned = stripFiller(
    text.replace(/[()[\]]/g, " ").replace(/\s+/g, " "),
  )
  const address = /^0x[0-9a-f]{40}$/i.exec(cleaned)?.[0]
  if (address) return { kind: "address", address: address.toLowerCase() }
  const pair = new RegExp(
    `^(${TOKEN})\\s*/\\s*(${TOKEN}?)(?:\\s*[-\\s]\\s*(.*))?$`,
    "i",
  ).exec(cleaned)
  if (pair) {
    const rest = (pair[3] ?? "").toLowerCase().trim()
    // The second token may carry the spacing: "musd-200" is split above;
    // "musd200" is not a token Matchbox lists.
    let second = pair[2] ?? ""
    let restText = rest
    const tail = /^([a-z.]+?)(?:-)?(cl)?(\d+)$/i.exec(second)
    if (tail && restText === "" && /[a-z]/i.test(tail[1] ?? "")) {
      second = tail[1] ?? second
      restText = `${tail[2] ?? ""}${tail[3] ?? ""}`
    }
    const spacing = /(?:^|\s|-)(?:cl\s*-?\s*)?(\d{1,5})\b/.exec(restText)?.[1]
    const pool: PoolKind = /\bvolatile\b|\bvamm\b/.test(restText)
      ? { kind: "volatile" }
      : /\bstable\b|\bsamm\b/.test(restText)
        ? { kind: "stable" }
        : spacing !== undefined
          ? { kind: "cl", spacing: Number(spacing) }
          : /\bcl\b|\bconcentrated\b/.test(restText)
            ? { kind: "cl", spacing: null }
            : { kind: "basic" }
    return {
      kind: "pair",
      pair: [pair[1] ?? "", second],
      pool,
      text: cleaned,
    }
  }
  const lower = cleaned.toLowerCase()
  if (
    /^s?musd savings(?: vault| rate)?$|^savings vault$|^smusd(?: vault)?$|^musd vault$/.test(
      lower,
    )
  ) {
    return { kind: "savings" }
  }
  if (/\bvault\b/.test(lower)) {
    return {
      kind: "vault",
      words: lower
        .split(/[\s\-/]+/)
        .filter(
          (word) =>
            word !== "" &&
            !["vault", "lending", "the", "new", "a", "an"].includes(word),
        ),
      text: cleaned,
    }
  }
  return { kind: "name", text: cleaned }
}

function labelMatches(label: string | null, pool: PoolKind): boolean {
  switch (pool.kind) {
    case "volatile":
      return label === "Volatile"
    case "stable":
      return label === "Stable"
    case "basic":
      return label === "Volatile" || label === "Stable"
    case "cl":
      return pool.spacing === null
        ? label?.startsWith("CL") === true
        : label === `CL${pool.spacing}`
  }
}

function poolText(pair: [string, string], pool: PoolKind): string {
  const name = `${pair[0].toUpperCase()}/${pair[1].toUpperCase()}`
  switch (pool.kind) {
    case "cl":
      return pool.spacing === null ? `${name} CL` : `${name} CL${pool.spacing}`
    case "volatile":
      return `${name} Volatile`
    case "stable":
      return `${name} Stable`
    case "basic":
      return `${name} Volatile or Stable`
  }
}

function pick(found: DirectoryEntry[], none: Resolution): Resolution {
  if (found.length === 1 && found[0]) return { kind: "match", entry: found[0] }
  if (found.length > 1) return { kind: "ambiguous", options: found }
  return none
}

/** The gauge a script line names, by code. */
export function resolveGaugeName(
  text: string,
  entries: readonly DirectoryEntry[],
): Resolution {
  const alive = entries.filter((entry) => entry.isAlive)
  const wanted = wantedFor(text)
  switch (wanted.kind) {
    case "address": {
      const found = entries.filter(
        (entry) =>
          entry.target === wanted.address || entry.gauge === wanted.address,
      )
      const live = found.filter((entry) => entry.isAlive)
      return pick(live, {
        kind: "none",
        reason: found.length
          ? "gauge is not alive"
          : "no gauge at that address",
        options: [],
      })
    }
    case "pair": {
      const sharing = alive.filter((entry) => {
        const pair = pairOf(entry.name)
        return pair !== null && samePair(pair, wanted.pair)
      })
      const typed = sharing.filter((entry) =>
        labelMatches(entry.label, wanted.pool),
      )
      // A pair named with no pool type ("tBTC / WBTC" on a veBTC gauge)
      // matches only when no gauge of that pair has a type.
      if (
        wanted.pool.kind === "basic" &&
        sharing.length > 0 &&
        sharing.every((entry) => entry.label === null)
      ) {
        return pick(sharing, { kind: "none", reason: "", options: [] })
      }
      // "BTC/MUSD pool" with no type while concentrated pools of the pair
      // exist too: the post may mean any of them, so ask.
      if (
        wanted.pool.kind === "basic" &&
        sharing.some((entry) => entry.label?.startsWith("CL") === true)
      ) {
        return {
          kind: "ambiguous",
          options: [
            ...typed,
            ...sharing.filter((entry) => !typed.includes(entry)),
          ],
        }
      }
      return pick(typed, {
        kind: "none",
        reason: `no live ${poolText(wanted.pair, wanted.pool)} gauge`,
        options: sharing,
      })
    }
    case "savings": {
      const found = alive.filter(
        (entry) => entry.label === null && /^smusd$/i.test(entry.name.trim()),
      )
      return pick(found, {
        kind: "none",
        reason: "no live sMUSD gauge",
        options: [],
      })
    }
    case "vault": {
      const exact = alive.filter(
        (entry) =>
          entry.name.trim().toLowerCase() === wanted.text.toLowerCase(),
      )
      if (exact.length > 0) {
        return pick(exact, { kind: "none", reason: "", options: [] })
      }
      // Not listed: offer the vault-like gauges that hold one of its tokens,
      // and let the user choose. Never picked for them.
      const options = alive.filter(
        (entry) =>
          entry.branch === "pools" &&
          entry.label === null &&
          wanted.words.some((word) =>
            entry.name
              .toLowerCase()
              .split(/[\s\-/]+/)
              .some((part) => sameToken(part, word)),
          ),
      )
      return {
        kind: "none",
        reason: "not in the live gauge directory",
        options,
      }
    }
    case "name": {
      const needle = wanted.text.toLowerCase()
      const tokenId = /^(?:vebtc\s*)?#\s?(\d+)$/.exec(needle)?.[1]
      if (tokenId) {
        return pick(
          alive.filter((entry) => entry.tokenId === tokenId),
          {
            kind: "none",
            reason: `no live veBTC #${tokenId} gauge`,
            options: [],
          },
        )
      }
      const full = (entry: DirectoryEntry) =>
        (entry.label ? `${entry.name} ${entry.label}` : entry.name)
          .trim()
          .toLowerCase()
      const exact = alive.filter(
        (entry) =>
          entry.name.trim().toLowerCase() === needle || full(entry) === needle,
      )
      if (exact.length > 0) {
        return pick(exact, { kind: "none", reason: "", options: [] })
      }
      // A whole-word match ("Club" in "Millennium Club") is only offered:
      // the line stays open until the user picks it.
      const words = alive.filter((entry) =>
        new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`, "i").test(
          entry.name,
        ),
      )
      const dead = entries.some(
        (entry) => !entry.isAlive && entry.name.trim().toLowerCase() === needle,
      )
      return {
        kind: "none",
        reason: dead ? "gauge is not alive" : "no live gauge by that name",
        options: words.slice(0, 6),
      }
    }
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** "BTC/MUSD CL200": the name as Pro and Matchscan show it. */
export function entryLabel(entry: DirectoryEntry): string {
  return entry.label ? `${entry.name} ${entry.label}` : entry.name
}

export type ResolvedLine = ScriptLine & { resolution: Resolution }

/**
 * Resolves every line. `picks` are the user's answers to earlier cards, by
 * line index; a pick counts only when it is one of that line's options.
 */
export function resolveScript(
  lines: readonly ScriptLine[],
  entries: readonly DirectoryEntry[],
  picks: ReadonlyMap<number, string>,
): ResolvedLine[] {
  return lines.map((line) => {
    const resolution = resolveGaugeName(line.target, entries)
    const picked = picks.get(line.index)
    if (picked !== undefined && resolution.kind !== "match") {
      const entry = pickedOption(resolution.options, picked)
      if (entry) return { ...line, resolution: { kind: "match", entry } }
    }
    return { ...line, resolution }
  })
}

/** At most this many options on a card. */
export const CARD_OPTIONS = 6

/**
 * The options a card shows for a line: two or more candidates, the first
 * six. A line with one suggestion gets no card, so nothing can be picked
 * for it.
 */
export function cardOptions(
  options: readonly DirectoryEntry[],
): DirectoryEntry[] {
  return options.length >= 2 ? options.slice(0, CARD_OPTIONS) : []
}

/** The one shown option a pick names (by address or address prefix). */
function pickedOption(
  options: readonly DirectoryEntry[],
  picked: string,
): DirectoryEntry | null {
  const found = cardOptions(options).filter((option) =>
    option.target.startsWith(picked),
  )
  return found.length === 1 ? (found[0] ?? null) : null
}

// ---------------------------------------------------------------------------
// Picks: a card's answers travel with the script it re-sends, so a second
// pick never undoes the first. The query carries every earlier pick after
// the script, each as its line and the first eight hex digits of the
// gauge it picked ("... | picks: 3=0x52e604c4, 5=0x9cbc1537"); a pick
// counts only when it names exactly one of the options that line's card
// showed. The card's option id is the new pick, in full ("5=0x9cbc...").

const PICKS = /\s*\|\s*picks:\s*((?:\d{1,2}=0x[0-9a-fA-F]{8,40}[,\s]*)+)$/
const PICK = /^(\d{1,2})=(0x[0-9a-fA-F]{8,40})$/
const PREFIX = 10

/** The longest request Stuart takes, which a card's query must fit. */
export const MAX_QUERY = 2_000

/** The script without its picks trailer, and the picks it carried. */
export function splitPicks(text: string): {
  script: string
  picks: Map<number, string>
} {
  const found = PICKS.exec(text)
  const picks = new Map<number, string>()
  if (!found) return { script: text, picks }
  for (const each of (found[1] ?? "").split(/[,\s]+/)) {
    const pick = PICK.exec(each.trim())
    if (pick) picks.set(Number(pick[1]), (pick[2] ?? "").toLowerCase())
  }
  return { script: text.slice(0, found.index), picks }
}

/** One card option's id: the line index and the gauge picked for it. */
export function pickId(index: number, target: string): string {
  return `${index}=${target.toLowerCase()}`
}

export function parsePick(id: string | null): [number, string] | null {
  const pick = id === null ? null : PICK.exec(id.trim())
  return pick ? [Number(pick[1]), (pick[2] ?? "").toLowerCase()] : null
}

/** The script with its picks, as a card re-sends it. */
export function withPicks(
  script: string,
  picks: ReadonlyMap<number, string>,
): string {
  if (picks.size === 0) return script
  const list = [...picks.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, target]) => pickId(index, target.slice(0, PREFIX)))
    .join(", ")
  return `${script} | picks: ${list}`
}

/**
 * Whether a card for `script` fits in a request with every pick so far
 * and the one the card will add. Picks are never cut off: when they would
 * be, Stuart says the post is too long instead of showing a card.
 */
export function picksFit(
  script: string,
  picks: ReadonlyMap<number, string>,
  nextLine: number,
): boolean {
  const next = new Map(picks)
  next.set(nextLine, `0x${"0".repeat(40)}`)
  return withPicks(script, next).length <= MAX_QUERY
}
