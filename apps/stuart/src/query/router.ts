import type {
  ClarificationCardId,
  Intent,
  VoteBranch,
} from "@matchbox/stuart-ui/contract"
import { parseBallotScript } from "./ballotScript"
import { searchMezoKnowledge } from "./knowledge/mezo"
import { KNOWN_ENTITIES } from "./subjects"
import { periodOf } from "./tools/chainCommon"
import type { ProtocolTopic } from "./tools/protocol"

// Deterministic intent router. It runs before Claude at zero token cost and
// handles every request it recognises with confidence. Ambiguous requests
// become clarification cards and never reach a write tool.

export type QuerySlots = {
  amountUsd: string | null
  amount: string | null
  fundingAsset: "MEZO" | "MUSD" | "BTC" | null
  destination: "musd-savings" | "lp-pool" | null
  branch: VoteBranch | null
  veBTCOnly: boolean
  window: 4 | 8 | 12 | null
  shockPercent: number | null
  repayAmount: string | null
  allocations: Array<{ target: string; percent: string }> | null
  invalidAllocation: boolean
  direction: "in" | "out" | null
}

export type RouterDecision =
  | { kind: "tool"; intent: Intent; tool: string; input: unknown }
  | { kind: "clarify"; cardId: ClarificationCardId; slots: QuerySlots }
  | { kind: "navigate"; to: string; label: string }
  // `help`: a how-to or troubleshooting question the model should answer
  // with mezo_knowledge (the knowledge search answers when there is no model).
  | { kind: "none"; help: boolean }

const PERSONAL =
  /\b(optimi[sz]e|for me|my votes?|my ballot|best return|personal return|what should i vote|how should i vote|vote this epoch for me)\b/

function match(pattern: RegExp, text: string): string | null {
  return pattern.exec(text)?.[1] ?? null
}

function parseAllocations(query: string): {
  allocations: Array<{ target: string; percent: string }> | null
  invalid: boolean
} {
  const segments = query
    .replace(/^.*?\b(vote|ballot|allocate)\b[^\d]*?(?=\d)/i, "")
    .split(/,|;|\band\b(?=\s*\d)|\n/i)
  const allocations: Array<{ target: string; percent: string }> = []
  let invalid = false
  for (const segment of segments) {
    const found = /(\d+(?:\.\d+)?)\s*%\s*(?:to|on|for|into)?\s*(.+)$/i.exec(
      segment.trim(),
    )
    if (!found) continue
    const percent = found[1] ?? ""
    const target = (found[2] ?? "").trim().replace(/[.!?]+$/, "")
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(percent) || !target) {
      invalid = true
      continue
    }
    allocations.push({ target: target.slice(0, 80), percent })
  }
  return { allocations: allocations.length ? allocations : null, invalid }
}

export function extractSlots(query: string): QuerySlots {
  const text = query.toLowerCase()
  const usd = match(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/, text)
  const tokenAmount = /(\d[\d,]*(?:\.\d+)?)\s*(mezo|musd|btc)\b/.exec(
    text.replace(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g, " "),
  )
  const assetWord = match(
    /\b(mezo|musd|btc)\b/,
    text.replace(/\bmezo\s*\/\s*musd\b|\bbtc\s*\/\s*musd\b/g, " "),
  )
  const fundingAsset = (tokenAmount?.[2] ?? assetWord)?.toUpperCase() ?? null
  const lp = /\b(lp|liquidity)\b|\bpool\b|(mezo|btc)\s*\/\s*musd\s+pool/.test(
    text,
  )
  const savings =
    /\b(savings|smusd|musd vault|musd savings)\b/.test(text) &&
    !/\b(mezo|btc)\s*\/\s*musd\b/.test(text)
  const windowText = match(/\b(4|8|12)\s*(?:completed\s+)?epochs?\b/, text)
  const shock =
    match(
      /\b(?:falls?|drops?|dips?|crash(?:es)?|declines?|down|loses?)\s*(?:by\s*)?(\d{1,2})\s*%/,
      text,
    ) ?? match(/\bbtc\s*[-−]\s*(\d{1,2})\s*%/, text)
  const repay = match(/\brepay\w*\s+(max|\$?\d[\d,]*(?:\.\d{1,18})?)/, text)
  const parsed = parseAllocations(query)
  const validators = /\bvalidators?\b/.test(text)
  // "Which pool pays the most", "my pool votes", "vaults": PoolsVoter.
  const pools = /\b(pools?|vaults?|lp)\b/.test(text)
  return {
    amountUsd: usd,
    amount: tokenAmount ? (tokenAmount[1] ?? null) : null,
    fundingAsset:
      fundingAsset === "MEZO" ||
      fundingAsset === "MUSD" ||
      fundingAsset === "BTC"
        ? fundingAsset
        : null,
    destination: lp ? "lp-pool" : savings ? "musd-savings" : null,
    branch: validators ? "validators" : pools ? "pools" : null,
    veBTCOnly: /\bvebtc\b/.test(text) && !validators && !pools,
    window:
      windowText === "4"
        ? 4
        : windowText === "12"
          ? 12
          : windowText === "8"
            ? 8
            : null,
    shockPercent: shock ? Number.parseInt(shock, 10) : null,
    repayAmount: repay ? repay.replace(/^\$/, "") : null,
    allocations: parsed.allocations,
    invalidAllocation: parsed.invalid,
    direction: /\b(into|to) mezo\b/.test(text)
      ? "in"
      : /\b(out of|from) mezo\b/.test(text)
        ? "out"
        : null,
  }
}

const PAGES: Record<string, { to: string; label: string }> = {
  overview: { to: "/", label: "Overview" },
  home: { to: "/", label: "Overview" },
  vote: { to: "/vote", label: "Vote" },
  voting: { to: "/vote", label: "Vote" },
  rewards: { to: "/rewards", label: "Rewards" },
  activity: { to: "/activity", label: "Activity" },
}

export function zapDecision(slots: QuerySlots): RouterDecision {
  if (slots.destination === "lp-pool") {
    return {
      kind: "tool",
      intent: "zap",
      tool: "prepare_zap",
      input: {
        fundingAsset: slots.fundingAsset ?? "MEZO",
        amount: slots.amount,
        amountUsd: slots.amountUsd,
        destination: "lp-pool",
        slippageBps: null,
      },
    }
  }
  if (slots.destination === null) {
    return { kind: "clarify", cardId: "earn-destination", slots }
  }
  if (slots.amount === null && slots.amountUsd === null) {
    return { kind: "clarify", cardId: "zap-amount", slots }
  }
  if (slots.fundingAsset === null) {
    return { kind: "clarify", cardId: "funding-asset", slots }
  }
  return {
    kind: "tool",
    intent: slots.fundingAsset === "MUSD" ? "earn_deposit" : "zap",
    tool: "prepare_zap",
    input: {
      fundingAsset: slots.fundingAsset,
      amount: slots.amount,
      amountUsd: slots.amountUsd,
      destination: slots.destination,
      slippageBps: null,
    },
  }
}

