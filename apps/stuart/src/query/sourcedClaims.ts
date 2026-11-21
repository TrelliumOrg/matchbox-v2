// Claims to have acted, in a model sentence. Stuart never acts: it reads
// the chain and prepares unsigned proposals the user signs in their own
// wallet. A sentence that says Stuart (or anyone, of the user's assets or
// votes) did, is doing or will do something is a claim, however worded:
//
// - first person, done or promised: "I sent", "I've updated your ballot",
//   "I took care of your claim", "I'm on it", "we'll cast it tonight";
// - the user's own assets or votes, done: "your vote has been recorded",
//   "your vote is in", "your vote went through", "your 2 votes were cast",
//   "your rewards have been credited", "your vote will be cast";
// - a bare report: "Done.", "Done and dusted.", "Vote submitted.";
// - passive activity ("was sent", "were moved") unless the sentence names
//   what moved or where by a sourced amount with its token or a sourced
//   address, as a description of chain activity does ("0.0608 BTC was sent
//   to 0xc62b…3ffc"). Of the user's own funds it needs a sourced address:
//   "0.5 BTC was sent to your new vault" is a claim. With only an amount,
//   where it went ("to", "into", "at", "in the ...") must be a sourced
//   name or symbol or one of Stuart's own places (a Safe, a CLPool, a
//   veBTC or veMEZO lock, the escrow): "0.0608 BTC was sent to the
//   recovery vault" is a claim.
//
// A negation counts only where it governs the verb or its subject: "no
// rewards were claimed", "nothing was sent", "wasn't sent", "has not been
// sent". "Don't panic as your deposit was sent" is a claim.

/** Words that say a vote, transaction or signature went through. */
const DONE_VERBS =
  "submitted|signed|executed|broadcast(?:ed)?|cast|placed|confirmed|processed|completed|finali[sz]ed|queued|approved|recorded|registered|credited|settled"
/** Words for chain activity, which a description may use in the passive. */
const ACTIVITY_VERBS =
  "sent|transferred|claimed|deposited|locked|relocked|bridged|swapped|withdrawn|repaid|moved|paid|added|merged|extended|voted|zapped|staked|unstaked|redeemed|migrated|refunded|returned|released|unlocked"
const ADVERBS =
  "(?:(?:now|just|already|successfully|also|all|both|fully|gone ahead and|went ahead and)\\s+)*"
const APOSTROPHE = "['’]"
const FIRST_PERSON = "(?:stuart|i|we|matchbox)"

/**
 * Past forms a first-person sentence may use of reading or preparing,
 * which is what Stuart does: "I found 3 locks", "Stuart prepared it".
 */
const READ_VERBS =
  "found|read|checked|looked|compared|ranked|traced|matched|resolved|calculated|computed|estimated|projected|quoted|listed|searched|scanned|priced|counted|summed|filtered|sorted|grouped|showed|shown|saw|seen|used|prepared|drafted|built|noticed|noted|needed|reviewed|analy[sz]ed|pulled|fetched|loaded|identified|assumed|based|limited|included|excluded|considered|parsed|interpreted|treated|asked|meant|understood|guessed|misread|mentioned|said|wrote|explained|described|summari[sz]ed|reached|missed|got"
/** The same, as "-ing" forms: "I'm reading", "we're seeing". */
const READ_GERUNDS =
  "reading|checking|looking|showing|comparing|ranking|tracing|preparing|drafting|assuming|guessing|seeing|missing|lacking|waiting|basing|using|reporting|listing|quoting|projecting|estimating|counting|treating|asking|answering|going|nothing|something|anything|everything|bring"
/** And as base forms after "will": "I'll prepare", "Stuart will show". */
const READ_BASE =
  "show|list|explain|read|check|look|compare|trace|prepare|draft|need|help|walk|point|find|search|rank|quote|price|estimate|calculate|keep|wait|ask|answer|start|say|note|use|get|tell|summari[sz]e|describe|go|see|build|follow|run|fetch|pull|resolve|match|re-?check|try|confirm|be\\s+able"
/** Irregular past forms an agent's claim may use. */
const IRREGULAR_PAST =
  "took|did|made|gave|put|set|sent|paid|went|ran|bought|sold|withdrew|undid|redid"
