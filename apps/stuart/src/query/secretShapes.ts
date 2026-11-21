// The shapes of a pasted secret, read by the router (a message holding one
// goes to the safety notes) and by redaction (no log line or support
// report keeps one).
//
// The two readers answer different questions, and they are not held to
// the same standard:
//
// - REDACTION must be conservative: when unsure, redact. A lost
//   transaction hash costs a support round-trip; a stored key costs
//   someone's funds.
// - ROUTING may be precise. A false safety note costs the user an answer.
//
// What each reads:
//
// - A hex key: 64 hex characters, with or without "0x", any case, also
//   split into up to eight pieces by spaces, a dash, a line break or a
//   blank line. Redaction removes every one unless it was verified as an
//   on-chain id this turn (a tool returned it from a chain read; nothing
//   the user typed is ever looked up to confirm it). Routing
//   reads it as an id only when the text is about a transaction (tx,
//   transaction, hash, explorer, receipt) and names no key or wallet, when
//   it is a known id from this turn, when it sits in a Matchbox or Mezo
//   link on one of their id routes (the host checked exactly with the URL
//   parser), or when the text asks about a market
//   and names nothing of the user's own.
// - A recovery phrase. Redaction removes any run of 12 or more words of 3
//   to 8 letters (the shape of a BIP-39 phrase, whatever the words), in
//   any case, separated by spaces, line breaks, commas, " - ", "|", ";",
//   "/" or ". ", numbered or not. In a support report's free text the run goes
//   only when 9 of some 12 of its words are BIP-39 words or the text names
//   a seed, phrase, words, mnemonic or recovery. Routing reads a phrase
//   only where it stands as its own run (cut at ":", "!", "?", and at full
//   stops and line breaks unless they lay out a grid or list): a run with
//   11 BIP-39 words in some 12 (a typo allowed) when the message names a
//   secret or the run is not ordinary text (fewer than two question or
//   function words in those 12, at most one in eight in the run), or a
//   stretch of 12 to 24 list words, edge to edge, with a valid BIP-39
//   checksum, one mistyped word allowed (its list neighbours one edit
//   away are tried). The checksum never gates redaction: a 12-word
//   checksum is 4 bits.
// - A WIF key (base58, 51 or 52 characters, from 5, K or L) and an
//   extended private key (xprv, tprv and the like).
//
// Only the English word list is read; phrases in other languages' lists
// are not (see internal/plans/improvement-backlog.md).

import BIP39_WORDS, { BIP39_INDEX } from "./bip39Words"
import { ownHost } from "./sourcedText"

export type SecretKind = "hex_key" | "wif_key" | "xprv_key" | "word_phrase"

export type SecretSpan = { start: number; end: number; kind: SecretKind }

/** Where redaction runs: a log line, or a support report's free text. */
export type RedactionMode = "log" | "report"

export type SecretOptions = {
  /**
   * 64-hex values (lowercase, 0x-prefixed) this turn's tools returned
   * from chain reads: on-chain ids, kept.
   */
  verified?: ReadonlySet<string>
  mode?: RedactionMode
}

const NONE: ReadonlySet<string> = new Set()

// --- word runs --------------------------------------------------------------

/** A list number on its own: "1", "1.", "2)", "#3", "(4)". */
const LIST_NUMBER = /^[#(]?\d{1,2}[.):-]?$/

/** A dash or bullet on its own, as in "1 - abandon" or "abandon - ability". */
const DASH = /^[-–—•*]+$/

/** A list number joined to its word: "1.abandon", "2)ability", "3-able". */
const NUMBERED_WORD = /^[#(]?\d{1,2}[.):-](.+)$/

/** A word, with quotes or brackets around it and a mark after it. */
const WORD =
  /^[\x22\x27“‘([]*([A-Za-z]{3,8})[\x22\x27”’)\]]*([.:!?])?[\x22\x27”’)\]]*$/

/** What separates the words of a pasted phrase: "/" included. */
const TOKEN = /[^\s,|\x3b/]+/g

/** The minimum run of words read as a phrase. */
export const PHRASE_MIN_WORDS = 12

type RunWord = {
  start: number
  end: number
  word: string
  listed: boolean
  /** The mark after the word: "." is soft, ":", "!" and "?" are hard. */
  mark: "" | "soft" | "hard"
  /** A line break between this word and the one before it. */
  lineBefore: boolean
}

