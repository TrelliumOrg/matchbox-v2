// Numbers written in words ("five thousand", "twenty-five", "a hundred",
// "five grand", "a dozen"), so the sourcing check holds them to the same
// rule as digits. English only: other languages are not read (a limit).
//
// Not read: "one" on its own ("which one", "one of", "no one"), unless it
// stands before a unit or a token ("one BTC", "one dollar"), and words that
// are not a count ("once", "single", "half", ordinals). Vague amounts
// ("thousands of", "millions") are read as a figure no tool states.

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
}

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
}

const SCALES: Record<string, bigint> = {
  dozen: 12n,
  hundred: 100n,
  thousand: 1_000n,
  million: 1_000_000n,
  billion: 1_000_000_000n,
  trillion: 1_000_000_000_000n,
}

/**
 * Short scales, read only after a number ("five grand", "five k", "five
 * mil"): alone they are other words ("a grand plan", "Plan K").
 */
const SLANG_SCALES: Record<string, bigint> = {
  k: 1_000n,
  grand: 1_000n,
  thou: 1_000n,
  lakh: 100_000n,
  lakhs: 100_000n,
  crore: 10_000_000n,
  crores: 10_000_000n,
  mil: 1_000_000n,
  mn: 1_000_000n,
  bn: 1_000_000_000n,
}

const WORD = [
  ...Object.keys(UNITS),
  ...Object.keys(TENS),
  ...Object.keys(SCALES),
  ...Object.keys(SLANG_SCALES),
]
  .sort((a, b) => b.length - a.length)
  .join("|")

/**
 * A run of number words: "five thousand", "twenty-five", "one hundred and
 * twenty", and "a" or "an" before a scale ("a hundred", "a dozen").
 */
const PHRASE = new RegExp(
  `\\b(?:(?:a|an)\\s+(?=(?:${Object.keys(SCALES).join("|")})\\b))?(?:${WORD})(?:(?:(?<=hundred|thousand|million|billion|trillion)\\s+and\\s+|[\\s-]+)(?:${WORD}))*\\b`,
  "gi",
)

/** "a couple of", "a couple": two. */
const COUPLE = /\ba\s+(?:couple|pair)(?:\s+of)?\b/gi

/**
 * Vague amounts: "thousands of MUSD", "millions", "a zillion", "double your
 * balance". No tool states one.
 */
const VAGUE =
  /\b(?:dozens|hundreds|thousands|millions|billions|trillions|[a-z]*zillions?|(?:ba|ga|squ|ka)jillions?|(?:double|triple|quadruple|multiply|twice|tenfold|hundredfold)\s+(?:your|their|the|my)\s+(?:[a-z]+\s+)?(?:balance|funds?|money|deposits?|holdings?|rewards?|yield|returns?|stake|position|btc|musd|mezo|tokens?|coins?|bitcoin|investment|locks?|apy))\b/gi

/** Number words that may be written joined in one word ("fivethousand"). */
const JOINABLE = [
  ...Object.keys(UNITS),
  ...Object.keys(TENS),
  ...Object.keys(SCALES),
  "and",
].sort((a, b) => b.length - a.length)

/**
 * A word made only of number words run together ("fivethousand",
 * "twentyfive", "onehundredandfive"), split into them, or null.
 */
function joinedWords(word: string): string[] | null {
  const lower = word.toLowerCase()
  const split = (at: number): string[] | null => {
    if (at === lower.length) return []
    for (const each of JOINABLE) {
      if (!lower.startsWith(each, at)) continue
      const rest = split(at + each.length)
      if (rest !== null) return [each, ...rest]
    }
    return null
  }
  const parts = split(0)
  if (parts === null || parts.length < 2) return null
  if (parts[0] === "and" || parts.at(-1) === "and") return null
  return parts
}

/**
 * A unit or a token right after a number: "one BTC", "one veMEZO", "one
 * dollar". Symbols are written with two capitals or more.
 */