const METRIC = "(?:apy|apr|yield|returns?)"
const OTHER_METRIC = "(?:boost|incentives?|bribes?|votes?|weight)"
const NAME = String.raw`(?:the\s+)?(.+?)(?:'s)?`
const KIND = String.raw`(?:\s+(?:gauge|validator|pool|vault))?`
const NOW = String.raw`(?:\s+(?:right now|now|currently|this epoch|today))?`

function explainPattern(source: string): RegExp {
  return new RegExp(source, "i")
}

// Gauge explanations ("Why is Stackbridge APY down?", "what happened to SNF
// incentives", "explain Lombard"). The name is resolved by explain_gauge
// against live targets; an unknown name gets an honest "no match".
const EXPLAIN_PATTERNS: Array<{
  pattern: RegExp
  question: "overview" | "apy_change" | "not_selected"
}> = [
  {
    pattern: explainPattern(
      String.raw`\bwhy (?:is|did|has|does|was) ${NAME}\s+${METRIC}\s+(?:been\s+)?(?:down|up|lower|higher|drop(?:ping|ped)?|fall(?:ing|en)?|fell|ris(?:e|en|ing)|rose|chang(?:e|ed|ing)|move[ds]?|so\s+\w+)\b`,
    ),
    question: "apy_change",
  },
  {
    pattern: explainPattern(
      String.raw`\bwhy (?:does|do|did|is) ${NAME}\s+(?:have|get|pay|earn)s?\s+(?:a\s+|so\s+)?(?:lower|higher|less|more|little|much|low|high)\b`,
    ),
    question: "apy_change",
  },
  {
    pattern: explainPattern(
      String.raw`\bwhy (?:isn't|is not|wasn't|was not|didn't|did not) ${NAME}\s+(?:in my (?:ballot|votes?|allocation)|(?:get\s+)?(?:selected|picked|chosen))\b`,
    ),
    question: "not_selected",
  },
  {
    pattern: explainPattern(
      String.raw`^what(?:'s| has| is)?\s+happen(?:ed|ing)\s+(?:to|with)\s+${NAME}\s+${METRIC}\b`,
    ),
    question: "apy_change",
  },
  {
    pattern: explainPattern(
      String.raw`^what(?:'s| has| is)?\s+happen(?:ed|ing)\s+(?:to|with)\s+${NAME}\s+${OTHER_METRIC}\b`,
    ),
    question: "overview",
  },
  {
    pattern: explainPattern(
      String.raw`\bwhy (?:is|did|has|does|was) ${NAME}\s+${OTHER_METRIC}\b`,
    ),
    question: "overview",
  },
  {
    pattern: explainPattern(
      String.raw`^(?:explain|tell me about|show me|how is|what about)\s+${NAME}\s+(?:gauge|validator|pool|vault)\b`,
    ),
    question: "overview",
  },
  {
    pattern: explainPattern(
      String.raw`^(?:explain|tell me about)\s+(?:the\s+)?(?:gauge|validator|pool)\s+(.+?)\??$`,
    ),
    question: "overview",
  },
  {
    pattern: explainPattern(
      String.raw`^what(?:'s| has| is)?\s+happen(?:ed|ing)\s+(?:to|with)\s+${NAME}\??$`,
    ),
    question: "overview",
  },
  {
    pattern: explainPattern(String.raw`^explain\s+${NAME}\??$`),
    question: "overview",
  },
  {
    pattern: explainPattern(
      String.raw`^how many votes (?:does|do|has|did) ${NAME}${KIND}\s+(?:have|get|got)${NOW}\??$`,
    ),
    question: "overview",
  },
  {
    pattern: explainPattern(
      String.raw`^what(?:'s| is| are)\s+the\s+(?:current\s+)?(?:boost(?:\s+multiplier)?|multiplier|apy|apr|votes?|vote count|incentives?|bribes?)\s+(?:for|of|on)\s+${NAME}${KIND}${NOW}\??$`,
    ),
    question: "overview",
  },
]

// Captured "names" that are really the wallet's own things or a how-to
// ("why does my vote transaction revert", "explain how boost works").
const NOT_A_NAME =
  /(?:^|\s)(?:my|our|i|vote|votes|voting|transactions?|tx|locks?|nft|trove|loan|revert\w*)(?:\s|$)|^(?:how|what|why|when|where|the difference)\s/i

function explainDecision(query: string): RouterDecision | null {
  for (const { pattern, question } of EXPLAIN_PATTERNS) {
    const name = pattern.exec(query.trim())?.[1]?.trim()
    if (name && name.length <= 80 && !NOT_A_NAME.test(name)) {
      return {
        kind: "tool",
        intent: "explain_gauge",
        tool: "explain_gauge",
        input: { gauge: name, question, window: null },
      }
    }
  }
  return null
}

// "my", "I" and friends: a question about the selected wallet.
const FIRST_PERSON = /\b(my|mine|me|i|i'm|i've|we|our)\b/

const REWARD_WORDS =
  "(?:incentives?|rewards?|bribes?|fees|claims?|earnings|yield)"

// Selling or keeping: "sell", "sell or relock", "swap and re-lock".
const HABIT_VERB = "(?:sell|dump|swap|relock|re-lock|keep|hold)"

// "What does SNF do with its incentives", "where did 0x... rewards go",
// "does X sell or relock its rewards": follow the money.
const TRACE_PATTERNS: readonly RegExp[] = [
  // "Where did the rewards of 0x... go", "what happened to the fees of X".
  new RegExp(
    String.raw`\bwhere (?:do|does|did|have|has) (?:the |all )?(?:\w+ )?${REWARD_WORDS} (?:of|from|for|earned by|claimed by) (.+?) (?:go|gone|end up|ended up)\b`,
    "i",
  ),
  new RegExp(
    String.raw`\bwhat (?:happened|happens) to (?:the |all )?(?:\w+ )?${REWARD_WORDS} (?:of|from|for|earned by|claimed by) (.+?)\??$`,
    "i",
  ),
  // "What happened to SNF's rewards": the holder's own rewards, not a
  // gauge's incentives ("what happened to SNF incentives" explains it).
  /\bwhat (?:happened|happens|has happened) to (.+?)(?:'s|’s|s') (?:\w+ )?(?:rewards?|fees|claims?|earnings)\b/i,
  new RegExp(
    String.raw`\bwhat (?:does|did|do|has|have|is|are) (.+?) (?:do|done|doing) with (?:the |its |their |his |her |all |any )?(?:\w+ )?${REWARD_WORDS}\b`,
    "i",
  ),
  new RegExp(
    String.raw`\bwhere (?:do|does|did|have|has) (.+?)(?:'s|’s)? (?:\w+ )?${REWARD_WORDS} (?:go|gone|end up|ended up)\b`,
    "i",
  ),
  new RegExp(
    String.raw`\b(?:does|do|did) (.+?) ${HABIT_VERB}(?: (?:or|and) ${HABIT_VERB})? (?:its |their |the |his |her )?(?:\w+ )?${REWARD_WORDS}\b`,
    "i",
  ),
  /\bfollow the (?:money|rewards|incentives) (?:of|for|from) (.+?)\??$/i,
]