/**
 * Every run of consecutive words of 3 to 8 letters, with where each word
 * starts and ends, whether it is a BIP-39 word, and the marks and line
 * breaks around it. List numbers, dashes and bullets are skipped; any
 * other token ends the run.
 */
function wordRuns(text: string): RunWord[][] {
  const runs: RunWord[][] = []
  let run: RunWord[] = []
  let lastEnd = 0
  let line = false
  const close = () => {
    if (run.length > 0) runs.push(run)
    run = []
  }
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0]
    if (text.slice(lastEnd, match.index).includes("\n")) line = true
    lastEnd = match.index + token.length
    if (LIST_NUMBER.test(token) || DASH.test(token)) continue
    const numbered = NUMBERED_WORD.exec(token)
    const parsed = WORD.exec(numbered?.[1] ?? token)
    const word = parsed?.[1]?.toLowerCase()
    if (word === undefined) {
      close()
      line = false
      continue
    }
    const mark = parsed?.[2]
    run.push({
      start: match.index,
      end: lastEnd,
      word,
      listed: BIP39_WORDS.has(word),
      mark: mark === undefined ? "" : mark === "." ? "soft" : "hard",
      lineBefore: line,
    })
    line = false
  }
  close()
  return runs
}

/** Every maximal stretch of BIP-39 words inside a run. */
function listedStretches(run: readonly RunWord[]): RunWord[][] {
  const out: RunWord[][] = []
  let stretch: RunWord[] = []
  for (const word of run) {
    if (word.listed) stretch.push(word)
    else {
      if (stretch.length > 0) out.push(stretch)
      stretch = []
    }
  }
  if (stretch.length > 0) out.push(stretch)
  return out
}

/** The longest run of consecutive BIP-39 words in a text. */
export function longestWordRun(text: string): number {
  let best = 0
  for (const run of wordRuns(text)) {
    for (const stretch of listedStretches(run)) {
      best = Math.max(best, stretch.length)
    }
  }
  return best
}

/** The most BIP-39 words in any 12 consecutive words of a run. */
function mostListedIn12(run: readonly RunWord[]): number {
  let best = 0
  let count = 0
  for (let index = 0; index < run.length; index += 1) {
    if (run[index]?.listed) count += 1
    if (index >= PHRASE_MIN_WORDS && run[index - PHRASE_MIN_WORDS]?.listed) {
      count -= 1
    }
    if (index >= PHRASE_MIN_WORDS - 1) best = Math.max(best, count)
  }
  return best
}

/**
 * Words ordinary English prose is held together with. A recovery phrase in
 * any language's word list, or one with several typos, has almost none, so
 * a run with fewer than three in some 12 words is not kept as prose.
 */
const PROSE_WORDS: ReadonlySet<string> = new Set(
  (
    "the and for was but not with from have this that you are what how when " +
    "then than they them there here been were will would could should can " +
    "did does has had its into onto over under after before since while " +
    "about again also just very some any all each every because however " +
    "where which who why our your their his her out off now still only"
  ).split(" "),
)

/** The fewest prose words in any 12 consecutive words of a run. */
function fewestProseIn12(run: readonly RunWord[]): number {
  let fewest = Number.POSITIVE_INFINITY
  let count = 0
  for (let index = 0; index < run.length; index += 1) {
    if (PROSE_WORDS.has(run[index]?.word ?? "")) count += 1
    const leaving = run[index - PHRASE_MIN_WORDS]
    if (leaving !== undefined && PROSE_WORDS.has(leaving.word)) count -= 1
    if (index >= PHRASE_MIN_WORDS - 1) fewest = Math.min(fewest, count)
  }
  return fewest
}

/** A text that names a secret phrase: then a run of words is one. */
const SECRET_MENTION = /\b(?:seeds?|phrases?|words|mnemonics?|recovery)\b/i

/**
 * Where a text holds a phrase, for redaction. In a log, every run of 12 or
 * more words goes. In a report's free text, a run is kept only when it
 * reads as prose: the text names no seed phrase, no 12 of its words hold 9
 * BIP-39 words, and every 12 of its words hold at least three prose words.
 * Anything else goes, as every such run did before reports had their own
 * rule: a phrase from another language's list, or one with several typos,
 * must not be stored.
 */
