// The narrow form of a warning. An answer that names a secret (a seed
// phrase, a private key), a channel (a DM, Telegram) or a support-type
// person (a moderator, an admin, support) anywhere, Stuart's own knowledge
// sentences included, is a warning answer. In a warning answer every
// sentence must be a whole knowledge sentence or a warning sentence: each
// of its clauses is one of the forms below, and nothing else.
//
// The forms are a whitelist, not a list of bad words: a role, a verb or a
// place the forms do not name ("the community manager will collect it",
// "copy it into the recovery form") is refused because it is not a form,
// not because it is listed.
//
// - "Never share your seed phrase (with anyone | in a DM | again)"
// - "Treat the Telegram request as a scam", "A vault offered in a DM is a
//   common scam": the label's subject is a request, message, DM, link,
//   site, offer or the person asking, never an action ("keeping your seed
//   phrase from the moderator is a scam") or a state ("a wallet without
//   its seed phrase stored with support is exposed").
// - "Your seed phrase is exposed", "treat that wallet as compromised".
// - "Stuart never asks for your seed phrase", "Mezo support never DMs
//   first", "Nobody from Mezo will DM you first": the verb follows its
//   subject directly and the clause ends after a secret, "it", "first" or
//   a channel; no "to" plus a verb, no relative clause, no qualifier.
// - "Move your funds to a new wallet", "if you shared it, treat it as
//   exposed", "including Stuart", "this chat included".

/** A named secret. */
const SECRET_HEAD = String.raw`(?:seed\s*phrases?|seed\s+words|recovery\s*(?:phrases?|words)|secret\s+(?:recovery\s+)?(?:phrases?|keys?)|mnemonics?(?:\s+phrases?)?|private\s*keys?|pass\s*phrases?|keystores?(?:\s+files?)?|(?:12|24|twelve|twenty[\s-]four)[\s-]words?(?:\s+phrases?)?)`

/** Secrets and channels: an answer naming one is a warning answer. */
const SECRET = new RegExp(String.raw`\b${SECRET_HEAD}\b`, "i")