/** What a claim acts on: the user's assets, votes and transactions. */
const ASSET_OBJECT =
  "(?:(?:your|the|a|an|this|that|those|these|all|both)\\s+(?:[\\w#-]+\\s+){0,2}?(?:votes?|ballots?|claims?|rewards?|locks?|funds?|deposits?|repayments?|transactions?|tx|transfers?|swaps?|zaps?|loans?|troves?|positions?|collateral|approvals?|allowances?|wallets?|orders?|requests?|allocations?|bridges?|ve(?:btc|mezo)|btc|musd|mezo|tokens?|nfts?)|it|them|everything|that|this)\\b"

/** Sentences that are claims whatever else they hold. */
const CLAIM_ALWAYS: readonly RegExp[] = [
  // "I sent", "I've sent", "Stuart has submitted", "we had signed".
  new RegExp(
    `\\b${FIRST_PERSON}(?:${APOSTROPHE}(?:ve|d))?\\s+(?:(?:have|has|had)\\s+)?${ADVERBS}(?:${DONE_VERBS}|${ACTIVITY_VERBS})\\b`,
    "i",
  ),
  // "I took care of your claim", "I've updated your ballot", "we handled it".
  new RegExp(
    `\\b${FIRST_PERSON}(?:${APOSTROPHE}(?:ve|d))?\\s+(?:(?:have|has|had)\\s+)?${ADVERBS}(?!(?:${READ_VERBS})\\b)(?:[a-z]+ed|${IRREGULAR_PAST})\\b(?!\\s+(?:not|never)\\b)(?:\\s+[\\w-]+){0,3}?\\s+${ASSET_OBJECT}`,
    "i",
  ),
  // "I'm on it", "I am submitting it", "we're handling your claim".
  new RegExp(
    `\\b${FIRST_PERSON}(?:${APOSTROPHE}(?:m|re)|\\s+(?:am|are|is))\\s+${ADVERBS}(?:on\\s+it\\b|taking\\s+care\\b|(?!(?:${READ_GERUNDS})\\b)[a-z]+ing\\b)`,
    "i",
  ),
  // "I'll submit it", "we will cast your vote", "Stuart is going to sign".
  new RegExp(
    `\\b${FIRST_PERSON}(?:${APOSTROPHE}ll|\\s+(?:will|shall)|\\s+(?:am|are|is)\\s+going\\s+to|${APOSTROPHE}(?:m|re|s)\\s+going\\s+to)\\s+${ADVERBS}(?!(?:${READ_BASE}|not|never)\\b)[a-z]+\\b`,
    "i",
  ),
  // "has been submitted", "your vote's been cast".
  new RegExp(
    `(?:\\b(?:has|have|had)|${APOSTROPHE}s)\\s+${ADVERBS}been\\s+${ADVERBS}(?:${DONE_VERBS}|sent)\\b`,
    "i",
  ),
  /\b(?:was|were)\s+(?:(?:now|just|already|successfully)\s+)*(?:submitted|executed|broadcast(?:ed)?)\b/i,
  // A bare report: "Done.", "Submitted!", "Done and dusted."
  /^\W*(?:done|all set|all done|all sorted|sorted|success(?:ful(?:ly)?)?|submitted|signed|sent|cast|broadcast|executed|completed|confirmed)\b\s*(?:[,.!:;–—-]|and\s+dusted|$)/i,
  // "Vote submitted.", "Your transaction sent!". Not a count of them:
  // "13 claims sent, 2 burned" is passive activity, read below.
  new RegExp(
    `(?:^\\W*|\\b(?:your|the|my)\\s+)(?:votes?|ballots?|transactions?|tx|claims?|repayments?|deposits?|swaps?|zaps?|signatures?|transfers?)\\s+(?:${DONE_VERBS}|sent)\\s*(?:[.!,:]|$)`,
    "i",
  ),
  // Phrases that report a thing done, whoever did it.
  /\b(?:done\s+and\s+dusted|consider\s+it\s+done|taken\s+care\s+of|sorted\s+out|(?:went|gone)\s+through|(?:you['’]re|you\s+are)\s+(?:all\s+set|good\s+to\s+go|all\s+done)|(?:it|that)(?:['’]s|\s+is)\s+(?:done|sorted|complete|completed)\b)/i,
]

/** The user's own assets or votes, as the subject of a sentence. */
const YOUR_SUBJECT =
  "\\byour\\s+(?:[\\w$.,…#-]+\\s+){0,3}?(?:votes?|ballots?|claims?|rewards?|locks?|funds?|deposits?|repayments?|transactions?|tx|transfers?|swaps?|zaps?|loans?|troves?|positions?|collateral|approvals?|allowances?|orders?|requests?|allocations?|bridges?|withdrawals?|assets?|tokens?|nfts?|ve(?:btc|mezo)|btc|musd|mezo|balance)"