const UNIT_SYMBOL = /^\s+(?:[a-z]{0,2}[A-Z]{2,}|\$)/
const UNIT_WORD =
  /^\s+(?:dollars?|bucks?|tokens?|coins?|bitcoins?|sats?|satoshis?|percent|btc|mezo|musd|usd[ct]?|vebtc|vemezo)\b/i

export type NumberWords = {
  text: string
  /** The value as digits, or "vague" for an amount no tool can state. */
  value: string
  /** Where the words start in the text. */
  index: number
}

/** The value of a run of number words, or null if it does not read as one. */
function wordsValue(phrase: string): bigint | null {
  const words = phrase
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((word) => word !== "and")
  let total = 0n
  let group = 0n
  let any = false
  // What the last word was: a unit or a ten may not follow a unit, and a
  // ten may not follow a ten ("five six", "twenty thirty" are two numbers).
  let last: "unit" | "ten" | "scale" | null = null
  for (const [index, word] of words.entries()) {
    if ((word === "a" || word === "an") && index === 0) {
      group = 1n
      last = "unit"
      continue
    }
    const unit = UNITS[word]
    const ten = TENS[word]
    const scale = SCALES[word] ?? SLANG_SCALES[word]
    if (unit !== undefined) {
      if (last === "unit") return null
      group += BigInt(unit)
      last = "unit"
    } else if (ten !== undefined) {
      if (last === "unit" || last === "ten") return null
      group += BigInt(ten)
      last = "ten"
    } else if (scale !== undefined) {
      // A short scale only after a number: "five k", never "k" alone.
      if (SLANG_SCALES[word] !== undefined && last === null) return null
      last = "scale"
      group = (group === 0n ? 1n : group) * scale
      if (scale >= 1_000n) {
        total += group
        group = 0n
      }
    } else {
      return null
    }
    any = true
  }
  return any ? total + group : null
}

/** "one" counts only before a unit or a token ("one BTC"). */
function oneCounts(text: string, end: number): boolean {
  const after = text.slice(end)
  return UNIT_SYMBOL.test(after) || UNIT_WORD.test(after)
}

/** Every number written in words, with its value as digits. */
export function numberWords(text: string): NumberWords[] {
  const found: NumberWords[] = []
  for (const match of text.matchAll(PHRASE)) {
    const phrase = match[0]
    const end = match.index + phrase.length
    // "one" alone is a pronoun as often as a count.
    if (/^one$/i.test(phrase.trim()) && !oneCounts(text, end)) continue
    const value = wordsValue(phrase)
    if (value !== null) {
      found.push({ text: phrase, value: value.toString(), index: match.index })
      continue
    }
    // Not one number ("two three"): each word on its own.
    let offset = match.index
    for (const word of phrase.split(/([\s-]+)/)) {
      const at = offset
      offset += word.length
      if (/^[\s-]*$/.test(word)) continue
      const each = wordsValue(word)
      if (each === null) continue
      if (/^one$/i.test(word) && !oneCounts(text, at + word.length)) continue
      found.push({ text: word, value: each.toString(), index: at })
    }
  }
  for (const match of text.matchAll(/\p{L}+/gu)) {
    const parts = joinedWords(match[0])
    if (parts === null) continue
    const value = wordsValue(parts.join(" "))
    found.push({
      text: match[0],
      value: value === null ? "vague" : value.toString(),
      index: match.index,
    })
  }
  for (const match of text.matchAll(COUPLE)) {
    found.push({ text: match[0], value: "2", index: match.index })
  }
  for (const match of text.matchAll(VAGUE)) {
    found.push({ text: match[0], value: "vague", index: match.index })
  }
  return found.sort((a, b) => a.index - b.index)
}

/** The text with every number word removed ("Lavender.Five" → "Lavender."). */
export function withoutNumberWords(text: string): string {
  return text.replace(new RegExp(`\\b(?:${WORD}|a|an|and)\\b`, "gi"), "")
}