export function phraseSpans(
  text: string,
  mode: RedactionMode = "log",
): SecretSpan[] {
  const mentioned = mode === "report" && SECRET_MENTION.test(text)
  const spans: SecretSpan[] = []
  for (const run of wordRuns(text)) {
    if (run.length < PHRASE_MIN_WORDS) continue
    const prose =
      mode === "report" &&
      !mentioned &&
      mostListedIn12(run) < 9 &&
      fewestProseIn12(run) >= 3
    if (prose) continue
    const first = run[0]
    const last = run[run.length - 1]
    if (first === undefined || last === undefined) continue
    spans.push({ start: first.start, end: last.end, kind: "word_phrase" })
  }
  return spans
}

// --- routing a phrase -------------------------------------------------------

/**
 * Question and function words that are BIP-39 words, the ones a question
 * is made of. A run holding two of them reads as ordinary text ("can you
 * check what total reward this gauge will give next month"); a random
 * phrase holds two about one time in fifty, and the checksum or a secret
 * word still catches those. Prepositions such as "about" and "above" are
 * left out: a phrase holds them as often as a question does.
 */
export const QUESTION_WORDS: ReadonlySet<string> = new Set(
  "all also any because before can have into just more much must need next now once only other please same since sure that then there they this until very want way what when where will you".split(
    " ",
  ),
)

function functionWords(words: readonly RunWord[]): number {
  return words.filter((word) => QUESTION_WORDS.has(word.word)).length
}

/** A secret named near a run of words: then the run is a phrase. */
const SECRET_NEAR =
  /\b(?:seeds?|phrases?|words|mnemonics?|recovery|backups?)\b/i

/** The lengths of a BIP-39 phrase. */
const PHRASE_LENGTHS: readonly number[] = [12, 15, 18, 21, 24]

/** Words per line or per sentence of a phrase laid out as a grid or list. */
const LAYOUT_SIZES: readonly number[] = [1, 2, 3, 4, 6]

/** Cuts a run of words after each word `cut` says ends a piece. */
function splitAfter(
  words: readonly RunWord[],
  cut: (word: RunWord, next: RunWord) => boolean,
): RunWord[][] {
  const pieces: RunWord[][] = []
  let piece: RunWord[] = []
  words.forEach((word, index) => {
    piece.push(word)
    const next = words[index + 1]
    if (next !== undefined && cut(word, next)) {
      pieces.push(piece)
      piece = []
    }
  })
  if (piece.length > 0) pieces.push(piece)
  return pieces
}

/**
 * Pieces of the same size (the last may be shorter): a phrase written one
 * word, or a few words, per line or per sentence ("abandon. ability.").
 */
function isLayout(pieces: readonly RunWord[][]): boolean {
  const size = pieces[0]?.length ?? 0
  if (pieces.length < 2 || !LAYOUT_SIZES.includes(size)) return false
  return pieces.every((piece, index) =>
    index === pieces.length - 1 ? piece.length <= size : piece.length === size,
  )
}

/**
 * The runs a phrase is read on for routing: a run of words cut at hard
 * marks (":", "!", "?") and, unless the pieces are a grid or list layout,
 * at full stops and line breaks. A phrase must stand as its own run.
 */
function phraseRuns(text: string): RunWord[][] {
  return wordRuns(text).flatMap((run) =>
    splitAfter(run, (word) => word.mark === "hard").flatMap((part) => {
      const pieces = splitAfter(
        part,
        (word, next) => word.mark === "soft" || next.lineBefore,
      )
      return isLayout(pieces) ? [part] : pieces
    }),
  )
}

/**
 * Whether a run holds a phrase by its shape alone: 11 BIP-39 words in
 * some 12 (a typo allowed), beside a secret word, or with fewer than two
 * function words in those 12 and no more than one in eight in the whole
 * run (so "please check total reward balance price fee next month average
 * token gauge pool vote" stays a question).
 */
function phraseShaped(run: readonly RunWord[], near: boolean): boolean {
  if (run.length < PHRASE_MIN_WORDS) return false
  const sparse = functionWords(run) <= run.length / 8
  for (let at = 0; at + PHRASE_MIN_WORDS <= run.length; at += 1) {
    const window = run.slice(at, at + PHRASE_MIN_WORDS)
    const listed = window.filter((word) => word.listed).length
    if (listed < PHRASE_MIN_WORDS - 1) continue
    if (near || (sparse && functionWords(window) < 2)) return true
  }
  return false
}