/**
 * The user's assets or votes, said to be done: "your vote has been
 * recorded", "your vote is in", "your 2 votes were cast", "your rewards
 * will be credited".
 */
const YOUR_DONE: readonly RegExp[] = [
  new RegExp(
    `${YOUR_SUBJECT}(?:${APOSTROPHE}s|\\s+(?:has|have|had))\\s+${ADVERBS}been\\s+${ADVERBS}(?:[a-z]+(?:ed|en)|sent|cast|put|set|paid|split|spent|sold|bought|done|dealt)\\b`,
    "i",
  ),
  new RegExp(
    `${YOUR_SUBJECT}(?:${APOSTROPHE}s|\\s+(?:is|are|was|were|got|will\\s+be|should\\s+be|would\\s+be))\\s+${ADVERBS}(?:in(?=\\s*(?:[.!,]|$))|(?:done|complete|completed|through|live|on\\s+(?:its|their)\\s+way|being\\s+processed|in\\s+progress|taken\\s+care\\s+of|sorted|handled|updated|saved|${DONE_VERBS})\\b)`,
    "i",
  ),
  // "your claim went out", "your vote got in", "your claim is out".
  new RegExp(
    `${YOUR_SUBJECT}\\s+${ADVERBS}(?:went|has\\s+gone|have\\s+gone|had\\s+gone|goes|got|is\\s+going|are\\s+going)\\s+(?:out|off|in|through)\\b|${YOUR_SUBJECT}(?:${APOSTROPHE}s|\\s+(?:is|are|was|were))\\s+${ADVERBS}out\\b(?!\\s+of\\b)`,
    "i",
  ),
  // A promise: "your rewards will be sent", "your lock is being moved".
  new RegExp(
    `${YOUR_SUBJECT}\\s+(?:will|should|would|is|are)\\s+(?:be|being)\\s+${ADVERBS}(?:${ACTIVITY_VERBS})\\b`,
    "i",
  ),
]

/**
 * Passive chain activity: a claim unless the sentence names what moved or
 * where by a sourced amount with its token or a sourced address.
 */
const PASSIVE_ACTIVITY: readonly RegExp[] = [
  new RegExp(
    `\\b(?:was|were|got)\\s+${ADVERBS}(?:${DONE_VERBS}|${ACTIVITY_VERBS})\\b`,
    "gi",
  ),
  new RegExp(
    `\\b(?:has|have|had)\\s+${ADVERBS}been\\s+${ADVERBS}(?:${ACTIVITY_VERBS})\\b`,
    "gi",
  ),
  /\b(?:is|are)\s+(?:(?:now|just|already|successfully)\s+)*(?:submitted|signed|cast|broadcast|executed|confirmed|placed)\b/gi,
]

/** Passive verbs said of a vote or a transaction: never of the user's. */
const DONE_ONLY = new RegExp(`\\b(?:${DONE_VERBS})\\b`, "i")

/**
 * Where a subject starts: after a clause mark or a word that starts a
 * clause ("as", "so", "that").
 */
const CLAUSE_BREAK =
  /[,:;–—](?=\s)|\b(?:as|because|since|so|and|but|or|while|that|which|when|after|before|once|if|then|though|although|unless|until|whereas)\b/gi
/** Where a destination ends: a mark ending a clause, or such a word. */
const DESTINATION_END =
  /[,:;–—.!?](?=\s|$)|\b(?:as|because|since|so|but|or|while|which|when|after|before|once|if|then|though|although|unless|whereas)\b/i

/** "no", "nothing", "none of the", directly governing the subject. */
const NEGATED_SUBJECT =
  /\b(?:no|nothing|none|nobody|neither|nor|no\s+one)\b((?:\s+[\w$.,…'’%#-]+){0,4}?)\s*$/i
/** Words that cannot sit inside a negated subject ("No action needed as"). */
const NOT_IN_SUBJECT =
  /\b(?:you|your|i|we|it|they|he|she|this|these|those|its|their|our|my|need|needed|needs|worry|worries|panic|problem|problems|issue|issues|action|fear|concern|reason|cause|doubt|question|true|false|wrong|change|changes)\b/i

/** What a passive verb is about, read from this turn's results. */
export type ClaimFigures = {
  /** A sourced amount with its token ("0.0608 BTC", "$86.40") in the text. */
  amount(text: string): boolean
  /** A sourced address ("0xc62b…3ffc") in the text. */
  address(text: string): boolean
  /** A sourced name or symbol the text starts with ("mUSDC", "SNF"). */
  place(text: string): boolean
}

/** Each sentence of a text, a semicolon ending one too. */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/;/g, ". ")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim().length > 0)
}

