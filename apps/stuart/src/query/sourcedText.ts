// Text hygiene for Stuart's sourcing check: characters that hide or fake a
// figure, letters that look like Latin ones, and links. A model sentence
// is read in one plain form, so a figure cannot pass by being written in
// other characters.

/**
 * Characters that change what a reader sees without being seen: zero-width
 * spaces and joiners, the soft hyphen, the word joiner, a byte order mark
 * and bidirectional controls (which can reorder digits on screen).
 */
const HIDDEN = /[­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/u

/** A digit or numeric sign other than 0 to 9: "１５", "٥٠٠٠", "²", "½", "①". */
const OTHER_DIGIT = /(?![0-9])\p{N}/u

/** Latin letters and Cyrillic or Greek ones in one word: "fіve", "Мezo". */
const MIXED_SCRIPT =
  /(?=[\p{L}\p{M}]*\p{Script=Latin})(?=[\p{L}\p{M}]*[\p{Script=Cyrillic}\p{Script=Greek}])[\p{L}\p{M}]+/u

/**
 * What in a model sentence hides or fakes a figure: a hidden character, a
 * digit outside 0 to 9, or a word mixing Latin with lookalike letters. Each
 * is reported as written, for the log.
 */
export function hiddenText(text: string): string[] {
  const found: string[] = []
  const hidden = HIDDEN.exec(text)
  if (hidden) found.push(codePoint(hidden[0]))
  const digit = OTHER_DIGIT.exec(text)
  if (digit) found.push(digit[0])
  const mixed = MIXED_SCRIPT.exec(text)
  if (mixed) found.push(mixed[0])
  return found
}

function codePoint(char: string): string {
  const code = char.codePointAt(0) ?? 0
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`
}

/**
 * Letters and digits in one word, in the forms Stuart's own figures take:
 * an ordinal ("3rd"), a scale or unit on the digits ("10k", "5MM", "4x",
 * "24h", "50bps", "1e18"), a capitalised code before digits ("CL200",
 * "ERC20", "Q4"), a version ("v2") and digits before a symbol ("7777USD").
 * Any other mix ("1OOOO", "5ish") is read as a figure in disguise.
 */
const DIGIT_WORD_FORMS = [
  /^\d+(?:st|nd|rd|th)$/,
  /^\d+(?:k|K|m|M|MM|mm|b|B|bn|BN|mn|mln|x|X|h|d|w|y|s|ms|min|mins|hr|hrs|yr|yrs|wk|wks|mo|bps|e\d{1,2})$/,
  /^[A-Z]{1,6}\d{1,6}$/,
  /^[vx]\d{1,4}$/,
  /^\d+[A-Z]{2,6}$/,
]

/** Letters that pass for digits: O and o for 0, l and I for 1. */
const DIGITLIKE_ONLY = /^[0-9OolI|]+$/

/**
 * Words in a model sentence that disguise a figure: a letter outside
 * ASCII ("Ƽ000", "З000", "б000", "Ꮾ000", "ʒ000"), a word mixing letters and
 * digits outside DIGIT_WORD_FORMS ("1OOOO"), or one made only of digits
 * and digit-like letters ("lOOOO"). Names the turn's results hold, written
 * exactly, are left out first (`names`), as are dates and addresses (the
 * caller blanks them). Reported as written.
 */
export function disguisedFigures(
  text: string,
  names: Iterable<string> = [],
): string[] {
  let rest = text
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (name.trim() === "") continue
    rest = rest.split(name).join(" ")
  }
  const found: string[] = []
  for (const match of rest.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    const word = match[0]
    if (/[^A-Za-z0-9]/.test(word)) {
      found.push(word)
      continue
    }
    const digits = /\d/.test(word)
    const letters = /[A-Za-z]/.test(word)
    if (digits && letters) {
      const allowed = DIGIT_WORD_FORMS.some((form) => form.test(word))
      // "7777USD" is digits and a symbol; "1OOOO" only looks like one.
      const fake = /^\d+[OIl|]+$/.test(word)
      if (!allowed || fake) found.push(word)
      continue
    }
    if (
      letters &&
      word.length >= 3 &&
      DIGITLIKE_ONLY.test(word) &&
      /[O0]/.test(word)
    ) {
      found.push(word)
    }
  }
  return found
}

/** Cyrillic and Greek letters that look like Latin ones. */
const LOOKALIKES: Record<string, string> = {
  а: "a",
  в: "b",
  е: "e",
  ё: "e",
  і: "i",
  ї: "i",
  ј: "j",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  ѕ: "s",
  һ: "h",
  ԁ: "d",
  ԛ: "q",
  ԝ: "w",
  ѵ: "v",
  ӏ: "l",
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  Х: "X",
  І: "I",
  Ј: "J",
  Ѕ: "S",
  α: "a",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  Α: "A",
  Β: "B",
  Ε: "E",
  Ζ: "Z",
  Η: "H",
  Ι: "I",
  Κ: "K",
  Μ: "M",
  Ν: "N",
  Ο: "O",
  Ρ: "P",
  Τ: "T",
  Υ: "Y",
  Χ: "X",
}

const LOOKALIKE = new RegExp(`[${Object.keys(LOOKALIKES).join("")}]`, "gu")

/**
 * One plain form to read figures and links in: compatibility forms folded
 * (NFKC: "ｆｉｖｅ" is "five"), lookalike letters made Latin, the full-width
 * and ideographic full stops made dots ("mezo。app"), and hidden characters
 * dropped.
 */
export function plainText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[。．｡]/g, ".")
    .replace(new RegExp(HIDDEN.source, "gu"), "")
    .replace(LOOKALIKE, (char) => LOOKALIKES[char] ?? char)
}

/**
 * The text with every decimal digit written as 0 to 9: "٦٠٣٣" is "6033".
 * For the user's own message, whose figures are excluded however written.
 */
export function asciiDigits(text: string): string {
  return plainText(text).replace(/\p{Nd}/gu, (char) => {
    if (/[0-9]/.test(char)) return char
    // Decimal digits come in runs of ten from zero: count back to it.
    let code = char.codePointAt(0) ?? 0
    let value = 0
    while (value < 9 && /\p{Nd}/u.test(String.fromCodePoint(code - 1))) {
      code -= 1
      value += 1
    }
    return String(value)
  })
}

/**
 * The project's and Mezo's own domains, the only ones a model sentence may
 * name, and only when this turn's tool output named the host too. Keep
 * this the one list: Stuart's templates and evidence link only to these.
 */
export const OWN_DOMAINS: readonly string[] = ["matchbox.markets", "mezo.org"]

/**
 * Top-level domains that are always read as a link, even inside a name a
 * tool returned: common ones, ones scam links favour, the reserved ones and
 * any two letters. A dotted word under any other top-level domain is read
 * as a link too (DOMAIN), unless the turn's results name it exactly
 * ("Lavender.Five", a validator).
 */
const TLDS =
  "com|net|org|io|xyz|app|dev|finance|fi|money|exchange|markets?|network|link|site|online|top|info|co|me|ai|gg|cc|to|so|sh|tech|cloud|pro|club|vip|live|life|world|today|claims?|gift|win|bid|biz|page|website|space|store|shop|host|digital|capital|fund|trade|trading|wallet|support|help|services|solutions|systems|email|cash|bank|foundation|global|group|agency|events|news|blog|art|cfd|sbs|icu|buzz|rest|bond|lol|mobi|name|one|click|quest|run|vote|gold|loans?|credit|zone|land|ltd|inc|llc|eth|crypto|bitcoin|nft|dao|limo|fun|zip|mov|lat|cyou|monster|best|work|works|social|ink|cam|uno|men|loan|date|faith|review|stream|download|racing|win|party|science|accountant|cricket|kim|xin|ren|wang|top|pw|tk|ml|ga|cf|gq|bar|beauty|hair|skin|makeup|boats|yachts|autos|homes|motorcycles|pics|pictures|photo|photos|codes|tools|tips|guide|guru|ninja|rocks|plus|center|company|business|exposed|direct|express|airdrop|rewards?|bonus|promo|deals|sale|free|token|chain|defi|swap|stake|web3|game|games|bet|casino|poker|example|test|invalid|localhost|[a-z]{2}"

/** Schemes that run or open something without "//": never shown. */
const BARE_SCHEMES =
  "javascript|data|vbscript|file|mailto|tel|sms|tg|ipfs|ipns|ethereum|wc|intent|chrome|about|blob|ws|wss"

/**
 * A link or a domain, read in plain text (plainText), any case: a scheme
 * ("https://…", "javascript:…"), "www.…", an email address, and a domain
 * whose last label is letters in any script ("mezo-claims.app",
 * "mezo.рф") or punycode ("mezo.xn--p1ai"). Each pattern starts only
 * where a run of its characters starts (a lookbehind) and a scheme is at
 * most 31 characters, so reading a text takes time linear in its length.
 */
const LINK = new RegExp(
  [
    String.raw`(?<![\p{L}\d+.-])[\p{L}\d][\p{L}\d+.-]{0,30}:\/\/[^\s<>"']+`,
    String.raw`\b(?:${BARE_SCHEMES}):(?=[^\s])[^\s<>"']*`,
    String.raw`\bwww\.[^\s<>"']+`,
    String.raw`(?<![\p{L}\p{N}.@_%+-])(?:[\p{L}\p{N}._%+-]+@)?(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:xn--[a-z\d-]+|\p{L}{2,})(?![\p{L}\p{N}-])(?::\d+)?(?:[\/?#\\][^\s<>"']*)?`,
  ].join("|"),
  "giu",
)

/** A domain under one of TLDS: a link even when a name holds it. */
const KNOWN_TLD = new RegExp(String.raw`\.(?:${TLDS})(?:$|[:\/?#\\])`, "i")

/**
 * Links written so no reader's software sees them: "mezo-claim[.]xyz",
 * "mezo-claim (dot) xyz", "mezo-claim dot xyz", "hxxps://…". Never shown.
 */
const DEFANGED = new RegExp(
  [
    String.raw`(?<![\p{L}\p{N}-])[\p{L}\p{N}-]+\s*(?:\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\}|<\s*(?:\.|dot)\s*>)\s*[\p{L}\p{N}-]{2,}`,
    String.raw`(?<![\p{L}\p{N}-])[\p{L}\p{N}-]+\s+dot\s+(?:${TLDS})\b`,
    String.raw`\bh(?:xx|\*\*)ps?(?:\[:\]|\[\s*:\s*\]|:)?\s*(?:\/\/|\[\/\/\])?\S*`,
  ].join("|"),
  "giu",
)

/** A link as read: its text, and whether it may name only a host. */
export type LinkToken = { text: string; defanged: boolean }

/** Every link or domain in the text, trailing punctuation left off. */
export function linkTokens(text: string): string[] {
  return linkReads(text).map((each) => each.text)
}

/**
 * Every link in the text, trailing punctuation left off, defanged ones
 * ("mezo-claim[.]xyz", "hxxp://…") marked, and plain "http://" kept as
 * written so the check can refuse it.
 */
export function linkReads(text: string): LinkToken[] {
  const plain = plainText(text)
  const found: LinkToken[] = []
  for (const match of plain.matchAll(DEFANGED)) {
    found.push({ text: match[0].trim(), defanged: true })
  }
  for (const match of plain.matchAll(LINK)) {
    const link = match[0].replace(/[.,;:!?)\]'"’”]+$/u, "")
    // "Projected:" or "e.g." are no link: a scheme needs "//" or a known
    // bare scheme, a domain a last label of two letters or more.
    if (link.length > 0) found.push({ text: link, defanged: false })
  }
  return found
}

/** A parsed link: its host and the rest after it, or null if unreadable. */
export type ParsedLink = {
  scheme: string | null
  host: string
  /** Path, query and fragment, "" when the link is the host alone. */
  rest: string
}

/**
 * Parses a link with the WHATWG URL parser. A link holding "@" (user info,
 * "evil.com#@mezo.org") or a backslash is never read: null.
 */
export function parseLink(link: string): ParsedLink | null {
  if (/[@\\]/.test(link)) return null
  const scheme = /^([\p{L}\d][\p{L}\d+.-]*):/u.exec(link)?.[1]?.toLowerCase()
  const hasScheme = scheme !== undefined && /^[^:]+:\/\//.test(link)
  let url: URL
  try {
    url = new URL(hasScheme ? link : `https://${link}`)
  } catch {
    return null
  }
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.+$/, "")
  const path = url.pathname.replace(/\/+$/, "")
  return {
    scheme: hasScheme ? (scheme ?? null) : null,
    host,
    rest: `${path}${url.search}${url.hash}`,
  }
}

/** The host of a link or domain as written, lowercased, without "www.". */
export function hostOf(link: string): string {
  return parseLink(link)?.host ?? ""
}

/** A link's host and path, the form a turn's links are kept in. */
export function linkKey(link: string): string | null {
  const parsed = parseLink(link)
  return parsed === null ? null : `${parsed.host}${parsed.rest}`
}

/** A domain whose last label is one of TLDS. */
export function knownTld(link: string): boolean {
  return KNOWN_TLD.test(link) || /^[a-z][a-z\d+.-]*:/i.test(link)
}

/** A host on the project's or Mezo's own domains. */
export function ownHost(host: string): boolean {
  return OWN_DOMAINS.some((root) => host === root || host.endsWith(`.${root}`))
}