const HOLDERS =
  /\b(?:largest|biggest|top|main)\s+(?:(\d{1,2})\s+)?(vebtc|vemezo)\s+(?:holders?|lockers?|owners?|whales?|voters?)\b/
// "who holds the most veBTC", "who has the largest veMEZO locks".
const MOST_HELD =
  /\bwho (?:holds|owns|has|locks?) (?:the )?(?:most|largest|biggest|top)\b(?: \w+){0,2}? (vebtc|vemezo)\b/
// What holders do with rewards: a selling or relocking verb and a reward
// word ("which voters hold their veMEZO longest" is not it).
const VOTER_HABITS = new RegExp(
  String.raw`\b(?:which|what|who)\b(?: \w+)? (?:voters|holders|lockers|whales)\b(?=.*\b(?:sell|swap|dump|relock|re-lock|hold|keep)\b)(?=.*\b${REWARD_WORDS}\b)`,
)

/** Holders compared by what they do with rewards, not by their votes. */
const REWARD_MEASURE = new RegExp(
  String.raw`\b(?:sell|swap|dump|relock|re-lock|claim\w*|${REWARD_WORDS})\b`,
)

const WHO_IS =
  /^(?:who is|who's|who are|who owns|who holds|which (?:wallet|address|safe) (?:owns|holds|is))\s+(.+?)\??$/i

/** Rankings, eligibility and votes are not "who is X". */
const NOT_A_HOLDER =
  /\b(?:most|largest|biggest|top|eligible|qualif\w*|voting|vote|votes|validators?|voters?|holders?|lockers?|winning|leading)\b/i

// "who is SNF voting for", "what does 0x... vote for": its locks' votes.
const VOTES_OF =
  /^(?:who (?:is|are|does|do)|what (?:is|are|does|do)) (.+?) (?:voting for|vote for|voting on|vote on)\??$/i

const KNOWN_ALIASES = KNOWN_ENTITIES.flatMap((entity) => entity.aliases)

/**
 * Names one holder: an address, a lock number, a curated entity or a
 * "labelled X". Generic words ("the most veBTC", "the validators") do not.
 */
function namesHolder(subject: string): boolean {
  const value = subject.toLowerCase()
  if (/\b0x[0-9a-f]{40}\b/.test(value)) return true
  if (
    /#\s*\d{1,12}\b|\b(?:vebtc|vemezo)\s+(?:lock\s+|nft\s+)?\d{1,12}\b/.test(
      value,
    )
  ) {
    return true
  }
  if (/\b(?:label(?:l)?ed|called|named|tagged)\s+\S/.test(value)) return true
  const words = ` ${value.replace(/[^a-z0-9]+/g, " ")} `
  return KNOWN_ALIASES.some((alias) => words.includes(` ${alias} `))
}

/**
 * Groups and quantities, not one holder: "the largest holders", "big
 * lockers", "most voters", "whales'", "the treasury".
 */
const GROUP_WORDS =
  /\b(?:holders?|lockers?|voters?|whales?|owners?|people|users|wallets|everyone|anyone|someone|treasury|team|dao|community|protocol|validators|stakers|delegates|delegators|investors|traders|funds|projects|most|largest|biggest|top|big|all|some|many|every|each|other|others)\b/i

/**
 * Whether a trace or activity subject is one holder Stuart can look up:
 * the selected wallet ("I", "my"), an address, a lock, a curated entity,
 * "labelled X", or a proper name ("Acme Capital", answered plainly when
 * nothing carries it). Generic subjects go to the model instead.
 */
function oneHolder(raw: string): boolean {
  const subject = raw.trim()
  if (subjectText(subject) === null) return true
  if (GENERIC_SUBJECT.test(subject)) return false
  // "Supernormal and Acme", "SNF or 0x...": several holders.
  if (JOINED.test(subject)) return false
  // An address or a lock number is one holder, whatever words surround it.
  if (/\b0x[0-9a-f]{40}\b|#\s*\d/i.test(subject)) return true
  // Group words before names: "Mezo validators", "the SNF voters".
  if (GROUP_WORDS.test(subject)) return false
  // "LPs", "the DAOs on Mezo", "VCs": a plural acronym not followed by
  // more of a name ("Acme LPs Fund" is one) makes a group.
  if (/\b[A-Z]{2,}s\b(?!\s+[A-Z])/.test(subject)) return false
  if (/^0x[0-9a-f]+$/i.test(subject) || namesHolder(subject)) return true
  return /(?:^|\s)[A-Z][\w&.'-]*/.test(subject.replace(/^(?:the|a|an)\s+/i, ""))
}

/** Subjects joined by and, or, versus or a comma. */
const JOINED = /\s(?:and|or|&|vs\.?|versus)\s|,\s*\S/i

/** Protocol nouns, not holders: "what does veBTC do with fees". */
const GENERIC_SUBJECT =
  /^(?:the |a |an )?(?:vebtc|vemezo|mezo|btc|musd|ve\w*|gauges?|voters?|holders?|lockers?|validators?|people|users|everyone|anyone|protocol|mezo earn|earn|it|they|them|this|that)$/i

const ACTIVITY_PATTERNS: readonly RegExp[] = [
  /\bwhat (?:has|have|did) (.+?) (?:been doing|done|been up to)\b/i,
  // "from" names a holder, not a date: "SNF activity from April to June"
  // is not about a holder called "April to June".
  /\b(?:activity|transactions|transfers|counterparties) (?:of|for|by|from(?! (?:the )?(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|last|this|previous|past|today|yesterday|start|beginning)\b|\d(?!x))))\s(.+?)(?:\s+(?:since|in the|over the|during|last|past)\b.*)?\??$/i,
  /\bwho (?:does|did) (.+?) (?:send|transfer) (?:to|money to|funds to)\b/i,
]

/** Days per unit: an epoch is a week. */
const UNIT_DAYS: Record<string, number> = {
  day: 1,
  week: 7,
  epoch: 7,
  month: 30,
  year: 365,
}

/**
 * Rolling spans in days: "last 30 days", "past 2 weeks", "in the last
 * month", "past year", "last 4 epochs". A bare "last month" is the
 * calendar month (calendarLast), not 30 days.
 */
function periodDays(text: string): number | null {
  const found =
    /\b(?:last|past|previous)\s+(?:(\d{1,3})\s+)?(day|week|epoch|month|year)s?\b/.exec(
      text,
    )
  if (found === null) return null
  const count = Number.parseInt(found[1] ?? "1", 10)
  const days = count * (UNIT_DAYS[found[2] ?? "day"] ?? 1)
  return days >= 1 && days <= 365 ? days : null
}

/**
 * "last month", "previous week", "last year" on their own: the whole
 * calendar unit before this one, as the tool reads it. "Since the start
 * of last year" and "from last month to now" run from its first day to
 * today. "The last month" and "the past month" are rolling, and so is
 * any count (null here). Any other qualified use ("the end of last
 * month", "from last month", "last month and this month") is "unread",
 * for the model: the calendar unit alone would drop the rest.
 */
function lastUnit(text: string): PeriodSlots | "unread" | null {
  const found =
    /(\b(?:the|since|of|from)\s+)?\b(?:last|previous)\s+(week|month|year)\b(\s+(?:to|until|till|through|thru)\b|\s+(?:and|or)\s+(?:this|the|last|previous|next)\b)?/.exec(
      text,
    )
  if (found === null) return null
  const unit = `last ${found[2]}`
  const toToday =
    /\b(?:since|from)\s+the\s+(?:start|beginning)\s+of\s+(?:the\s+)?(?:last|previous)\s+(?:week|month|year)\b/.exec(
      text,
    ) ??
    /\bfrom\s+(?:the\s+)?(?:last|previous)\s+(?:week|month|year)\s+(?:to|until|till)\s+(?:now|today)\b/.exec(
      text,
    )
  // A second period beside it ("until June", "vs this month", "between
  // last month and today") is the model's: one unit alone would drop it.
  if (toToday !== null) {
    return OTHER_PERIOD.test(text.replace(toToday[0], " "))
      ? "unread"
      : { days: null, since: unit, until: "today" }
  }
  const before = found[1]?.trim()
  if (before === undefined && found[3] === undefined) {
    return OTHER_PERIOD.test(text.replace(found[0], " "))
      ? "unread"
      : { days: null, since: unit, until: unit }
  }
  // Rolling, or "since last month": read further down.
  if ((before === "the" || before === "since") && found[3] === undefined) {
    return null
  }
  return "unread"
}

// Month names without a capture, for building larger patterns.
const MONTH_WORD =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
const MONTH_NAME = `(${MONTH_WORD})`
/** Words that name another period or an end, beside a "last X". */
const OTHER_PERIOD = new RegExp(
  String.raw`\b(?:until|till|through|thru|end of|vs\.?|versus|compared|between|today|now|this (?:week|month|year|epoch))\b|\b${MONTH_WORD}\b|\b\d{4}-\d{2}-\d{2}\b`,
)
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
]
const ORDINAL = String.raw`(\d{1,2})(?:st|nd|rd|th)?`
const START = String.raw`\b(?:since|from|after|starting(?: on| from)?)\s+(?:the\s+)?`
const YEAR = String.raw`(?:,?\s+(20\d\d))?`