/** The text from the last clause break before `index` up to it. */
function subjectBefore(sentence: string, index: number): string {
  const before = sentence.slice(0, index)
  let start = 0
  for (const match of before.matchAll(CLAUSE_BREAK)) {
    start = match.index + match[0].length
  }
  return before.slice(start)
}

/** The text after `index` up to the end of its clause. */
function destinationAfter(sentence: string, index: number): string {
  const after = sentence.slice(index)
  const stop = after.search(DESTINATION_END)
  return stop === -1 ? after : after.slice(0, stop)
}

/** A negation that governs the subject: "No rewards were", "Nothing was". */
function negatedSubject(subject: string): boolean {
  const match = NEGATED_SUBJECT.exec(subject)
  if (match === null) return false
  return !NOT_IN_SUBJECT.test(match[1] ?? "")
}

const SECOND_PERSON = /\b(?:you|your|yours)\b/i

/**
 * Passive activity at one match: a description when what moved (the
 * subject) holds a sourced amount with its token or a sourced address, or
 * where it went holds a sourced address. Of the user's own funds, or a
 * vote or a transaction of theirs, only a sourced address will do, and a
 * "submitted", "cast" or "confirmed" of theirs never.
 */
function passiveIsClaim(
  sentence: string,
  match: RegExpMatchArray,
  figures: ClaimFigures,
): boolean {
  const at = match.index ?? 0
  const subject = subjectBefore(sentence, at)
  if (negatedSubject(subject)) return false
  const destination = destinationAfter(sentence, at + match[0].length)
  const yours = SECOND_PERSON.test(subject) || SECOND_PERSON.test(destination)
  if (yours && DONE_ONLY.test(match[0])) return true
  if (figures.address(destination) || figures.address(subject)) return false
  if (yours) return true
  if (!figures.amount(subject)) return true
  return unnamedPlace(destination, figures)
}

/** Where a passive move went: "to the recovery vault", "into CLPool". */
const PLACE =
  /^\s*(?:(?:then|also|later|back|on|over|onward|onwards|out|directly|straight|all)\s+)*(?:to|into|onto|at|towards?|in(?=\s+(?:the|a|an|its|their|this|that|your|his|her)\b))\s+(\S.*)$/i

/** Words before a place that do not change it: "its", "the", "13". */
const PLACE_LEAD =
  /^(?:(?:its|the|a|an|their|this|that|one|same[\s-]signers?|\d[\d,]*)\s+)*/i

/**
 * Stuart's own places, as its activity answers name them, each whole: a
 * Safe or a CLPool (by its address, which the address check reads), a
 * veBTC or veMEZO lock ("veBTC #6033", "13 veMEZO locks", "the veBTC
 * escrow"), the escrow, locks. Case matters: "a safe vault" is no Safe.
 */
const OWN_PLACE =
  /^(?:(?:[\w-]+\s+)?Safe|CLPool|ve(?:BTC|MEZO)(?:\s+(?:#\d+|escrow|locks?|lock\s+#\d+))?|[Ee]scrow|[Ll]ocks?)(?=\s*(?:$|0x|\())/

/**
 * A passive move with only an amount sourced that names where it went:
 * a claim unless the place is Stuart's own or a sourced name or symbol.
 */
function unnamedPlace(destination: string, figures: ClaimFigures): boolean {
  const place = PLACE.exec(destination)?.[1]?.trim()
  if (place === undefined || place === "") return false
  const bare = place.replace(PLACE_LEAD, "")
  return !OWN_PLACE.test(bare) && !figures.place(place)
}

/** Whether the text claims that Stuart, or anyone for the user, acted. */
export function claimsToHaveActed(
  text: string,
  figures: ClaimFigures,
): boolean {
  return sentencesOf(text).some((sentence) => {
    if (CLAIM_ALWAYS.some((claim) => claim.test(sentence))) return true
    if (YOUR_DONE.some((claim) => claim.test(sentence))) return true
    return PASSIVE_ACTIVITY.some((pattern) =>
      [...sentence.matchAll(pattern)].some((match) =>
        passiveIsClaim(sentence, match, figures),
      ),
    )
  })
}
