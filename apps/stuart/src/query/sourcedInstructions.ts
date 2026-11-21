import { MEZO_KNOWLEDGE } from "./knowledge/mezo"
import { sentencesOf } from "./sourcedClaims"
import {
  isWarningAnswer,
  isWarningSentence,
  PAPER_BACKUP,
  SHARE_ARTIFACT,
  WARNING_EXCEPTION,
} from "./sourcedWarnings"

// Instructions in plain words, in a model sentence. A sentence with no
// figure and no link can still steer a user into losing funds ("Send your
// seed phrase to support", "Approve the transaction in your wallet now").
// Text typed by the user or planted on chain can make the model write one,
// shown in Stuart's voice.
//
// Stuart's own words are spared only whole: a sentence equal to a whole
// sentence of a knowledge note, or an answer equal to this turn's template
// (`own`). A fragment is not: "Approve your veBTC or veMEZO NFT to any
// site or contract." is cut from "Do not approve ...", and a template
// that prints a gauge's name holds whatever the name says.
//
// A warning answer (one naming a secret, a channel or a support-type
// person anywhere, Stuart's own sentences included) may hold only whole
// knowledge sentences and sentences of the narrow warning form
// (sourcedWarnings.ts), with no exception and no narrowing qualifier.

/** A handle: never shown, warning or not. */
const HANDLE = /(?<![\w.])@[A-Za-z0-9_]{2,}\b/