/** One date as users write it, any of the forms below. */
const DATE_PHRASE = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+${MONTH_WORD}\b(?:,?\s+20\d\d)?|${MONTH_WORD}\s+\d{1,2}(?:st|nd|rd|th)?\b(?!\d)(?:,?\s+20\d\d)?|${MONTH_WORD}\b(?:\s+20\d\d)?)`

const ISO_START = new RegExp(String.raw`${START}(\d{4}-\d{2}-\d{2})\b`)
const DAY_MONTH = new RegExp(
  String.raw`${START}${ORDINAL}(?:\s+of)?\s+${MONTH_NAME}\b${YEAR}`,
)
const MONTH_DAY = new RegExp(
  String.raw`${START}${MONTH_NAME}\s+${ORDINAL}\b(?!\d)${YEAR}`,
)
const MONTH_ONLY = new RegExp(
  String.raw`${START}${MONTH_NAME}\b(?:\s+(20\d\d)\b)?`,
)
/** "from April to June", "between 1 May and 3 June", "from March until now". */
const RANGE = new RegExp(
  String.raw`\b(?:from|between)\s+(?:the\s+)?(${DATE_PHRASE})\s+(?:to|and|until|till|through|thru)\s+(?:the\s+)?(${DATE_PHRASE}|today|now)\b`,
)
/** "in March", "during October 2026", "in the month of May". */
const WITHIN_MONTH = new RegExp(
  String.raw`\b(?:in|during|for|over)\s+(?:the\s+month\s+of\s+)?(${MONTH_WORD}\b(?:\s+20\d\d)?)\b(?!\s+\d{1,2}(?:st|nd|rd|th)?\b)`,
)
/**
 * A month naming the rewards: "SNF's October rewards", "the March 2026
 * fees". Not "may", a verb more often than a month here.
 */
const MONTH_REWARDS = new RegExp(
  String.raw`(?<!\b(?:since|after|from|before|until|till|starting|by)\s+(?:the\s+)?)\b((?!may\b)${MONTH_WORD}\b(?:\s+20\d\d)?)\s+(?:\w+\s+)?(?:rewards?|incentives?|fees|bribes?|claims?|rebases?|earnings|emissions|activity|transactions|transfers)\b`,
)

function monthIndex(name: string | undefined): number {
  return MONTHS.indexOf((name ?? "").slice(0, 3))
}

/** "2026-04-23"; a day that is not in the month is null. */
function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month, day))
  if (day < 1 || date.getUTCMonth() !== month) return null
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * One date phrase in the tool's words: "2026-04-23" with a year, "23 apr"
 * without (the tool picks the year), a month name, or "2026-09-01" for a
 * month with a year ("2026-09", the whole month, as an end). Null when it
 * is not a real date.
 */
function toolDate(phrase: string, end: boolean): string | null {
  const value = phrase.trim().replace(/,/g, "").replace(/\s+/g, " ")
  if (value === "today" || value === "now") return end ? "today" : null
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (iso !== null) {
    return isoDate(
      Number.parseInt(iso[1] ?? "", 10),
      Number.parseInt(iso[2] ?? "", 10) - 1,
      Number.parseInt(iso[3] ?? "", 10),
    )
  }
  const dayFirst = new RegExp(
    String.raw`^${ORDINAL}(?: of)? ${MONTH_NAME}(?: (20\d\d))?$`,
  ).exec(value)
  const monthFirst =
    dayFirst === null
      ? new RegExp(String.raw`^${MONTH_NAME} ${ORDINAL}(?: (20\d\d))?$`).exec(
          value,
        )
      : null
  const dated =
    dayFirst !== null
      ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3] }
      : monthFirst !== null
        ? { day: monthFirst[2], month: monthFirst[1], year: monthFirst[3] }
        : null
  if (dated !== null) {
    const day = Number.parseInt(dated.day ?? "", 10)
    const month = monthIndex(dated.month)
    if (month < 0) return null
    if (dated.year !== undefined) {
      return isoDate(Number.parseInt(dated.year, 10), month, day)
    }
    // Any year with a 29 February will do for the check.
    return isoDate(2024, month, day) === null ? null : `${day} ${MONTHS[month]}`
  }
  const monthOnly = new RegExp(String.raw`^${MONTH_NAME}(?: (20\d\d))?$`).exec(
    value,
  )
  if (monthOnly === null) return null
  const month = monthIndex(monthOnly[1])
  if (month < 0) return null
  if (monthOnly[2] === undefined) return monthOnly[1] ?? null
  const first = isoDate(Number.parseInt(monthOnly[2], 10), month, 1)
  return first === null ? null : end ? first.slice(0, 7) : first
}

/**
 * The start the user named, for the tool to date: "2026-04-23" when a year
 * is given, "23 apr" without one (the tool picks the year), a month name,
 * or "this week", "this month", "this year". Null when there is none or it
 * cannot be read.
 */
function periodSince(text: string): string | null {
  const iso = ISO_START.exec(text)
  if (iso !== null) return toolDate(iso[1] ?? "", false)
  const dayMonth = DAY_MONTH.exec(text)
  const monthDay = dayMonth === null ? MONTH_DAY.exec(text) : null
  const dated =
    dayMonth !== null
      ? { day: dayMonth[1], month: dayMonth[2], year: dayMonth[3] }
      : monthDay !== null
        ? { day: monthDay[2], month: monthDay[1], year: monthDay[3] }
        : null
  if (dated !== null) {
    return toolDate(
      `${dated.day} ${dated.month}${dated.year === undefined ? "" : ` ${dated.year}`}`,
      false,
    )
  }
  const monthOnly = MONTH_ONLY.exec(text)
  if (monthOnly !== null) {
    return toolDate(
      `${monthOnly[1]}${monthOnly[2] === undefined ? "" : ` ${monthOnly[2]}`}`,
      false,
    )
  }
  const current = /\b(?:this|the current)\s+(week|month|year)\b/.exec(text)
  if (current !== null) return `this ${current[1]}`
  // "since last month": from its first day to now.
  const sinceLast =
    /\bsince\s+(?:the\s+)?(?:last|previous)\s+(week|month|year)\b/.exec(text)
  return sinceLast === null ? null : `last ${sinceLast[1]}`
}

/**
 * A period the user named that neither parser read ("since last spring",
 * "between May and the end of June", "last 2 years", "yesterday", "after
 * the 5th", "until March"): the model dates it instead of a silent 90-day
 * default.
 */
const UNREAD_PERIOD = new RegExp(
  String.raw`\bsince\b|\b(?:last|past|previous|this|over the)\s+(?:\d+\s+)?(?:days?|weeks?|months?|years?|quarters?|epochs?)\b|\b(?:in|during|from|after|before|until|till|between|starting|by)\s+(?:the\s+)?(?:${MONTH_WORD}\b|20\d\d\b|q[1-4]\b|\d{1,2}(?:st|nd|rd|th)?\b|\d{1,2}[/.]\d{1,2})|\b(?:yesterday|today|this epoch|last epoch)\b`,
)

export type PeriodSlots = {
  days: number | null
  since: string | null
  until: string | null
}

/** The period asked for; null when one was named but could not be read. */
export function periodOfText(text: string): PeriodSlots | null {
  const range = RANGE.exec(text)
  if (range !== null) {
    const since = toolDate(range[1] ?? "", false)
    const until = toolDate(range[2] ?? "", true)
    return since === null || until === null
      ? null
      : { days: null, since, until: until === "today" ? null : until }
  }
  const within = WITHIN_MONTH.exec(text) ?? MONTH_REWARDS.exec(text)
  if (within !== null) {
    const since = toolDate(within[1] ?? "", false)
    const until = toolDate(within[1] ?? "", true)
    return since === null || until === null
      ? null
      : { days: null, since, until }
  }
  const last = lastUnit(text)
  if (last === "unread") return null
  if (last !== null) return last
  const days = periodDays(text)
  const since = periodSince(text)
  if (since !== null) {
    // "since last month" runs to now, not to the month's end.
    return {
      days: null,
      since,
      until: since.startsWith("last ") ? "today" : null,
    }
  }
  if (days !== null) return { days, since: null, until: null }
  return UNREAD_PERIOD.test(text)
    ? null
    : { days: null, since: null, until: null }
}

/** The subject as the user wrote it; null for "I", "we", "my wallet". */
function subjectText(raw: string): string | null {
  const subject = raw
    .trim()
    .replace(
      new RegExp(
        String.raw`\s+(?:since|in the|over the|during|last|past|previous|this (?:week|month|year)|(?:in|from|after|starting|between|until|before) (?:the )?(?:\d{1,2}(?:st|nd|rd|th)?\b|\d{4}\b|${MONTH_WORD}\b))[\s\S]*$`,
        "i",
      ),
      "",
    )
    .trim()
  if (
    subject === "" ||
    /^(?:i|we|me|us|my|our|my wallet|our wallet|this wallet|you)$/i.test(
      subject,
    )
  ) {
    return null
  }
  return subject.slice(0, 200)
}

/** Left to the model: a group of holders, or a period it must date. */
const TO_MODEL: RouterDecision = { kind: "none", help: false }

function chainDecision(
  query: string,
  text: string,
  now: Date,
): RouterDecision | null {
  const decision = chainTool(query, text)
  if (decision === null || decision.kind !== "tool") return decision
  // Rankings carry no period.
  if (decision.tool === "compare_holders") return decision
  // A period named but not read, ahead, or ending before it starts: the
  // model dates it or says so, never a silent 90 days. The same parser as
  // the tool's, so the router and the model read a period alike.
  const slots = periodOfText(text)
  if (slots === null) return TO_MODEL
  return periodOf(now, slots.days, 90, slots.since, slots.until) === null
    ? TO_MODEL
    : decision
}

function chainTool(query: string, text: string): RouterDecision | null {
  const { days, since, until } = periodOfText(text) ?? {
    days: null,
    since: null,
    until: null,
  }
  // Rankings first: "do the top 5 veMEZO holders sell or relock" is about
  // holders, not one holder named "the top 5 veMEZO holders".
  const ranked = holdersDecision(text)
  if (ranked !== null) return ranked
  for (const pattern of TRACE_PATTERNS) {
    const found = pattern.exec(query.trim())
    if (!found) continue
    // "Does anyone relock", "what do LPs do": a group, for the model,
    // never the wallet's claimables further down.
    if (!oneHolder(found[1] ?? "")) return TO_MODEL
    return {
      kind: "tool",
      intent: "chain_activity",
      tool: "trace_rewards",
      input: {
        subject: subjectText(found[1] ?? ""),
        days,
        since,
        until,
        windowDays: null,
      },
    }
  }
  return holderDecision(query, { days, since, until })
}

/** "Top 5 veMEZO holders", "who holds the most veBTC", "which voters sell". */
function holdersDecision(text: string): RouterDecision | null {
  const holders = HOLDERS.exec(text) ?? MOST_HELD.exec(text)
  if (holders !== null || VOTER_HABITS.test(text)) {
    const asset = /\bvemezo\b/.test(text)
      ? "veMEZO"
      : /\bvebtc\b/.test(text)
        ? "veBTC"
        : "veMEZO"
    const count =
      holders !== null && /^[0-9]+$/.test(holders[1] ?? "")
        ? Number.parseInt(holders[1] ?? "", 10)
        : null
    return {
      kind: "tool",
      intent: "chain_activity",
      tool: "compare_holders",
      input: {
        asset,
        limit: count !== null && count >= 1 && count <= 8 ? count : null,
        measure: REWARD_MEASURE.test(text) ? "rewards" : "votes",
      },
    }
  }
  return null
}

/** One named holder: its votes, who it is, or its activity. */
function holderDecision(
  query: string,
  period: PeriodSlots,
): RouterDecision | null {
  const votesOf = VOTES_OF.exec(query.trim())
  if (votesOf && namesHolder(votesOf[1] ?? "")) {
    return {
      kind: "tool",
      intent: "chain_activity",
      tool: "address_activity",
      input: { subject: subjectText(votesOf[1] ?? ""), ...period },
    }
  }
  const who = WHO_IS.exec(query.trim())
  if (
    who &&
    !FIRST_PERSON.test(who[1] ?? "") &&
    !NOT_A_HOLDER.test(who[1] ?? "") &&
    namesHolder(who[1] ?? "")
  ) {
    return {
      kind: "tool",
      intent: "chain_activity",
      tool: "resolve_holder",
      input: { subject: subjectText(who[1] ?? "") },
    }
  }
  for (const pattern of ACTIVITY_PATTERNS) {
    const found = pattern.exec(query.trim())
    if (!found || !oneHolder(found[1] ?? "")) continue
    return {
      kind: "tool",
      intent: "chain_activity",
      tool: "address_activity",
      input: { subject: subjectText(found[1] ?? ""), ...period },
    }
  }
  return null
}

function protocolTopic(text: string): ProtocolTopic | null {
  if (FIRST_PERSON.test(text)) return null
  if (
    /\b(?:mezo|btc|bitcoin)\s+price\b|\bprice of (?:mezo|btc|bitcoin)\b|\bhow much is (?:one |1 )?(?:mezo|btc|bitcoin)\b/.test(
      text,
    )
  ) {
    return "prices"
  }
  if (
    /\b(?:what|which|current) epoch\b|\bepoch (?:number|end|ends|ending|is it)\b|\bwhen (?:does|will|do) (?:the |this )?(?:current )?epoch\b/.test(
      text,
    )
  ) {
    return "epoch"
  }
  if (/\bhow many\b.*\b(?:lockers|holders|wallets|stakers)\b/.test(text)) {
    return "lockers"
  }
  if (
    /\bhow much (?:mezo|btc|bitcoin|vemezo|vebtc)\b.*\b(?:locked|staked)\b|\btotal (?:vemezo|vebtc|value locked|locked|voting power|supply)\b|\btvl\b/.test(
      text,
    )
  ) {
    return "locked"
  }
  if (
    /\b(?:total|overall|protocol)\b.*\b(?:incentives?|bribes?)\b|\b(?:incentives?|bribes?)\b.*\b(?:in total|overall|altogether)\b/.test(
      text,
    )
  ) {
    return "incentives"
  }
  return null
}

const HELP_SIGNALS: RegExp[] = [
  /^(?:how (?:do|does|can|should|would|to)|how's)\b/,
  /^(?:what (?:is|are|does|do|happens)|what's)\b/,
  /^why\b/,
  /^if\b.*\bwhat happens\b|\bwhat happens (?:to|if|when)\b/,
  /^(?:can|could|should|may|do|does|is|are) (?:i|we|you|it|my|vemezo|vebtc)\b/,
  /^(?:where|when) (?:can|do|should|does|is|will|are)\b/,
  /\b(?:revert\w*|fail(?:s|ed|ing)?|error|stuck)\b/,
  /\b(?:relayer|relay|gasless|meta.?transactions?|forwarder|eip-?712)\b/,
  /\b(?:approve|approval|setapprovalforall)\b/,
  /\bis (?:it|that|this) (?:safe|ok|okay|legit)\b/,
  /\b(?:scam|phishing|hack(?:ed)?|exploit|stolen)\b/,
]

// Wallet and live-data questions that read like how-tos ("what are my
// rewards", "how much am I earning") stay with the data tools.
const DATA_SIGNALS =
  /\bhow (?:much|many)\b|\bmy (?:claimable|rewards?|locks?|trove|loan|apy|earnings?|balance|positions?|ballot)\b|\b(?:for|of|on) (?:the )?\S+ (?:gauge|validator|pool)\b/
// How Mezo works, even about the wallet's own votes ("do my votes carry
// over", "do votes persist").
const CONCEPT =
  /\b(?:carr(?:y|ies|ied) over|persist\w*|roll(?:s|ed)? over|decay\w*|expire\w*)\b/
const TROUBLE =
  /\b(?:revert\w*|fail(?:s|ed|ing)?|error|stuck|relayer|relay|gasless|approve|approval|scam|hack(?:ed)?|exploit)\b/

/**
 * How-to, concept and troubleshooting questions. A clear knowledge match
 * answers deterministically; a weaker one goes to the model with the
 * knowledge tool; null leaves the question to the other rules.
 */
function helpDecision(
  query: string,
  text: string,
  slots: QuerySlots,
): RouterDecision | null {
  if (!HELP_SIGNALS.some((pattern) => pattern.test(text))) return null
  // Troubleshooting and hypotheticals ("what happens to my rewards if")
  // are how-tos even when they mention the wallet.
  const trouble =
    TROUBLE.test(text) ||
    /\bwhat happens\b|\bdifference between\b/.test(text) ||
    CONCEPT.test(text)
  if (PERSONAL.test(text) && !trouble) return null
  if (DATA_SIGNALS.test(text) && !trouble) return null
  if (
    slots.amount !== null ||
    slots.amountUsd !== null ||
    slots.allocations ||
    slots.shockPercent !== null
  ) {
    return null
  }
  const [best, second] = searchMezoKnowledge(query, { limit: 2 })
  if (best === undefined) return null
  if (best.score >= 5 && best.score - (second?.score ?? 0) >= 2) {
    return {
      kind: "tool",
      intent: "mezo_help",
      tool: "mezo_knowledge",
      input: { question: query.slice(0, 300) },
    }
  }
  return { kind: "none", help: true }
}

// Questions about an action ("can I merge my locks?") are how-tos, not
// requests to act.
const QUESTION_LEAD =
  /^(?:can|could|should|may|how|why|what|when|where|is|are|do|does)\b/

/** "#2930" or "lock 2930", in order of appearance. */
export function lockIdsIn(text: string): string[] {
  return [...text.matchAll(/#(\d{1,12})\b|\blocks?\s+(\d{1,12})\b/g)].map(
    (match) => match[1] ?? match[2] ?? "",
  )
}

function lockAction(input: {
  action: "add" | "extend" | "auto_max" | "withdraw" | "merge" | "transfer"
  tokenId?: string | null
  intoTokenId?: string | null
  amount?: string | null
  weeks?: number | null
  recipient?: string | null
}): RouterDecision {
  return {
    kind: "tool",
    intent: "navigate",
    tool: "prepare_lock_action",
    input: {
      action: input.action,
      tokenId: input.tokenId ?? null,
      intoTokenId: input.intoTokenId ?? null,
      amount: input.amount ?? null,
      weeks: input.weeks ?? null,
      recipient: input.recipient ?? null,
    },
  }
}

/**
 * Requests to act on a lock or claim and relock: each becomes an unsigned
 * proposal. Never an approval of the lock itself, never a relayer.
 */
function lockActionDecision(text: string): RouterDecision | null {
  if (QUESTION_LEAD.test(text)) return null
  const ids = lockIdsIn(text)
  if (
    /\bclaim\b/.test(text) &&
    /\b(?:re-?lock|compound|lock (?:it|them) again|add (?:it|them) to)\b/.test(
      text,
    )
  ) {
    return {
      kind: "tool",
      intent: "claim_rewards",
      tool: "prepare_claim_relock",
      input: { lockId: ids[0] ?? null },
    }
  }
  if (/\bmerge\b/.test(text)) {
    return lockAction({
      action: "merge",
      tokenId: ids[0] ?? null,
      intoTokenId: ids[1] ?? null,
    })
  }
  const recipient = /\b(0x[0-9a-f]{40})\b/.exec(text)?.[1] ?? null
  if (/\b(?:transfer|send|give|move)\b/.test(text) && ids.length > 0) {
    return lockAction({
      action: "transfer",
      tokenId: ids[0] ?? null,
      recipient,
    })
  }
  if (/\bwithdraw\b/.test(text) && /\b(?:lock|locks|expired|#\d)/.test(text)) {
    return lockAction({ action: "withdraw", tokenId: ids[0] ?? null })
  }
  if (/\b(?:auto ?max|lock permanently|permanent lock)\b/.test(text)) {
    return lockAction({ action: "auto_max", tokenId: ids[0] ?? null })
  }
  if (/\bextend\b/.test(text)) {
    const weeks = /\b(\d{1,3})\s*weeks?\b/.exec(text)?.[1]
    const years = /\b(\d)\s*years?\b/.exec(text)?.[1]
    const count =
      weeks !== undefined
        ? Number.parseInt(weeks, 10)
        : years !== undefined
          ? Number.parseInt(years, 10) * 52
          : null
    return lockAction({
      action: "extend",
      tokenId: ids[0] ?? null,
      weeks: count !== null && count >= 1 && count <= 208 ? count : null,
    })
  }
  const add =
    /\b(?:add|lock(?: up)?|top up)\s+(\d[\d,]*(?:\.\d+)?)\s*(mezo|btc)?\b.*?\b(?:to|into|in)\b/.exec(
      text,
    )
  if (
    add !== null &&
    (ids.length > 0 || /\b(?:my )?(?:lock|vemezo|vebtc)\b/.test(text))
  ) {
    return lockAction({
      action: "add",
      tokenId: ids[0] ?? null,
      amount: (add[1] ?? "").replace(/,/g, ""),
    })
  }
  return null
}

/**
 * A ballot written out: two or more "N% to X" lines, or one with a vote
 * verb ("vote 100% to sMUSD"). Not a question about one ("why did my 50%
 * vote fail").
 */
function isVoteScript(text: string, query: string): boolean {
  const { lines } = parseBallotScript(query)
  if (lines.length === 0) return false
  const verb = /\b(?:vote|votes|voting|ballot|allocat\w*|split)\b/.test(text)
  if (lines.length >= 2 && lines.every((line) => line.linked)) return true
  return verb && !QUESTION_LEAD.test(text)
}

export function routeQuery(
  query: string,
  now: Date = new Date(),
): RouterDecision {
  const text = query.toLowerCase().trim()
  const slots = extractSlots(query)

  const page =
    /^(?:go to|open|take me to|show me the)\s+(overview|home|vote|voting|rewards|activity)(?:\s+page)?$/.exec(
      text,
    )
  if (page) {
    const target = PAGES[page[1] ?? ""]
    if (target) return { kind: "navigate", ...target }
  }

  if (
    /\b(report (?:a |an )?(?:bug|problem|issue)|contact support|support report|file a report|send (?:a )?report)\b/.test(
      text,
    )
  ) {
    return {
      kind: "tool",
      intent: "support_report",
      tool: "draft_support_report",
      input: { problem: query.slice(0, 2_000), kind: null },
    }
  }

  // Nobody can promise a return: answer from the reviewed note.
  if (/\bguarantee[ds]?\b|\brisk[- ]free\b/.test(text)) {
    return {
      kind: "tool",
      intent: "mezo_help",
      tool: "mezo_knowledge",
      input: { question: query.slice(0, 300) },
    }
  }

  // A vote script: "25% to the BTC/MUSD-200 pool, 20% to ...", pasted from
  // a governance post or typed. Names are resolved by code in the tool.
  if (isVoteScript(text, query)) {
    return {
      kind: "tool",
      intent: "custom_vote",
      tool: "prepare_vote_script",
      input: { script: query.slice(0, 2_000) },
    }
  }

  const chain = chainDecision(query, text, now)
  if (chain !== null) return chain

  const topic = protocolTopic(text)
  if (topic !== null) {
    return {
      kind: "tool",
      intent: "protocol_stats",
      tool: "get_protocol_stats",
      input: { topic },
    }
  }

  // "Which gauges have most consistently had rewards?": a ranking by funded
  // epochs, never the wallet's claimables.
  if (
    /\b(?:consistent(?:ly)?|most often|every epoch|reliabl[ey]|steadily)\b/.test(
      text,
    ) &&
    !FIRST_PERSON.test(text)
  ) {
    return {
      kind: "tool",
      intent: "rank_gauges",
      tool: "rank_gauges",
      input: {
        objective: "most_consistently_funded",
        branch: slots.branch,
        window: slots.window ?? 8,
      },
    }
  }

  const action = lockActionDecision(text)
  if (action !== null) return action

  // A named gauge ("why did SNF APY change") before the how-to rules.
  const named = explainDecision(query)
  if (named) return named

  const help = helpDecision(query, text, slots)
  if (help !== null) return help

  if (/\b(wormhole|portal)\b/.test(text)) {
    return {
      kind: "tool",
      intent: "bridge_search",
      tool: "search_transactions",
      input: { provider: "wormhole", direction: slots.direction, limit: null },
    }
  }
  if (/\bbridg(?:e|es|ed|ing)\b/.test(text)) {
    return {
      kind: "tool",
      intent: "bridge_search",
      tool: "search_transactions",
      input: { provider: "all", direction: slots.direction, limit: null },
    }
  }

  const loanWords =
    /\b(troves?|loans?|borrow\w*|debt|liquidat\w*|collateral ratio|repay\w*|surplus)\b/.test(
      text,
    )
  if (loanWords) {
    if (/\b(surplus|claim (?:my |the )?(?:btc )?collateral)\b/.test(text)) {
      return {
        kind: "tool",
        intent: "claim_collateral_surplus",
        tool: "claim_collateral_surplus",
        input: {},
      }
    }
    if (/\brepay\w*\b/.test(text)) {
      if (slots.repayAmount === null) {
        return { kind: "clarify", cardId: "repay-amount", slots }
      }
      return {
        kind: "tool",
        intent: "repay",
        tool: "prepare_repay",
        input: { amount: slots.repayAmount },
      }
    }
    if (slots.shockPercent !== null || /\bliquidat\w*\b/.test(text)) {
      return {
        kind: "tool",
        intent: "liquidation_scenario",
        tool: "scenario_liquidation",
        input: {
          drops: null,
          requested:
            slots.shockPercent !== null &&
            slots.shockPercent >= 1 &&
            slots.shockPercent <= 99
              ? slots.shockPercent
              : null,
        },
      }
    }
    return {
      kind: "tool",
      intent: "loan_position",
      tool: "get_loan_position",
      input: {},
    }
  }
  if (slots.shockPercent !== null && /\bbtc\b/.test(text)) {
    return {
      kind: "tool",
      intent: "liquidation_scenario",
      tool: "scenario_liquidation",
      input: { drops: null, requested: slots.shockPercent },
    }
  }

  // "My APY" / "what am I earning": the wallet's own voting-incentive
  // earnings, before the rewards and explain keywords can claim the words.
  if (
    /\bmy\s+(?:apy|apr|yield|earnings?|returns?|income)\b/.test(text) ||
    /\bwhat\s+(?:am|are)\s+(?:i|we)\s+(?:earning|making|getting)\b/.test(
      text,
    ) ||
    /\bhow\s+much\s+(?:am|do|have|did)\s+(?:i|we)\s+(?:earn|earning|earned|make|making|made)\b/.test(
      text,
    )
  ) {
    return {
      kind: "tool",
      intent: "wallet_earnings",
      tool: "get_wallet_earnings",
      input: {},
    }
  }

  // The wallet's locks and voting power ("how much MEZO do I have locked").
  if (
    (!PERSONAL.test(text) &&
      /\b(my locks?|voting power|my wallet|my positions?|my vemezo|my vebtc|my locked)\b/.test(
        text,
      )) ||
    /\bhow much (?:mezo|btc|bitcoin|vemezo|vebtc)\b.*\b(?:do|have|did) (?:i|we)\b/.test(
      text,
    ) ||
    /\b(?:show|list) (?:my|the) locks?\b/.test(text)
  ) {
    return {
      kind: "tool",
      intent: "navigate",
      tool: "get_wallet_context",
      input: {},
    }
  }

  // "How many boost gauges have incentives": the funded count leads the
  // incentives ranking.
  if (
    /\bhow many\b.*\b(?:gauges?|validators?|pools?|targets?)\b.*\b(?:incentives?|bribes?|funded)\b/.test(
      text,
    )
  ) {
    return {
      kind: "tool",
      intent: "rank_gauges",
      tool: "rank_gauges",
      input: {
        objective: "most_incentives_deposited",
        branch: slots.branch,
        window: null,
      },
    }
  }

  // "Which gauge pays the most", "best paying validators", "highest APY
  // pools": incentives per vote, the Vote page's APY sort.
  if (
    /\bpays?\s+(?:the\s+)?(?:most|best|highest)\b/.test(text) ||
    /\b(?:best|top|highest)[-\s]paying\b/.test(text) ||
    /\b(?:highest|top|best|biggest)\s+(?:apy|apr|yield)s?\b/.test(text) ||
    /\b(?:apy|apr|yield)\s+(?:leaders?|leaderboard|ranking)\b/.test(text)
  ) {
    return {
      kind: "tool",
      intent: "rank_gauges",
      tool: "rank_gauges",
      input: { objective: "highest_apy", branch: slots.branch, window: null },
    }
  }

  // "Top incentives this epoch" and friends: gross deposited incentives.
  if (
    /\b(?:top|most|highest|largest|biggest)\s+(?:deposited\s+)?(?:incentives?|bribes?)\b/.test(
      text,
    )
  ) {
    return {
      kind: "tool",
      intent: "rank_gauges",
      tool: "rank_gauges",
      input: {
        objective: "most_incentives_deposited",
        branch: slots.branch,
        window: null,
      },
    }
  }

  const explain = explainDecision(query)
  if (explain) return explain

  if (/\b(claim|claimable|rewards?|bribes?|earned|earnings)\b/.test(text)) {
    const prepare = /\bclaim\b/.test(text) && !/\bclaimable\b/.test(text)
    return {
      kind: "tool",
      intent: "claim_rewards",
      tool: prepare ? "prepare_claim" : "list_claimable_rewards",
      input: { sources: null, lockIds: null },
    }
  }

  // Earning on MUSD: a verb, or an amount with a vault word. A question
  // that only names sMUSD ("compare sMUSD incentives") is not a deposit.
  if (
    /\b(zap|deposit|put|park|stake)\b/.test(text) ||
    (/\b(vaults?|savings|smusd)\b/.test(text) &&
      (slots.amount !== null || slots.amountUsd !== null))
  ) {
    return zapDecision(slots)
  }
  if (
    /\b(most|highest|largest|biggest)\s+(?:deposited\s+)?(?:incentives?|bribes?)\b/.test(
      text,
    )
  ) {
    return {
      kind: "tool",
      intent: "rank_gauges",
      tool: "rank_gauges",
      input: {
        objective: "most_incentives_deposited",
        branch: slots.branch,
        window: null,
      },
    }
  }
  if (/\bconsistent(?:ly)?\b/.test(text)) {
    return {
      kind: "tool",
      intent: "rank_gauges",
      tool: "rank_gauges",
      input: {
        objective: "most_consistently_funded",
        branch: slots.branch,
        window: slots.window ?? 8,
      },
    }
  }
  const personal = PERSONAL.test(text)
  if (
    /\b(best|top|good)\b/.test(text) &&
    /\b(gauges?|validators?|pools?)\b/.test(text) &&
    !personal
  ) {
    return { kind: "clarify", cardId: "gauge-objective", slots }
  }
  if (personal) {
    if (slots.veBTCOnly)
      return { kind: "clarify", cardId: "voting-domain", slots }
    return {
      kind: "tool",
      intent: "optimize_votes",
      tool: "optimize_votes",
      input: { branch: slots.branch, lockIds: null },
    }
  }
  if (/\bvot(?:e|es|ing)\b/.test(text)) {
    return { kind: "clarify", cardId: "gauge-objective", slots }
  }

  return { kind: "none", help: false }
}