/**
 * A window a checksum is read on: a stretch of BIP-39 words of a phrase's
 * length that starts and ends at a run's edges or at words not on the
 * list, or such a stretch with one word not on the list inside or at an
 * edge (`typo`: a mistyped word, tried as each list word one edit away).
 */
type PhraseWindow = { words: RunWord[]; typo: number | null }

/** The most words before a phrase that still leave it the whole message. */
const LEAD_IN_MAX = 8

/**
 * Whether a window is the whole message, apart from a short lead-in ("my
 * wallet won't open:", "here are my words:").
 */
function wholeMessage(text: string, words: readonly RunWord[]): boolean {
  const first = words[0]
  const last = words[words.length - 1]
  if (first === undefined || last === undefined) return false
  if (/[A-Za-z0-9]/.test(text.slice(last.end))) return false
  return (text.slice(0, first.start).match(TOKEN) ?? []).length <= LEAD_IN_MAX
}

/**
 * The function words a window may hold and still have its checksum read:
 * a quarter of its words, or a third when it is the whole message. A real
 * phrase holds four or more in about one in twenty thousand, five or more
 * in about one in a million; a question of list words holds five or six
 * ("can you check what total reward this gauge will give next month"),
 * and one in sixteen such questions has a valid 12-word checksum by
 * chance.
 */
function checksumAllowed(text: string, words: readonly RunWord[]): boolean {
  const share = wholeMessage(text, words) ? 3 : 4
  return functionWords(words) <= words.length / share
}

/** Every window of a text whose checksum routing may read, in order. */
function* checksumWindows(text: string): Generator<PhraseWindow> {
  for (const run of phraseRuns(text)) {
    const unlisted = run.flatMap((word, index) => (word.listed ? [] : [index]))
    const edges = [-1, ...unlisted, run.length]
    for (let at = 0; at + 1 < edges.length; at += 1) {
      const from = (edges[at] ?? 0) + 1
      const to = edges[at + 1] ?? 0
      // A stretch of list words, edge to edge.
      if (PHRASE_LENGTHS.includes(to - from)) {
        const words = run.slice(from, to)
        // Fewer than two function words: the shape rule reads it already.
        if (functionWords(words) >= 2 && checksumAllowed(text, words)) {
          yield { words, typo: null }
        }
      }
      // Two stretches and the one word between them, or one stretch and
      // the word at its edge: a phrase with one mistyped word.
      if (at + 2 < edges.length) {
        const start = (edges[at] ?? 0) + 1
        const end = edges[at + 2] ?? 0
        if (PHRASE_LENGTHS.includes(end - start)) {
          const words = run.slice(start, end)
          if (checksumAllowed(text, words)) {
            yield { words, typo: to - start }
          }
        }
      }
    }
  }
}