/** Urgency, said to push a user into acting before thinking. */
const URGENCY =
  /\b(?:at\s+risk|compromised|flagged|suspended|frozen|blocked|locked\s+out|act\s+now|immediately|urgent(?:ly)?|right\s+away|asap|before\s+it(?:['’]s|\s+is)\s+too\s+late|within\s+\d+\s+(?:minutes?|hours?))\b/i

/**
 * Expiry is urgency only when said of the user's own lock, wallet or
 * approval ("your lock expires today"), not in an explanation ("withdraw
 * BTC from an expired lock").
 */
const YOUR_EXPIRY =
  /\byour\s+(?:[\w-]+\s+){0,2}?(?:locks?|wallets?|approvals?|allowances?|permissions?|sessions?|access|accounts?|keys?)\s+(?:(?:has|have|had|is|are|was|were|will|shall)\s+)?(?:(?:already|about\s+to|soon|now|just|be)\s+)*(?:expire[sd]?|expiring)\b/i

/**
 * Moving the user's own funds or permissions: "move your funds", "revoke
 * all approvals", "transfer your lock". "Transfer the lock" in an
 * explanation of what an approval allows is not one.
 */
const FUND_ACTION =
  /\b(?:move|transfer|send|approve|revoke|connect|reconnect|verify|validate|sync|migrate|withdraw|unstake|bridge)\s+(?:all\s+(?:of\s+)?)?(?:(?:your|my)\s+(?:\w+\s+)?)?(?:wallets?|funds?|locks?|tokens?|assets?|btc|musd|mezo|ve(?:btc|mezo)|approvals?|permissions?|allowances?|positions?|collateral|balances?|nfts?|everything)\b/gi

/** A negation just before an action, in its clause: "Do not", "never". */
const NEGATED_BEFORE =
  /\b(?:do\s+not|don['’]t|never|cannot|can['’]t|won['’]t|no\s+need\s+to|not)\s+(?:\w+\s+){0,2}$/i

/**
 * Where an imperative starts: a clause, after an optional softener. "And"
 * in "review and sign" joins two verbs of one clause.
 */
const CLAUSE_START = [
  "(?:^|[,:\\x3b]\\s+|(?<!\\breview\\s)\\b(?:and|then|so)\\s+)",
  "(?:(?:please|just|now|first|next|also|then|simply|quickly|kindly|go\\s+ahead\\s+and|make\\s+sure\\s+(?:to|you)|be\\s+sure\\s+to|remember\\s+to|you\\s+(?:can|should|must|need\\s+to|have\\s+to|may\\s+need\\s+to|will\\s+need\\s+to))\\s+)*",
].join("")

/**
 * Telling the user to sign or approve: Stuart's own flow once it has
 * prepared an unsigned proposal this turn ("Review and sign in your
 * wallet"), an instruction from someone else otherwise.
 */
const SIGN_IMPERATIVE = new RegExp(
  `${CLAUSE_START}((?:review\\s+and\\s+)?(?:approve|sign|authori[sz]e)\\b)`,
  "gi",
)

/**
 * The only signing step Stuart's own flow asks for, after it prepared a
 * proposal, whole up to the end of its clause: "Review and sign in your
 * wallet", "sign it in your wallet", "approve the claim in your own
 * wallet", "review and sign the proposal to continue", "review and sign in
 * the proposal card". Its object, if any, is the proposal; nothing follows
 * it but a purpose ("to submit", "to cast it").
 */
const OWN_SIGN_STEP =
  /^(?:review\s+(?:it\s+)?and\s+)?(?:sign|approve)(?:\s+(?:it|this|them|(?:the|your|this)\s+(?:[\w-]+\s+){0,2}?(?:vote|votes|ballot|claim|claims|transaction|proposal|repayment|zap|deposit)))?(?:\s+(?:in|with|from|on)\s+(?:your\s+(?:own\s+|connected\s+)?wallet|the\s+(?:proposal\s+)?card))?(?:\s+to\s+(?:submit|vote|continue|finali[sz]e|finish|apply|cast|claim|confirm|send|complete|take\s+effect)(?:\s+(?:it|them|the\s+(?:vote|ballot|claim|proposal)))?(?:\s+in\s+your\s+(?:own\s+|connected\s+)?wallet)?)?(?:\s+(?:with|in)\s+(?:one|a\s+single)\s+signature)?(?=\s*(?:$|[.!,:;)]))/i

/**
 * What Stuart's own signing step is never said with, in its clause: an
 * NFT, a lock token, an allowance or a spender, or a target it goes to.
 */
const SIGN_FORBIDDEN: readonly RegExp[] = [
  /\b(?:nfts?|ve(?:btc|mezo)|allowances?|unlimited|routers?|helpers?|permits?|setapprovalforall|operators?|spenders?|for\s+all)\b/i,
  /\b[Tt]o\s+(?:0x|@|(?:[Tt]he|[Aa]n?|[Tt]his|[Tt]hat|[Aa]ny|[Mm]y|[Oo]ur|[Tt]heir)\s|[A-Z])/,
]

/** Where a clause ends after a signing step: a mark or a new clause. */
const SIGN_CLAUSE_END = /[,:;–—]|\b(?:so|then|and|but|while|because)\b/i

/**
 * Telling the user to connect, verify, validate, migrate or sync, or to
 * claim at a place. "Connect or watch a wallet", the app's own way in,
 * is not one.
 */
const IMPERATIVE = new RegExp(
  `${CLAUSE_START}(?:connect(?!\\s+(?:or\\s+watch\\s+)?(?:(?:a|this|your|the)\\s+(?:[\\w-]+\\s+)?wallet|one)\\b(?![^.]*\\b(?:at|via|verify|validate|sync|migrate|restore|recover)\\b))|re-?connect|verify|validate|migrate|sync|re-?sync|claim\\s+(?:it\\s+|them\\s+|your\\s+\\w+\\s+)?(?:at|on|via|through)\\b)\\b`,
  "i",
)

/**
 * The one move of funds a warning may ask for, read from the verb: "move
 * your funds to a new wallet", "move its funds and locks to a fresh one".
 */
const ALLOWED_MOVE =
  /^move\s+(?:(?:all\s+(?:of\s+)?)?(?:your|its|the|any|that\s+wallet['’]s|this\s+wallet['’]s|the\s+wallet['’]s)\s+)?(?:remaining\s+)?(?:funds|assets|locks|tokens|coins|btc)(?:\s*(?:,|and|or)\s+(?:(?:your|its|the)\s+)?(?:funds|assets|locks|tokens|coins|btc|positions))*(?:\s+(?:out\s+of|from|off)\s+(?:that|this|the|your)\s+(?:exposed\s+|compromised\s+|old\s+)?(?:wallet|address|account))?\s+to\s+(?:a\s+)?(?:new|fresh|different|separate|clean|brand[\s-]new)\s+(?:wallet|one|address)(?:\s+(?:that\s+)?you\s+control)?(?:\s+(?:now|right\s+away|immediately|first|today|asap|soon|as\s+soon\s+as\s+(?:you\s+can|possible)))?\s*(?=$|[.!;,:)]|\s+and\s)/i

/**
 * What keeps a warning answer's own sentences (knowledge sentences left
 * out) from the narrow form, for the log: an exception or a narrowing
 * qualifier, or which sentence is not a warning, by its place and length.
 * Never the sentence's words: a phrase split across sentences ("not a
 * warning: abandon ability ...", six words each) would reach the log a
 * piece at a time, each piece too short to redact.
 */
function warningProblems(sentences: readonly string[]): string[] {
  const problems: string[] = []
  sentences.forEach((sentence, index) => {
    // "Write it on paper instead": the backup advice is no exception.
    const exception = WARNING_EXCEPTION.exec(
      sentence.replace(PAPER_BACKUP, " "),
    )
    if (exception) problems.push(exception[0])
    else if (!isWarningSentence(sentence)) {
      problems.push(
        `not a warning: sentence ${index + 1}, ${sentence.trim().length} characters`,
      )
    }
  })
  return problems
}

/** Whether a fund action starts the one move a warning may ask for. */
function allowedMoveAt(text: string, index: number): boolean {
  return ALLOWED_MOVE.test(text.slice(index))
}

/**
 * A sign or approve imperative after a proposal was prepared: Stuart's
 * own step only in its own words, never with an NFT, an allowance or a
 * target in its clause.
 */
function ownSignStep(sentence: string, verbAt: number): boolean {
  const from = sentence.slice(verbAt)
  const step = OWN_SIGN_STEP.exec(from)
  if (step === null) return false
  const end = from.slice(step[0].length).search(SIGN_CLAUSE_END)
  const clause = end === -1 ? from : from.slice(0, step[0].length + end)
  return !SIGN_FORBIDDEN.some((pattern) => pattern.test(clause))
}

// --- Stuart's own words -----------------------------------------------------

function normal(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .trim()
    .toLowerCase()
}

/** Every sentence of Stuart's knowledge notes, normalised, whole. */
const KNOWLEDGE_SENTENCES: ReadonlySet<string> = new Set(
  MEZO_KNOWLEDGE.flatMap((entry) => [entry.answer, ...entry.detail])
    .flatMap((line) => sentencesOf(line))
    .map(normal)
    .filter((sentence) => sentence.length > 0),
)

/** A sentence equal to a whole sentence of a knowledge note. */
export function isKnowledgeSentence(sentence: string): boolean {
  return KNOWLEDGE_SENTENCES.has(normal(sentence))
}

/**
 * The plain-words instructions in a model answer, as written, for the
 * log: a secret named, a contact channel or handle, urgency with funds or
 * permissions, or an imperative to approve, sign, connect, verify,
 * validate, migrate or sync, or to claim at a place.
 *
 * - A sentence equal to a whole sentence of a knowledge note is left out;
 *   an answer equal to one of `own` (this turn's template, given only when
 *   the model reused it whole) is left alone. Fragments are checked.
 * - An answer naming a secret, a channel or a support-type person
 *   anywhere is a warning answer: its own sentences must each be in the
 *   narrow warning form (warningProblems).
 * - Handing over a signature, a signed transaction, a screenshot, a QR
 *   or a code is never advice.
 * - To sign or approve is Stuart's own flow only when this turn prepared
 *   an unsigned proposal (`prepared`), and then only as "review and sign
 *   in your wallet" or "sign it in your wallet", with no NFT, allowance or
 *   target.
 */
export function plainInstructions(
  text: string,
  own: readonly string[] = [],
  options: { prepared?: boolean } = {},
): string[] {
  const whole = normal(text)
  if (whole.length > 0 && own.some((line) => normal(line) === whole)) {
    return []
  }
  const found: string[] = []
  const sentences = sentencesOf(text)
  const checked = sentences.filter((each) => !isKnowledgeSentence(each))
  const handle = HANDLE.exec(checked.join(" "))
  if (handle) found.push(handle[0])
  // Whether the answer is a warning is read from every sentence, Stuart's
  // own included: a knowledge sentence never switches the rule off for
  // the sentences beside it.
  const warning = isWarningAnswer(sentences)
  if (warning) found.push(...warningProblems(checked))
  for (const sentence of checked) {
    const artifact = SHARE_ARTIFACT.exec(sentence)
    if (artifact) found.push(artifact[0].trim())
    const imperative = IMPERATIVE.exec(sentence)
    if (imperative) found.push(imperative[0].trim())
    for (const sign of sentence.matchAll(SIGN_IMPERATIVE)) {
      const verbAt = sign.index + sign[0].length - (sign[1]?.length ?? 0)
      if (options.prepared === true && ownSignStep(sentence, verbAt)) continue
      found.push(sign[0].trim())
    }
  }
  // Urgency and the action it pushes may sit in two sentences ("Your lock
  // is at risk. Move your funds."): read across the answer. Urgency counts
  // from every sentence, Stuart's own included; the action only from the
  // model's own.
  const everything = sentences.join(" ")
  const urgency = URGENCY.exec(everything) ?? YOUR_EXPIRY.exec(everything)
  const rest = checked.join(" ")
  // A warning is not an instruction: "Do not approve your veBTC NFT". In a
  // warning, moving funds to a new wallet is the advice, not the threat.
  const action = [...rest.matchAll(FUND_ACTION)].find(
    (match) =>
      !NEGATED_BEFORE.test(rest.slice(0, match.index)) &&
      !(warning && allowedMoveAt(rest, match.index)),
  )
  if (urgency && action) found.push(`${urgency[0]}: ${action[0]}`)
  return found
}