const CHANNEL: readonly RegExp[] = [
  /\bDMs?\b|\bdm['’]?(?:ed|d|s)?\b|\bdirect\s+messages?\b/i,
  /\b(?:telegram|whatsapp|wechat|viber|keybase)\b/i,
  /\bSignal\b|\b(?:on|via|over)\s+signal\b/,
  // Someone who will, may, can or should reach the user ("A recovery
  // specialist may contact you", "the security desk can reach out to help
  // you", "officers should get in touch"): Stuart never tells a user to
  // expect contact, so the answer is a warning answer and the sentence
  // must be in a warning form, which it is not.
  /(?<!\b(?:you|i|we)\s+)\b(?:will|would|may|might|can|could|should|shall|must|is\s+going\s+to|are\s+going\s+to|(?:is|are)\s+(?:able|happy|ready)\s+to)\s+(?:\w+\s+)?(?:(?:contact|message|call|dm|email|text|ping|phone|write\s+to)\s+(?:you|users?|holders?)|reach\s+out|get\s+in\s+(?:touch|contact)|follow\s+up\s+with\s+you)\b/i,
]

/**
 * A support-type person, as a scam speaks. "Support" counts as a person
 * only where it acts or is reached ("Mezo support takes questions",
 * "support never DMs", "contact support"), not as a topic ("loans and
 * Mezo support", "support notes") or the verb ("does not support").
 */
const SUPPORT_ACTS = `(?:will|would|never|takes?|asks?|asked|needs?|dms?|messages?|is|are|was|were|can|does|do|doesn['’]t|don['’]t|won['’]t|teams?|staff|agents?|reps?|representatives?|bots?|desks?)`
const SUPPORT_PERSON: readonly RegExp[] = [
  /\b(?:moderators?|mods?|(?:admins?|administrators?)(?!\s+(?:mode|panel|rights|access|privileges|permissions|role|override)\b)|help\s*desks?|helpdesks?|customer\s+service|ambassadors?|community\s+managers?|account\s+managers?|(?:security|recovery|help|wallet|account|verification|compliance)\s+(?:desks?|officers?|specialists?|teams?|staff|agents?|reps?|representatives?|bots?|experts?|advisors?|departments?))\b/i,
  new RegExp(String.raw`\bsupport\s+${SUPPORT_ACTS}\b`, "i"),
  /\b(?:contact(?:ing|ed)?|ask(?:ing|ed)?|from|via|through|with|reach|message|email|tell)\s+(?:the\s+)?(?:(?:mezo|matchbox|official|real|customer|tech(?:nical)?)\s+)?support\b(?!\s+(?:for|of|notes?|drafts?|docs?|pages?|topics?|questions?|articles?)\b)/i,
  /\bto\s+(?:mezo|matchbox|official|customer|tech(?:nical)?)\s+support\b(?!\s+(?:for|of|notes?|drafts?|docs?|pages?|topics?|questions?|articles?)\b)/i,
]

/** Whether an answer names a secret, a channel or a support-type person. */
export function isWarningAnswer(sentences: readonly string[]): boolean {
  return sentences.some(
    (sentence) =>
      SECRET.test(sentence) ||
      CHANNEL.some((pattern) => pattern.test(sentence)) ||
      SUPPORT_PERSON.some((pattern) => pattern.test(sentence)),
  )
}

// --- building blocks --------------------------------------------------------

const DET = String.raw`(?:your|a|an|the|that|this|any|those|these|its|my|their|such\s+an?|such|every|all)`

/** "Your seed phrase", "a private key or seed phrase", "keys". */
const SECRET_NP = String.raw`(?:${DET}\s+)?(?:(?:own|wallet['’]?s?|old|exposed)\s+)?(?:${SECRET_HEAD}|keys?|phrases?)`
const SECRET_LIST = String.raw`${SECRET_NP}(?:(?:\s*,\s*(?:or\s+|and\s+)?|\s+(?:or|and|nor)\s+)${SECRET_NP}){0,3}`

/** What a warning may say stands for the secret. */
const PRONOUN = String.raw`(?:it|them|one|this\s+one|that\s+one|either(?:\s+one)?|anything|any\s+of\s+(?:it|them))`

/** Funds, for "Do not send funds to an address from a DM". */
const FUNDS = String.raw`(?:${DET}\s+)?(?:funds|assets|btc|musd|mezo|tokens|crypto|money|coins|(?:ve(?:btc|mezo)\s+(?:or\s+ve(?:btc|mezo)\s+)?)?(?:locks?|nfts?|positions?))`

/** Things a scam sends, asks for or offers. */
const SCAM_MOD = String.raw`(?:telegram|whatsapp|discord|signal|dm|unsolicited|random|unexpected|recovery|verification|support|airdrop|yield|so-called|fake|similar|other|relay|eip-712|ve(?:btc|mezo)(?:\s+or\s+ve(?:btc|mezo))?|(?:the\s+)?(?:telegram\s+|discord\s+)?(?:admin|moderator|mod|support)['’]s)`
const SCAM_HEAD = String.raw`(?:requests?|messages?|dms?|direct\s+messages?|links?|sites?|websites?|pages?|offers?|vaults?|airdrops?|apps?|forms?|accounts?|senders?|nfts?|approvals?|permits?|transactions?|signatures?|calls?|emails?|texts?)`
const SCAM_NP = String.raw`(?:${DET}\s+)?(?:${SCAM_MOD}\s+){0,3}${SCAM_HEAD}`

/** Verbs a warning may forbid. */
const FORBID_VERB = String.raw`(?:share|send|give|enter|type|paste|reveal|post|reply\s+to|respond\s+to|trust|approve|sign|tell|click(?:\s+on)?|import|show|hand\s+over|hand|upload|submit|forward|screenshot|photograph|email|text|dm|message|open|use)`
const FORBID_VERBS = String.raw`${FORBID_VERB}(?:,?\s+(?:or|nor)\s+${FORBID_VERB}){0,3}`

/**
 * Keeping a backup: forbidding it alone is harmful advice ("Never store
 * your seed phrase anywhere", "Never write it down"), so a warning may
 * forbid it only where the backup would be exposed: online, in the cloud,
 * in a screenshot, a chat, an email or a phone's notes.
 */
const STORE_VERB = String.raw`(?:store|save|keep|back\s+up|write\s+down|write|copy|upload|sync)`
const STORE_VERBS = String.raw`${STORE_VERB}(?:,?\s+(?:or|nor)\s+${STORE_VERB}){0,2}`
const EXPOSED_PLACE = String.raw`(?:online|digitally|in\s+(?:the\s+)?cloud|(?:in|on|to)\s+(?:a|an|any|the|your)\s+(?:cloud(?:\s+(?:drive|storage|backup|service))?|screenshots?|photos?|pictures?|chats?|dms?|direct\s+messages?|emails?|texts?|text\s+files?|notes\s+apps?|google\s+docs?|websites?|sites?|clipboard)|on\s+your\s+phone(?:'s\s+notes)?|in\s+your\s+phone's\s+notes|in\s+(?:your\s+)?notes\s+app|as\s+(?:a\s+)?(?:screenshot|photo|picture))`

/** "Never store it online", "do not save your seed phrase in a screenshot". */
const STORE_FORBIDDEN = String.raw`${STORE_VERBS}(?:\s+(?:${SECRET_LIST}|${PRONOUN}|keys))?\s+(?:anywhere\s+)?${EXPOSED_PLACE}(?:\s*,?\s+(?:or|nor)\s+${EXPOSED_PLACE})*`

/** Who a warning may say not to share with: everyone, never a narrowed few. */
const ANYONE = String.raw`(?:anyone|anybody|anyone\s+at\s+all|any\s+(?:one|person|site|website|app|form|contract|address|chat|bot|wallet)|(?:a|any)\s+(?:site|website|app|form)\s+or\s+(?:contract|app|site|website|form)|stuart|mezo|matchbox|us|me|an?\s+address\s+from\s+an?\s+(?:dm|message|stranger|link))`
const TARGET = String.raw`(?:(?:with|to)\s+${ANYONE}|(?:to|with|into)\s+(?:that|this|the)\s+(?:address|site|website|link|vault|contract|app|form))`
const PLACE = String.raw`(?:in|into|on|over|via|by|through|from)\s+(?:(?:a|an|any|the|this)\s+)?(?:dms?|direct\s+messages?|chats?|messages?|sites?|websites?|forms?|apps?|calls?|emails?|telegram|whatsapp|discord|screenshots?|links?)`
const ADVERB = String.raw`(?:again|ever|anywhere|online|at\s+all|here|there|in\s+this\s+chat)`

/** People a warning may name as not asking, or as included. */
const OWN_SIDE = String.raw`(?:stuart|matchbox|mezo|mezo\s+support|matchbox\s+support|support|(?:real|genuine|official|legitimate)\s+(?:mezo\s+)?support|the\s+(?:mezo\s+|matchbox\s+)?team|moderators|mods|admins|us|me)`
const OWN_SIDE_LIST = String.raw`${OWN_SIDE}(?:(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)${OWN_SIDE}){0,3}`

const LABEL_SCAM = String.raw`(?:scams?|scammers?|fakes?|phishing|fraud(?:ulent)?|unsafe|malicious|a\s+trap)(?:\s+(?:pattern|tactic|trick))?`
const LABEL_EXPOSED = `(?:exposed|compromised|unsafe|burned|leaked)`
const QUAL = String.raw`(?:a|an|now|likely|probably|almost\s+certainly|certainly|definitely|already|clearly|fully|common|classic|known|typical|textbook|obvious)`
const COPULA = String.raw`(?:\s+(?:is|are|was|were|looks?\s+like|sounds?\s+like)|['’]s|['’]re)`

/** A secret or something holding one, as the subject of "is exposed". */
const KEY_NP = String.raw`(?:(?:${DET})\s+)?(?:(?:old|current|connected|exposed)\s+)?(?:${SECRET_HEAD}|wallet|account|address|keys?|phrases?|one)`
const KEY_SUBJECT = String.raw`(?:${KEY_NP}(?:\s+(?:and|or)\s+${KEY_NP})?|it|this\s+one|that\s+one)`

/** The asker as a subject: "any message asking for it", "anyone asking". */
const SCAM_POST = String.raw`(?:like\s+(?:this|that|these|those)(?:\s+one)?|to\s+(?:share|send|give|enter|type|paste|reveal|import)\s+(?:${SECRET_LIST}|${PRONOUN})|for\s+(?:${SECRET_LIST}|${PRONOUN})|asking\s+(?:for|you\s+to\s+(?:share|send|give|enter|type|paste))\s+(?:${SECRET_LIST}|${PRONOUN}|${FUNDS})|(?:offered|sent|received)?\s*(?:in|on|via|by|over|from)\s+(?:(?:a|an|the|any)\s+)?(?:dms?|direct\s+messages?|telegram|whatsapp|discord|messages?|strangers?|emails?|texts?))`
const SCAM_SUBJECT = String.raw`(?:${SCAM_NP}(?:\s+${SCAM_POST}){0,2}|(?:anyone|anybody|someone|whoever|the\s+person|the\s+account|the\s+sender)\s+asking(?:\s+for\s+(?:${SECRET_LIST}|${PRONOUN}))?|it|this|that|this\s+one|that\s+one)`

/** Verbs of asking, for the "never asks" form. */
const ASK_BASE = String.raw`(?:ask(?:\s+you)?|need|dm|message|contact|use|request|want|require|reach\s+out|store|see|hold|access|sign(?:\s+for\s+you)?)`
const ASK_THIRD = String.raw`(?:asks(?:\s+you)?|needs|dms|messages|contacts|uses|requests|wants|requires|reaches\s+out|stores|sees|holds|accesses|signs(?:\s+for\s+you)?)`
const ASK_ANY = `(?:${ASK_THIRD}|${ASK_BASE})`
const ASK_VERBS = String.raw`${ASK_ANY}(?:\s+(?:or|nor|and)\s+${ASK_ANY}){0,3}`
const NEVER = String.raw`(?:will\s+)?(?:never|(?:does|do|will|would|should|can)\s+not|cannot|(?:doesn|don|won|wouldn|shouldn|can)['’]?t)(?:\s+ever)?`
/** What a "never contacts you" clause may be about: "about rewards". */
const ASK_TOPIC = String.raw`(?:\s+about\s+(?:(?:your|a|the|any)\s+)?(?:rewards?|claims?|claiming|locks?|votes?|voting|funds|wallets?|accounts?|airdrops?|tokens?|refunds?|incidents?|positions?))`
const ASK_OBJECT = String.raw`(?:\s+to)?(?:\s+(?:you|users|anyone))?(?:\s+for)?(?:\s+(?:${SECRET_LIST}|${PRONOUN}|keys))?${ASK_TOPIC}?(?:\s+first)?(?:\s+(?:in|by|on|over|via)\s+(?:a\s+)?(?:dms?|direct\s+messages?|telegram|whatsapp|discord|email))?(?:\s+first)?`

/**
 * The one backup a warning may tell the user to make: on paper, or
 * offline ("write it on paper instead", "keep it offline").
 */
const PAPER_BACKUP_SOURCE = String.raw`(?:write(?:\s+down)?|keep|store|back\s+up)(?:\s+(?:${SECRET_LIST}|${PRONOUN}))?(?:\s+down)?\s+(?:on\s+(?:a\s+(?:piece\s+of\s+)?)?paper|offline)(?:\s+instead)?`

/** The paper or offline backup, found anywhere in a sentence. */
export const PAPER_BACKUP = new RegExp(
  String.raw`\b${PAPER_BACKUP_SOURCE}\b`,
  "gi",
)
const NOBODY = String.raw`(?:nobody|no\s+one|no\s+(?:real|legitimate|genuine|official)\s+(?:moderators?|mods?|admins?|support(?:\s+agents?)?|team\s+members?|person|one))(?:\s+(?:from|at)\s+(?:mezo|matchbox|support)(?:\s+(?:or|and)\s+(?:mezo|matchbox))?)?(?:\s+legitimate)?`

/** The one move of funds a warning may ask for. */
const MOVE = String.raw`move\s+(?:(?:all\s+(?:of\s+)?)?(?:your|its|the|any|that\s+wallet['’]s|this\s+wallet['’]s|the\s+wallet['’]s)\s+)?(?:remaining\s+)?(?:funds|assets|locks|tokens|coins|btc)(?:\s*(?:,|and|or)\s+(?:(?:your|its|the)\s+)?(?:funds|assets|locks|tokens|coins|btc|positions))*(?:\s+(?:out\s+of|from|off)\s+(?:that|this|the|your)\s+(?:exposed\s+|compromised\s+|old\s+)?(?:wallet|address|account))?\s+to\s+(?:a\s+)?(?:new|fresh|different|separate|clean|brand[\s-]new)\s+(?:wallet|one|address)(?:\s+(?:that\s+)?you\s+control)?(?:\s+(?:now|right\s+away|immediately|first|today|asap|soon|as\s+soon\s+as\s+(?:you\s+can|possible)))?`

const SHARED = `(?:shared|sent|gave|given|entered|typed|pasted|posted|revealed|exposed|leaked|showed|shown)`

/** A forbidden verb with its object and where: "send funds to that address". */
const FORBIDDEN = String.raw`${FORBID_VERBS}(?:\s+(?:${SECRET_LIST}|${PRONOUN}|${FUNDS}|${SCAM_NP}|keys))?(?:\s+(?:${TARGET}|${PLACE}|${ADVERB})){0,3}`

/** Every clause form a warning sentence may be built from. */
const CLAUSES: readonly string[] = [
  // "Never store your seed phrase online", "never save it in a screenshot".
  String.raw`(?:never|do\s+not|don'?t)(?:\s+ever)?\s+${STORE_FORBIDDEN}`,
  // "Never share your seed phrase with anyone", "Do not send funds to an
  // address from a DM", "never share or type it again".
  String.raw`(?:never|do\s+not|don['’]?t)(?:\s+ever)?\s+${FORBIDDEN}(?:\s+(?:or|nor)\s+${FORBIDDEN}){0,3}`,
  // "including Stuart", "even support", "this chat included".
  String.raw`(?:including|not\s+even|even)(?:\s+(?:to|with))?\s+${OWN_SIDE_LIST}`,
  String.raw`(?:this\s+chat|here|stuart)\s+included`,
  // "Treat the Telegram request as a scam".
  String.raw`(?:treat|consider|regard|report)\s+${SCAM_SUBJECT}\s+as\s+(?:${QUAL}\s+)*${LABEL_SCAM}`,
  // "Treat that key as compromised", "consider it exposed".
  String.raw`(?:treat|consider|regard)\s+${KEY_SUBJECT}(?:\s+as)?\s+(?:${QUAL}\s+)*${LABEL_EXPOSED}`,
  // "A vault offered in a DM is a common scam", "it's a scam".
  String.raw`${SCAM_SUBJECT}${COPULA}\s+(?:${QUAL}\s+)*${LABEL_SCAM}`,
  // "Your seed phrase is exposed", "that wallet is now compromised".
  String.raw`${KEY_SUBJECT}(?:${COPULA}|\s+(?:should|must)\s+be\s+treated\s+as|\s+(?:has|have)\s+been)\s+(?:${QUAL}\s+)*${LABEL_EXPOSED}`,
  // "Stuart never asks for your seed phrase", "support never DMs first".
  String.raw`(?:(?:since|because|as)\s+)?${OWN_SIDE_LIST}\s+${NEVER}\s+${ASK_VERBS}${ASK_OBJECT}`,
  // "Nobody from Mezo will DM you first".
  String.raw`${NOBODY}\s+(?:(?:will|would|should)\s+(?:ever\s+)?${ASK_BASE}|(?:ever\s+)?${ASK_THIRD})(?:\s+(?:or|nor|and)\s+${ASK_ANY}){0,3}${ASK_OBJECT}`,
  // "Move your funds to a new wallet".
  MOVE,
  // "Write it on paper instead", "keep it offline": the one backup advice.
  PAPER_BACKUP_SOURCE,
  // "If you shared it anywhere", "if it was posted".
  String.raw`(?:if|since|because|as)\s+(?:you(?:['’]ve|\s+have|\s+already)?\s+(?:already\s+)?${SHARED}|(?:${SECRET_LIST}|${PRONOUN})\s+(?:was|were|has\s+been|have\s+been|is)\s+(?:already\s+)?${SHARED})(?:\s+(?:${SECRET_LIST}|${PRONOUN}))?(?:\s+(?:anywhere|with\s+anyone|online|here|in\s+(?:this\s+)?chat|already|before|publicly|in\s+(?:a\s+)?dms?)){0,2}`,
]

/** What separates two clauses of a warning sentence. */
const SEPARATOR = String.raw`(?:\s*[,:\u2014\u2013]\s*(?:(?:and\s+then|and|so|then)\s+)?|\s+(?:and\s+then|and|so|then)\s+|\s+-\s+|\s+(?=(?:if|since|because)\b))`

const END = `(?=${SEPARATOR}|$)`

const CLAUSE_PATTERNS: readonly RegExp[] = CLAUSES.map(
  (source) => new RegExp(`(?:${source})${END}`, "iy"),
)
const SEPARATOR_PATTERN = new RegExp(SEPARATOR, "iy")

/** Normalised for the forms: straight quotes, single spaces, no end mark. */
function normal(sentence: string): string {
  return sentence
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .trim()
}

/**
 * Whether a sentence is a warning in the narrow form: clauses of the forms
 * above, joined by commas, colons, "and", "so" or "then", and nothing
 * else. Clause starts are tried left to right; each start is tried once,
 * so the check is linear in the sentence's length.
 */
export function isWarningSentence(sentence: string): boolean {
  const text = normal(sentence)
  if (text.length === 0) return true
  const tried = new Set<number>()
  const starts = [0]
  while (starts.length > 0) {
    const at = starts.pop() ?? 0
    if (tried.has(at)) continue
    tried.add(at)
    for (const pattern of CLAUSE_PATTERNS) {
      pattern.lastIndex = at
      const clause = pattern.exec(text)
      if (clause === null) continue
      const end = at + clause[0].length
      if (end === text.length) return true
      SEPARATOR_PATTERN.lastIndex = end
      const separator = SEPARATOR_PATTERN.exec(text)
      if (separator !== null && separator[0].length > 0) {
        starts.push(end + separator[0].length)
      }
    }
  }
  return false
}

/**
 * Words that make an exception to a warning or narrow who is unsafe:
 * "anyone but the moderator", "unofficial moderators", "in public
 * channels", "anyone you cannot verify".
 */
export const WARNING_EXCEPTION =
  /\b(?:except|excepting|excluding|but|unless|other\s+than|only|instead|rather|else|exception|besides|apart\s+from|aside\s+from|save\s+for|anyone\s+who|someone\s+who|those\s+who|people\s+who|unofficial|unverified|unknown|public|publicly|strangers?|(?:anyone|anybody|someone|people|those)\s+you\b)/i

/**
 * Handing over a signature, a signed transaction, a screenshot, a QR or a
 * code: never advice, in any answer. A transaction hash is not one.
 */
export const SHARE_ARTIFACT =
  /\b(?<!(?:never|not|n't)\s+)(?:share|send|give|show|forward|post|paste|upload)\s+(?:(?:the|your|this|that|a|an|its)\s+)?(?:signed\s+)?(?:[\w-]+\s+)?(?:signatures?|signed\s+(?:transactions?|messages?|data)|(?:raw\s+)?transactions?(?!\s+hash)|txs?(?!\s+hash)|screenshots?|qr(?:\s+codes?)?|codes?|otps?|2fa|pins?|seeds?)(?:\s+[\w-]+){0,4}?\s+(?:with|to)\b/i