/** A short fingerprint of a window (never the words themselves). */
function fingerprint(window: PhraseWindow): string {
  let hash = 0x811c9dc5
  for (const each of window.words) {
    for (let index = 0; index < each.word.length; index += 1) {
      hash ^= each.word.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    hash ^= 0x20
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${window.words.length}:${window.typo ?? "-"}:${hash.toString(16)}`
}

/** Fingerprints of windows found to carry a valid checksum. Bounded. */
const CHECKSUMMED = new Set<string>()
const CHECKSUMMED_MAX = 512

/**
 * The most checksums one text has read. A 2,000-character message, the
 * longest Stuart takes, has at most about 70 windows of a phrase's length
 * and reads far fewer than this; the bound only stops a longer text.
 */
const CHECKSUM_READS_MAX = 4_096

const LETTERS = "abcdefghijklmnopqrstuvwxyz"

/**
 * The BIP-39 words one edit from a word: a letter changed, added, dropped
 * or two letters swapped.
 */
export function listNeighbours(word: string): string[] {
  const out = new Set<string>()
  const add = (candidate: string) => {
    if (candidate !== word && BIP39_WORDS.has(candidate)) out.add(candidate)
  }
  for (let at = 0; at <= word.length; at += 1) {
    const head = word.slice(0, at)
    for (const letter of LETTERS) add(`${head}${letter}${word.slice(at)}`)
    if (at === word.length) continue
    add(`${head}${word.slice(at + 1)}`)
    for (const letter of LETTERS) add(`${head}${letter}${word.slice(at + 1)}`)
    if (at + 1 < word.length) {
      add(`${head}${word[at + 1]}${word[at]}${word.slice(at + 2)}`)
    }
  }
  return [...out]
}

/** The word lists a window's checksum is tried on. */
function* candidates(window: PhraseWindow): Generator<string[]> {
  const words = window.words.map((each) => each.word)
  if (window.typo === null) {
    yield words
    return
  }
  for (const neighbour of listNeighbours(words[window.typo] ?? "")) {
    const fixed = [...words]
    fixed[window.typo] = neighbour
    yield fixed
  }
}

/**
 * Whether BIP-39 words carry a valid checksum: the first 32/3 bits per
 * word are the entropy, the last 1/3 bit per word the first bits of its
 * SHA-256 (Web Crypto, in Workers and Node).
 */
export async function bip39Checksum(
  words: readonly string[],
): Promise<boolean> {
  const length = words.length
  if (!PHRASE_LENGTHS.includes(length)) return false
  const indices = words.map((word) => BIP39_INDEX.get(word.toLowerCase()))
  if (indices.some((index) => index === undefined)) return false
  const bits: number[] = []
  for (const index of indices as number[]) {
    for (let bit = 10; bit >= 0; bit -= 1) bits.push((index >> bit) & 1)
  }
  const entropyBits = (length * 32) / 3
  const checksumBits = length / 3
  const entropy = new Uint8Array(entropyBits / 8)
  for (let bit = 0; bit < entropyBits; bit += 1) {
    if (bits[bit] === 1) {
      entropy[bit >> 3] = (entropy[bit >> 3] ?? 0) | (0x80 >> (bit & 7))
    }
  }
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", entropy))
  for (let bit = 0; bit < checksumBits; bit += 1) {
    const expected = ((hash[bit >> 3] ?? 0) >> (7 - (bit & 7))) & 1
    if (bits[entropyBits + bit] !== expected) return false
  }
  return true
}

/**
 * Reads the BIP-39 checksum of every window the router may need it for,
 * ahead of the router (which is synchronous): `runStuart` awaits this
 * before routing. A window with a mistyped word is valid when one of the
 * list words one edit away makes the checksum hold. Only a fingerprint of
 * each valid window is kept. A text not primed is routed on the shape
 * rule alone.
 */
export async function primePhraseChecksums(text: string): Promise<void> {
  if (typeof crypto === "undefined" || crypto.subtle === undefined) return
  let reads = 0
  for (const window of checksumWindows(text)) {
    const key = fingerprint(window)
    if (CHECKSUMMED.has(key)) continue
    for (const words of candidates(window)) {
      if (reads >= CHECKSUM_READS_MAX) return
      reads += 1
      if (!(await bip39Checksum(words))) continue
      if (CHECKSUMMED.size >= CHECKSUMMED_MAX) {
        const oldest = CHECKSUMMED.values().next().value
        if (oldest !== undefined) CHECKSUMMED.delete(oldest)
      }
      CHECKSUMMED.add(key)
      break
    }
  }
}

/**
 * Whether a text holds a pasted recovery phrase, for routing: a run with
 * a phrase's shape (phraseShaped), or a primed window, standing as its
 * own run, with a valid checksum (one mistyped word allowed).
 */
export function pastedPhrase(text: string): boolean {
  const near = SECRET_NEAR.test(text)
  if (phraseRuns(text).some((run) => phraseShaped(run, near))) return true
  if (CHECKSUMMED.size === 0) return false
  for (const window of checksumWindows(text)) {
    if (CHECKSUMMED.has(fingerprint(window))) return true
  }
  return false
}

// --- keys -------------------------------------------------------------------

/** Hex pieces: a run of hex characters, the first with an optional 0x. */
const HEX_PIECE = /(?<![0-9a-z])(?:0x)?[0-9a-f]+(?![0-9a-z])/gi

/**
 * What may sit between two pieces of a split key: spaces or tabs, a line
 * break or blank line, or a dash ("<32>-<32>").
 */
const PIECE_GAP =
  /^(?:[ \t]+|[ \t]*\r?\n(?:[ \t]*\r?\n)?[ \t]*|[ \t]*[-–—][ \t]*)$/

/** The most pieces a split key is read across: eight groups of eight. */
const MAX_PIECES = 8

type HexRun = { start: number; end: number; value: string }

/**
 * Every 64-hex run: one piece of 64, or up to eight pieces with small gaps
 * between them that hold 64 hex characters (a key wrapped or split when
 * pasted). Only the first piece may carry 0x. `value` is the run as an id:
 * lowercase, 0x-prefixed, without its gaps.
 */
function hexRuns(text: string): HexRun[] {
  const pieces = [...text.matchAll(HEX_PIECE)].map((match) => {
    const raw = match[0]
    const prefixed = /^0x/i.test(raw)
    return {
      start: match.index,
      end: match.index + raw.length,
      digits: raw.slice(prefixed ? 2 : 0).toLowerCase(),
      prefixed,
    }
  })
  const runs: HexRun[] = []
  let from = 0
  while (from < pieces.length) {
    const first = pieces[from]
    if (first === undefined) break
    let digits = first.digits
    let last = from
    while (digits.length < 64 && last + 1 - from < MAX_PIECES) {
      const next = pieces[last + 1]
      const current = pieces[last]
      if (next === undefined || current === undefined || next.prefixed) break
      if (!PIECE_GAP.test(text.slice(current.end, next.start))) break
      last += 1
      digits += next.digits
    }
    const end = pieces[last]?.end ?? first.end
    // A split run must hold a letter: a list of numbers ("6033 5910 ...")
    // is never read as a key.
    if (digits.length === 64 && (last === from || /[a-f]/.test(digits))) {
      runs.push({ start: first.start, end, value: `0x${digits}` })
      from = last + 1
    } else {
      from += 1
    }
  }
  return runs
}

/** Every 64-hex value in a text, as ids (lowercase, 0x-prefixed). */
export function hexValues(text: string): string[] {
  return hexRuns(text).map((run) => run.value)
}

/**
 * Words that make a 64-hex string a key for routing, whatever else the
 * text says: a key, a secret, an import, or the user's own wallet ("my
 * wallet is 0x...": a wallet address is 40 hex, so 64 is its key).
 */
const KEY_CONTEXT =
  /\b(?:(?:my|our|wallet|account|signing|this|the|a|used|using|with)\s+keys?|keys?\s+(?:is|was)|private|import\w*|export\w*|secret|seed|mnemonic|keystore|wallet\s+file|(?:my|our)\s+(?:wallet|account)|wallet\s+(?:is|was)|pk|privkey|priv\s*keys?)\b|\bkeys?\s*[:=]|\b(?:wallet|account)\s*[:=]?\s*(?:0x)?[0-9a-f]{8}/i

/** Words that make a 64-hex string a transaction hash, for routing. */
const TX_CONTEXT =
  /\b(?:tx|txs|txn|txid|transactions?|hash(?:es)?|explorer|blockscout|etherscan|receipt|what\s+happened\s+in)\b/i

/**
 * A Morpho market question, for routing only ("what is market 0x...").
 * Never with the user's own anything, a wallet, a key or an import.
 */
const MARKET_CONTEXT = /\b(?:morpho|markets?)\b/i
const OWN_OR_KEY =
  /\b(?:my|mine|our|i|me|wallet|keys?|private|import\w*|secret|seed|mnemonic|keystore)\b/i

/** The 64-hex id routes of Matchbox and Mezo pages; the id follows directly. */
const ID_ROUTE =
  /^\/(?:tx|block|borrow\/markets|borrow\/enclaves|pools\/[a-z0-9-]+)\/(0x[0-9a-f]{64})\/?$/i

/**
 * Whether a 64-hex run is the id of a Matchbox or Mezo link on one of its
 * id routes (`/tx/`, `/block/`, `/borrow/markets/`, `/borrow/enclaves/`,
 * `/pools/<chain>/`). The link is parsed with the WHATWG URL parser and
 * its host compared exactly with the sourcing code's own domains
 * (matchbox.markets, mezo.org and their subdomains, the Mezo explorer
 * included): "claim-mezo.xyz/mezo.org/tx/0x..." is not one, nor is a link
 * with user info, a port, a backslash or a scheme other than http(s).
 */
function inIdLink(text: string, run: HexRun): boolean {
  let start = run.start
  while (start > 0 && !/\s/.test(text[start - 1] ?? " ")) start -= 1
  const token = text.slice(start, run.end).replace(/^["'“‘(<[]+/, "")
  if (/[@\\]/.test(token)) return false
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(token)?.[1]?.toLowerCase()
  if (scheme !== undefined && scheme !== "http" && scheme !== "https") {
    return false
  }
  let url: URL
  try {
    url = new URL(scheme === undefined ? `https://${token}` : token)
  } catch {
    return false
  }
  if (url.username !== "" || url.password !== "" || url.port !== "") {
    return false
  }
  if (!ownHost(url.hostname.toLowerCase().replace(/\.$/, ""))) return false
  return ID_ROUTE.exec(url.pathname)?.[1]?.toLowerCase() === run.value
}

/** Any link or domain, taken out before the words are read. */
const ANY_LINK =
  /(?:https?:\/\/\S+|(?<![\w@.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/gi

/** A WIF private key (base58, 51 or 52 characters, from 5, K or L). */
const WIF = /(?<![1-9A-Za-z])[5KL][1-9A-HJ-NP-Za-km-z]{50,51}(?![1-9A-Za-z])/g

/** An extended private key: xprv, tprv, yprv, zprv, uprv, vprv. */
const XPRV =
  /(?<![1-9A-Za-z])[xtyzuvXTYZUV]prv[1-9A-HJ-NP-Za-km-z]{100,112}(?![1-9A-Za-z])/g

function spansOf(pattern: RegExp, text: string, kind: SecretKind) {
  return [...text.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    kind,
  }))
}

/** WIF and extended private keys: always keys. */
function otherKeySpans(text: string): SecretSpan[] {
  return [...spansOf(WIF, text, "wif_key"), ...spansOf(XPRV, text, "xprv_key")]
}

/**
 * The 64-hex runs routing reads as ids: in a Matchbox or Mezo id link,
 * known from this turn, or every one in a text about a transaction (no key
 * or wallet named) or about a market (nothing of the user's own named).
 */
function routedAsIds(
  text: string,
  known: ReadonlySet<string>,
): (run: HexRun) => boolean {
  const words = text.replace(ANY_LINK, " ")
  const keyNamed = KEY_CONTEXT.test(words)
  const aboutTx = !keyNamed && TX_CONTEXT.test(words)
  const aboutMarket =
    !keyNamed && MARKET_CONTEXT.test(words) && !OWN_OR_KEY.test(words)
  return (run) =>
    aboutTx || aboutMarket || known.has(run.value) || inIdLink(text, run)
}

/**
 * Whether a text holds a pasted key, for routing: a 64-hex run not read
 * as an id (see routedAsIds), a WIF key or an extended private key.
 */
export function pastedKey(
  text: string,
  known: ReadonlySet<string> = NONE,
): boolean {
  if (otherKeySpans(text).length > 0) return true
  const isId = routedAsIds(text, known)
  return hexRuns(text).some((run) => !isId(run))
}

/** A hex run longer than an address: a key, or a key cut short. */
const LONG_HEX = /(?<![0-9a-z])(?:0x)?[0-9a-f]{41,}/i

/** Consecutive BIP-39 words that may be part of a phrase cut short. */
const SEND_WORD_RUN_MAX = 7

/**
 * Whether text the user typed may carry a secret, and so must not be put
 * in a request to another system (a search, a lookup): any secret
 * redaction would remove, a hex run longer than an address, or eight or
 * more BIP-39 words in a row (part of a phrase). Conservative: the cost
 * is a search with no results.
 */
export function mayCarrySecret(text: string): boolean {
  return (
    LONG_HEX.test(text) ||
    secretSpans(text).length > 0 ||
    longestWordRun(text) > SEND_WORD_RUN_MAX
  )
}

/**
 * Every secret in a text, for redaction, in order, overlaps merged into
 * the first: every 64-hex run not verified this turn, WIF and extended
 * keys, and runs of words (see phraseSpans).
 */
export function secretSpans(
  text: string,
  options: SecretOptions = {},
): SecretSpan[] {
  const verified = options.verified ?? NONE
  const hex: SecretSpan[] = hexRuns(text)
    .filter((run) => !verified.has(run.value))
    .map((run) => ({ start: run.start, end: run.end, kind: "hex_key" }))
  const all = [
    ...hex,
    ...otherKeySpans(text),
    ...phraseSpans(text, options.mode ?? "log"),
  ].sort((left, right) => left.start - right.start || right.end - left.end)
  const merged: SecretSpan[] = []
  for (const span of all) {
    const last = merged[merged.length - 1]
    if (last !== undefined && span.start < last.end) {
      last.end = Math.max(last.end, span.end)
      continue
    }
    merged.push({ ...span })
  }
  return merged
}
