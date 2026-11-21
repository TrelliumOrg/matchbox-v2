// Stuart's Mezo support knowledge: short, reviewed facts and how-tos, each
// with the sources it was checked against. Bundled and versioned so every
// answer is reproducible; bump the version when an entry changes.
//
// Rules for entries:
// - `answer` is what Stuart says when this entry is the best match: at most
//   two sentences, terse, no em or en dashes, middle dots or semicolons.
// - Every number in `answer` appears in one of `facts` (the sourced check
//   holds template answers to their facts). A test enforces both rules.
// - `keywords` are lower-case phrases a user would type.
// Most notes live in packages/docs/content beside the page they explain.

import { docsKnowledge, docsKnowledgeVersion } from "@matchbox/docs/knowledge"
import { pastedKey, pastedPhrase } from "../secretShapes"
import { ownHost } from "../sourcedText"

export { longestWordRun, pastedKey, pastedPhrase } from "../secretShapes"

// The docs half carries its own content hash, so a docs edit changes this.
export const MEZO_KNOWLEDGE_VERSION = `2026-11-19.5+${docsKnowledgeVersion}`
export const MEZO_KNOWLEDGE_CHECKED_AT = "2026-11-10T00:00:00.000Z"

export type KnowledgeSource = { label: string; url: string }

export type KnowledgeEntry = {
  id: string
  title: string
  answer: string
  detail: string[]
  facts: Array<{ label: string; display: string }>
  keywords: string[]
  sources: KnowledgeSource[]
}

const DOCS = "https://mezo.org/docs/users"

const SOURCES = {
  vote: { label: "Mezo docs: Voting", url: `${DOCS}/mezo-earn/vote/` },
  howToVote: {
    label: "Mezo docs: How to vote",
    url: `${DOCS}/mezo-earn/vote/how-to-vote/`,
  },
  voteFaq: {
    label: "Mezo docs: Vote FAQs",
    url: `${DOCS}/mezo-earn/vote/claiming-fees-emissions/`,
  },
  vebtc: { label: "Mezo docs: veBTC", url: `${DOCS}/mezo-earn/lock/vebtc/` },
  vebtcManage: {
    label: "Mezo docs: Managing veBTC locks",
    url: `${DOCS}/mezo-earn/lock/vebtc/managing-locks-and-collecting-rewards/`,
  },
  vemezo: { label: "Mezo docs: veMEZO", url: `${DOCS}/mezo-earn/lock/vemezo/` },
  vemezoFaq: {
    label: "Mezo docs: veMEZO FAQs",
    url: `${DOCS}/mezo-earn/lock/vemezo/faqs-and-resources/`,
  },
  boost: {
    label: "Mezo docs: Boost mechanism",
    url: `${DOCS}/mezo-earn/lock/vemezo/boost-mechanism/`,
  },
  mezoGauges: {
    label: "Mezo docs: MEZO gauges",
    url: `${DOCS}/mezo-earn/vote/mezo-gauges/`,
  },
  mezoGaugesVote: {
    label: "Mezo docs: Voting on MEZO gauges",
    url: `${DOCS}/mezo-earn/vote/mezo-gauges/how-to-vote/`,
  },
  borrowMusdc: {
    label: "Mezo docs: Borrow mUSDC",
    url: `${DOCS}/borrow/how-to-borrow-musdc/`,
  },
  musd: { label: "Mezo docs: MUSD", url: `${DOCS}/borrow/` },
  liquidations: {
    label: "Mezo docs: MUSD liquidations",
    url: `${DOCS}/borrow/liquidation-mechanics/`,
  },
  enclaves: {
    label: "Mezo docs: Enclaves",
    url: `${DOCS}/mainnet/enclaves/`,
  },
  savings: {
    label: "Mezo docs: MUSD Savings Vault",
    url: `${DOCS}/mezo-earn/vaults/musd-savings-vault/`,
  },
  getGas: {
    label: "Mezo docs: Get Gas",
    url: `${DOCS}/getting-started/get-gas/`,
  },
  support: {
    label: "Mezo docs: Support",
    url: `${DOCS}/resources/support/`,
  },
  incident: {
    label: "Mezo: Incident report, 5 Oct 2026",
    url: "https://mezo.org/blog/incident-report-october-5-2026",
  },
  boostVoter: {
    label: "BoostVoter contract (verified)",
    url: "https://explorer.mezo.org/address/0x2Ba614a598Cffa5a19d683cDCA97bac3a49313d1?tab=contract",
  },
  thirdPartyVoter: {
    label: "ThirdPartyVoter contract",
    url: "https://explorer.mezo.org/address/0x2e6D2F2CaCC1d24F9f9358030674eB307397A6EB?tab=contract",
  },
  vebtcContract: {
    label: "veBTC VotingEscrow (verified)",
    url: "https://explorer.mezo.org/address/0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279?tab=contract",
  },
  troveManager: {
    label: "MUSD TroveManager",
    url: "https://explorer.mezo.org/address/0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193",
  },
  morpho: {
    label: "Morpho Blue on Mezo",
    url: "https://explorer.mezo.org/address/0x565834cE7E40b8987BC20EbF83E2159467bDA311",
  },
  voteMezo: {
    label: "mezo.org: Vote on MEZO gauges",
    url: "https://mezo.org/earn/vote/mezo",
  },
  vemezoUnlock: {
    label: "Mezo docs: veMEZO FAQs (no early unlock)",
    url: `${DOCS}/mezo-earn/lock/vemezo/faqs-and-resources/`,
  },
  locks: {
    label: "Matchbox docs: Locks (transfer keeps the votes)",
    url: "https://docs.matchbox.markets/concepts/locks#transfer",
  },
} satisfies Record<string, KnowledgeSource>

/**
 * Notes about Stuart, Mezo safety and support that have no docs page yet.
 * Every other note is written beside its concept page in packages/docs and
 * arrives generated as `docsKnowledge`. Move a note there once a page
 * covers it, and the uniqueness test stops it being in both.
 */
const STUART_ONLY_NOTES: readonly KnowledgeEntry[] = [
  {
    id: "safety.approve",
    title: "Never approve a veNFT",
    answer:
      "Do not approve your veBTC or veMEZO NFT to any site or contract. ERC-721 approval gives custody: the approved address can transfer the lock and withdraw an expired lock's BTC, so vote from your own wallet.",
    detail: [
      "approve and setApprovalForAll both grant it, including merge, split and permanent-lock rights.",
      "No Mezo or Matchbox flow needs an NFT approval to vote.",
    ],
    facts: [{ label: "ERC-721 approval", display: "ERC-721 approval" }],
    keywords: [
      "approve",
      "approval",
      "setapprovalforall",
      "approve my lock",
      "approve my vebtc",
      "vote for me",
      "vote on my behalf",
      "delegate",
      "is it safe",
      "is that ok",
      "is this safe",
      "give my lock",
      "give my vebtc",
      "give my vemezo",
      "hand over my lock",
      "scam",
      "give access",
      "permission",
      "manager",
    ],
    sources: [SOURCES.vebtcContract, SOURCES.incident],
  },
  {
    id: "safety.secrets",
    title: "Never share a seed phrase or key",
    answer:
      "Stuart, Matchbox and Mezo never ask for a seed phrase or private key, and support never DMs first, so treat any message asking for one as a scam. If you shared a key or phrase anywhere, this chat included, treat it as exposed and move your funds to a new wallet.",
    detail: [
      "Stuart never needs a key: it prepares unsigned proposals that you sign in your own wallet.",
      "Nobody from Mezo or Matchbox will DM you first.",
      "To reach Mezo support, open a ticket yourself in the Discord linked at the foot of mezo.org.",
    ],
    facts: [],
    keywords: [
      "seed phrase",
      "my seed phrase",
      "recovery phrase",
      "secret phrase",
      "secret recovery phrase",
      "private key",
      "my private key",
      "here is my private key",
      "mnemonic",
      "12 words",
      "24 words",
      "telegram",
      "dm",
      "dms",
      "dmed",
      "dm'd",
      "dmd",
      "direct message",
      "whatsapp",
      "messaged me",
      "contacted me",
      "reached out",
      "support contacted me",
      "support messaged me",
      "scam",
      "phishing",
    ],
    sources: [SOURCES.support],
  },
  {
    id: "safety.phrase_holder",
    title: "Someone you know has your phrase",
    answer:
      "Anyone who has your recovery phrase controls the funds in that wallet. If someone else should not have that control, move your funds to a new wallet with a new recovery phrase.",
    detail: ["Stuart, Matchbox and Mezo never ask for a recovery phrase."],
    facts: [],
    keywords: [
      "has my seed phrase",
      "has my recovery phrase",
      "knows my seed phrase",
      "gave my seed phrase to my",
      "gave my recovery phrase to my",
    ],
    sources: [SOURCES.support],
  },
  {
    id: "safety.redirect",
    title: "Never claim on another site",
    answer:
      "Claim, vote and relock only on matchbox.markets or mezo.org, opened yourself, never through a link, site or contract someone sends you. Stuart never sends a transaction: it prepares one, and you check and sign it in your own wallet.",
    detail: [
      "Rewards do not move because someone messages you.",
      "Any real change to rewards shows on matchbox.markets and mezo.org, opened yourself.",
    ],
    facts: [],
    keywords: [
      "their contract",
      "their site",
      "their app",
      "their link",
      "this site",
      "new contract",
      "v2 contract",
      "claim at",
      "claim on their",
      "migrate",
      "moved to",
    ],
    sources: [SOURCES.support],
  },
  {
    id: "safety.drained",
    title: "A drained wallet",
    answer:
      "Treat a wallet that lost funds after you signed something as compromised: move what is left to a new wallet with a new recovery phrase, not a new account in the same wallet. No one can recover drained funds for a fee, so ignore any recovery offer or link.",
    detail: [
      "A signed approval or permit can let another address move your tokens or NFTs until it is revoked.",
      "Check approvals in your wallet's own settings or in a tool you already trust, never through a link someone sends you.",
      "If your recovery phrase or key leaked, gas sent to that wallet can be taken as soon as it arrives.",
      "A veBTC or veMEZO lock can be transferred to another wallet with its votes in place.",
      "The BTC or MEZO in a lock cannot be withdrawn before the lock expires.",
      "If a lock will not transfer, ask in a Mezo support ticket you open yourself.",
    ],
    facts: [],
    keywords: [
      "drained",
      "got drained",
      "wallet drained",
      "revoke approvals",
      "revoke approval",
    ],
    // Four at most: an answer shows six evidence items across its notes.
    sources: [
      SOURCES.support,
      SOURCES.incident,
      SOURCES.locks,
      SOURCES.vemezoUnlock,
    ],
  },
  {
    id: "safety.meta_tx",
    title: "Meta-transactions are disabled",
    answer:
      "Mezo disabled meta-transactions on 5 Oct 2026 after the veBTC exploit, so relayed or gasless votes through a forwarder no longer work. Send votes from your own wallet and pay gas in BTC.",
    detail: ["Never sign an EIP-712 relay request for a vote."],
    facts: [{ label: "Meta-transactions disabled", display: "5 Oct 2026" }],
    keywords: [
      "relayer",
      "relay",
      "gasless",
      "meta-transaction",
      "meta-transactions",
      "meta transaction",
      "metatransaction",
      "forwarder",
      "without paying gas",
      "without gas",
      "sponsored",
      "eip-712",
      "pay gas",
    ],
    sources: [SOURCES.incident],
  },
  {
    id: "safety.incident",
    title: "The 5 Oct 2026 incident",
    answer:
      "On 5 Oct 2026 an attacker used veBTC's forwarder support to move 37 positions, about 5.52 BTC. Mezo fixed it, disabled meta-transactions and repays affected wallets directly, so ignore any recovery links.",
    detail: ["Updates come only from Mezo's official X profile and blog."],
    facts: [
      { label: "Date", display: "5 Oct 2026" },
      { label: "Positions moved", display: "37" },
      { label: "Taken", display: "5.52 BTC" },
    ],
    keywords: [
      "exploit",
      "hack",
      "hacked",
      "incident",
      "stolen",
      "lost my vebtc",
      "recovery",
      "refund",
      "repaid",
    ],
    sources: [SOURCES.incident],
  },
  {
    id: "earn.savings",
    title: "MUSD Savings Vault",
    answer:
      "The MUSD Savings Vault takes MUSD and returns sMUSD, whose exchange rate grows weekly from MUSD protocol fees. Staking sMUSD in its gauge swaps that yield for MEZO emissions.",
    detail: ["No withdrawal fee or time lock."],
    facts: [],
    keywords: [
      "savings",
      "smusd",
      "savings vault",
      "musd savings",
      "savings rate",
    ],
    sources: [SOURCES.savings],
  },
  {
    id: "earn.no_guarantee",
    title: "Returns are not guaranteed",
    answer:
      "No vote return is guaranteed. APY is extrapolated from this epoch's incentives and votes, and both change every epoch as others vote and add incentives.",
    detail: [
      "Incentives split pro rata, so more votes on a gauge pay each voter less.",
    ],
    facts: [],
    keywords: [
      "guarantee",
      "guaranteed",
      "guarantees",
      "guarantee me",
      "guaranteed apy",
      "guaranteed return",
      "apy",
      "promise",
      "risk free",
      "risk-free",
      "sure return",
      "fixed apy",
    ],
    sources: [SOURCES.vote],
  },
  {
    id: "network.gas",
    title: "Gas on Mezo",
    answer:
      "Gas on Mezo is paid in BTC. The app's Get Gas swap ran on meta-transactions, which Mezo disabled on 5 Oct 2026, so keep a little BTC for gas.",
    detail: [],
    facts: [{ label: "Meta-transactions disabled", display: "5 Oct 2026" }],
    keywords: ["gas", "get gas", "out of gas", "no btc for gas", "gas fee"],
    sources: [SOURCES.getGas, SOURCES.incident],
  },
  {
    id: "support.contact",
    title: "Contacting Mezo support",
    answer:
      "For Mezo issues, open a ticket in Mezo's Discord: ask a moderator for the open-ticket role, then give your wallet address and transaction hash. Matchbox issues can be reported from Stuart.",
    detail: [],
    facts: [],
    keywords: [
      "contact",
      "support",
      "help desk",
      "ticket",
      "discord",
      "talk to someone",
      "human",
    ],
    sources: [SOURCES.support],
  },
]

/** The docs notes first, so a shared id would be the docs wording. */
export const MEZO_KNOWLEDGE: readonly KnowledgeEntry[] = [
  ...docsKnowledge,
  ...STUART_ONLY_NOTES,
]

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "my",
  "i",
  "to",
  "of",
  "on",
  "in",
  "for",
  "and",
  "or",
  "it",
  "do",
  "does",
  "how",
  "what",
  "why",
  "can",
  "with",
  "me",
  "this",
  "that",
])

function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9:%.\-' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return haystack.includes(` ${phrase} `) || haystack.includes(` ${phrase}?`)
}

export type KnowledgeMatch = { entry: KnowledgeEntry; score: number }

const DOCS_ORIGIN = "https://docs.matchbox.markets"

/**
 * The docs page a note is written on, or null for a Stuart-only note. The
 * generator cites that page as each docs note's first source.
 */
export function knowledgePage(entry: KnowledgeEntry): string | null {
  const url = entry.sources[0]?.url ?? ""
  if (!url.startsWith(`${DOCS_ORIGIN}/`)) return null
  return url.slice(DOCS_ORIGIN.length).split("#")[0] ?? null
}

/**
 * A message Stuart answers from its safety notes, never with a claim, a
 * vote or a signing step: one that names a secret ("my seed phrase"),
 * pastes one (a 64-character hex key, a 12 to 24 word phrase), reports
 * unsolicited contact ("someone DMed me"), a wallet drained after a
 * signature ("my wallet got drained") or a request for a secret or a
 * risky step ("support asked for my words", "is it safe to give it to
 * the mod"). The safety notes rank first in the search, the router sends
 * these to the notes, and a model answer that fails the checks falls back
 * to the best safety note.
 *
 * A bare channel or word is not one: "claim my rewards, I saw it on
 * telegram", "explain Scam Gauge", "is this pool a scam?" and "summarise
 * gauges in 12 words" keep their normal flow. A report of contact beside
 * a normal request (claim, vote, explain) keeps the normal flow too,
 * unless the message also asks to move, approve or hand something over.
 */
export function isSafetyQuestion(
  query: string,
  known?: ReadonlySet<string>,
): boolean {
  return safetySignal(query, known) !== null
}

export type SafetySignal =
  | "secret_named"
  | "key_pasted"
  | "phrase_pasted"
  | "secret_requested"
  | "contact"
  | "compromised"

/**
 * Why a message is a safety question, or null when it is not one.
 * `known` holds 64-hex ids a provider returned this turn: never keys.
 */
export function safetySignal(
  query: string,
  known?: ReadonlySet<string>,
): SafetySignal | null {
  const text = withoutBenignWords(query)
  if (SECRET_NOUN.test(text) || SECRET_HANDED.test(text)) {
    return "secret_named"
  }
  if (pastedKey(query, known)) return "key_pasted"
  if (pastedPhrase(query)) return "phrase_pasted"
  if (walletCompromised(query)) return "compromised"
  if (secretRequested(query)) return "secret_requested"
  if (CONTACT_REPORT.some((pattern) => pattern.test(query))) {
    const normal =
      NORMAL_ACTION.test(query) && !RISKY_ASK.test(query) && !scamPlace(query)
    return normal ? null : "contact"
  }
  return null
}

/**
 * The safety note a message must end on, when one fits it alone: the
 * secrets note when a secret was already given away ("I typed my seed into
 * a site", "I backed up my seed phrase to iCloud", a pasted key), the
 * phrase-holder note when a person the user knows holds it ("I gave my
 * recovery phrase to my wife"), the drained-wallet note when the wallet lost
 * funds after a signature, the redirect note when someone sends the user
 * to claim, vote or relock elsewhere ("support told me to claim at this
 * site"). Null otherwise: the best match answers.
 */
export function requiredSafetyNote(
  query: string,
  known?: ReadonlySet<string>,
): string | null {
  if (secretDisclosed(query, known)) return "safety.secrets"
  if (secretWithPerson(query)) return "safety.phrase_holder"
  const signal = safetySignal(query, known)
  if (signal === "secret_named") return null
  if (signal === "compromised") return "safety.drained"
  if (redirectRequested(query)) return "safety.redirect"
  return null
}

/**
 * Words that look like a secret and are not one: "a few words about SNF",
 * "the seed amount for a new pool". Taken out before secrets are read.
 */
const BENIGN_WORDS: readonly RegExp[] = [
  /\b(?:a\s+)?(?:few|couple(?:\s+of)?|kind|nice|last|final|many|several|warm|wise|good|harsh|strong)\s+words\b/gi,
  /\bwords\s+(?:about|regarding|of\s+(?:thanks|support|advice|wisdom|encouragement|warning))\b/gi,
  /\bseeds?\s+(?:amounts?|liquidity|rounds?|funding|funds?|investors?|investments?|stage|sales?|capital|money|raise[sd]?|vcs?|decks?|grants?|pools?|phase|sizes?|deposits?|values?|tokens?|prices?|bonus(?:es)?|rewards?|incentives?)\b/gi,
]

function withoutBenignWords(query: string): string {
  return BENIGN_WORDS.reduce(
    (text, pattern) => text.replace(pattern, " remarks "),
    query,
  )
}

/**
 * A secret named: never a bare "key", "phrase" or "words". "My seed" is
 * one; "seed round", "seed funding", "seed amount" and "seeded" are not.
 */
const SECRET_NOUN =
  /\b(?:seed\s*(?:phrases?|words?)|recovery\s*(?:phrases?|words?)|secret\s+(?:recovery\s+)?(?:phrases?|keys?|words?)|mnemonics?|private\s*keys?|pass\s*phrases?|keystores?(?:\s+files?)?|(?:my|your|our|his|her|their|the|those|these)\s+(?:12|15|18|21|24|twelve|fifteen|eighteen|twenty[\s-]one|twenty[\s-]four)[\s-]words?|(?:12|15|18|21|24|twelve|twenty[\s-]four)[\s-]word\s+(?:phrases?|seeds?|backups?|recovery|secrets?|mnemonics?|lists?)|(?:my|your|our|his|her|their|the|this|that|whole|wallet['’]?s?)\s+seeds?\b(?!\s*(?:rounds?|funding|funds?|investors?|investments?|stage|sales?|capital|money|raise[sd]?|vcs?|decks?|grants?|liquidity|pools?|phase|amounts?)\b))\b/i

/** Words for a secret, after a verb of handing it over. */
const SECRET_WORD = String.raw`(?:seeds?|phrases?|words|mnemonics?|recovery|keys?|pass\s*phrases?|keystores?|backup\s+codes?)`

/** Handing a secret over: "typed my seed", "entered the words", "sent my key". */
const HANDED_VERB =
  "(?:typed|typing|entered|entering|gave|given|giving|shared|sharing|sent|sending|pasted|pasting|put|putting|submitted|uploaded|revealed|imported|leaked|posted|showed|shown)"

const SECRET_HANDED = new RegExp(
  String.raw`\b${HANDED_VERB}\s+(?:(?:in|out|into|over|up)\s+)?(?:(?:my|the|your|our|a|an|those|these|all|his|her|their|this|that|whole)\s+)?(?:[\w-]+\s+){0,2}?${SECRET_WORD}\b`,
  "i",
)

/**
 * A secret handed somewhere, with or without "I": "I typed my seed into a
 * site", "gave them my words", "put my phrase in the form", "my seed was
 * entered on". Where it went decides whether it is exposed.
 */
const HANDED_TO: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:typed|entered|gave|given|shared|sent|pasted|put|submitted|uploaded|revealed|imported|posted|showed|shown|told|handed|wrote|written|read\s+out|backed\s+up|saved|stored|synced|copied|kept|emailed|texted|messaged)\s+(?:(?:in|out|into|over|up|it|down)\s+)?(?:[\w'’-]+\s+){0,3}?${SECRET_WORD}\b`,
    "i",
  ),
  new RegExp(
    String.raw`\b${SECRET_WORD}\s+(?:was|were|got|has\s+been|have\s+been|is|are|might\s+be|may\s+be)\s+(?:(?:already|now|probably|just|been)\s+)*(?:shared|posted|typed|entered|sent|given|pasted|submitted|uploaded|saved|stored|synced|backed\s+up)\b`,
    "i",
  ),
]

/**
 * A secret exposed whatever the place: leaked, stolen or phished, or held
 * by someone else ("they have my recovery words"; "I have my seed phrase
 * written down" is not one).
 */
const TAKEN: readonly RegExp[] = [
  new RegExp(
    String.raw`\b${SECRET_WORD}\s+(?:was|were|got|has\s+been|have\s+been|is|are|might\s+be|may\s+be)\s+(?:(?:already|now|probably|just|been)\s+)*(?:leaked|stolen|exposed|compromised|taken|phished|hacked|copied)\b`,
    "i",
  ),
  new RegExp(
    String.raw`\b(?:they|he|she|someone|somebody|scammers?|hackers?|the\s+(?:scammer|hacker|site|bot|guy|mod|admin|attacker)|it)\s+(?:(?:now|already|still|probably)\s+)?(?:has|have|got|stole|took|knows?|copied|saw|seen|has\s+seen)\s+(?:my|our)\s+(?:[\w-]+\s+)?${SECRET_WORD}\b`,
    "i",
  ),
  new RegExp(
    String.raw`\b(?:stole|leaked|phished)\s+(?:my|our)\s+(?:[\w-]+\s+)?${SECRET_WORD}\b`,
    "i",
  ),
  // A picture of it, on a phone that may sync it: "took a screenshot of my
  // seed phrase", "screenshotted my recovery words".
  new RegExp(
    String.raw`\b(?:took|taken|have|made|got)\s+(?:a\s+|some\s+)?(?:screenshots?|photos?|pictures?|pics?)\s+of\s+(?:my|the|our)\s+(?:[\w-]+\s+)?${SECRET_WORD}\b|\b(?:screenshotted|photographed)\s+(?:my|the|our)\s+(?:[\w-]+\s+)?${SECRET_WORD}\b`,
    "i",
  ),
]

/**
 * Online storage: a backup there is exposed ("backed up my seed phrase to
 * iCloud", "saved it in my notes app", "emailed it to myself").
 */
const ONLINE_STORE = String.raw`\b(?:i\s*cloud(?:\s+drive)?|google\s+(?:drive|keep|photos)|g-?drive|one\s*drive|drop\s*box|box\.com|(?:apple\s+|phone\s+)?notes?\s+app|apple\s+notes|evernote|camera\s+roll|photos?\s+app|gallery|gmail|mail\s+app|email(?:ed)?|e-mail|chat\s*gpt)\b`

/**
 * Where a handed secret is exposed: a site, a form, a link, a chat, a DM,
 * a person, a bot, support, "them", online. Read in the clause that hands
 * it over.
 */
const RISKY_PLACE = new RegExp(
  String.raw`\b(?:sites?|websites?|forms?|links?|urls?|portals?|pop-?ups?|extensions?|chats?|dms?|direct\s+messages?|telegram|discord|whatsapp|twitter|signal|emails?|support|admins?|mods?|moderators?|bots?|them|him|her|someone|somebody|some\s+(?:guy|one|person)|guy|strangers?|person|people|scammers?|helpers?|agents?|devs?|online|internet|google\s+(?:docs?|forms?)|screenshots?|cloud|this\s+chat|to\s+(?:you|stuart))\b|${ONLINE_STORE}|https?:\/\/|\b[a-z0-9-]+\.(?:com|io|xyz|app|net|org|finance|site|live|claims?)\b`,
  "i",
)

/** A place that is exposed whatever else the clause says. */
const STRONG_PLACE = new RegExp(
  String.raw`\b(?:sites?|websites?|forms?|links?|urls?|portals?|dms?|telegram|discord|whatsapp|support|admins?|mods?|moderators?|bots?|them|him|her|someone|somebody|guy|strangers?|scammers?)\b|${ONLINE_STORE}|https?:\/\/|\b[a-z0-9-]+\.(?:com|io|xyz|app|net|finance|site|live|claims?)\b`,
  "i",
)

/**
 * A backup or a restore: paper, a safe, a hardware wallet, the user's own
 * wallet app, a new wallet, offline.
 */
const SAFE_PLACE =
  /\b(?:paper|notebook|notepad|safe|vault|steel|metal|hardware\s+wallet|ledger|trezor|keystone|own\s+wallet|wallet\s+app|new\s+wallet|fresh\s+wallet|offline|to\s+restore|restor(?:e|ed|ing)|recover(?:ed|ing)?\s+(?:it|my|the))\b/i

/** The clause a handed secret sits in: up to the next mark. */
function handedClause(text: string, at: number, length: number): string {
  const rest = text.slice(at)
  const end = rest
    .slice(length)
    .search(/[.!?;\n]|,\s+(?:can|is|should|what|how|and\s+now)\b/i)
  return end === -1 ? rest.slice(0, length + 80) : rest.slice(0, length + end)
}

/**
 * A secret already given away: it was leaked or taken, someone else has
 * it, it is pasted here, or it was handed to a risky place ("I typed my
 * seed into a site", "gave them my words") and not a safe one ("I wrote
 * my seed phrase on paper", "I typed my seed phrase into my Ledger to
 * restore it").
 */
export function secretDisclosed(
  query: string,
  known?: ReadonlySet<string>,
): boolean {
  if (pastedKey(query, known) || pastedPhrase(query)) return true
  const text = withoutBenignWords(query)
  if (TAKEN.some((pattern) => pattern.test(text))) return true
  for (const pattern of HANDED_TO) {
    const handed = pattern.exec(text)
    if (handed === null) continue
    const clause = handedClause(text, handed.index, handed[0].length)
    if (!RISKY_PLACE.test(clause)) continue
    if (SAFE_PLACE.test(clause) && !STRONG_PLACE.test(clause)) continue
    return true
  }
  return false
}

/** A person the user knows, as the one holding a secret. */
const KNOWN_PERSON =
  /\b(?:my|our)\s+(?:wife|husband|partner|spouse|girlfriend|boyfriend|fianc[eé]e?|mom|mum|mother|dad|father|parents?|son|daughter|kids?|children|child|brother|sister|siblings?|family|friend|best\s+friend|cousin|uncle|aunt|grand(?:ma|pa|mother|father|son|daughter)|nephew|niece|lawyer|accountant|executor|colleague|coworker|co-worker|roommate|flatmate|boss)\b/i

/** A person the user knows holding it: "my wife has my seed phrase". */
const PERSON_HOLDS = new RegExp(
  String.raw`${KNOWN_PERSON.source}\s+(?:(?:now|already|also|still)\s+)?(?:has|have|knows?|holds?|keeps?|got)\s+(?:a\s+copy\s+of\s+)?(?:my|our)\s+(?:[\w-]+\s+)?${SECRET_WORD}\b`,
  "i",
)

/**
 * A secret a person the user knows holds or was given ("I gave my recovery
 * phrase to my wife", "my brother has my seed phrase"), when no risky
 * place took it too (secretDisclosed). Not exposed to a stranger, but
 * whoever has it controls the funds: the phrase-holder note says so.
 */
export function secretWithPerson(query: string): boolean {
  const text = withoutBenignWords(query)
  if (PERSON_HOLDS.test(text)) return true
  for (const pattern of HANDED_TO) {
    const handed = pattern.exec(text)
    if (handed === null) continue
    const clause = handedClause(text, handed.index, handed[0].length)
    if (KNOWN_PERSON.test(clause)) return true
  }
  return false
}

/** What a wallet's funds are, as the one lost. */
const HOLDINGS =
  "(?:wallet|account|address|funds?|btc|tokens?|assets|vebtc|vemezo|locks?|vaults?|positions?|savings|balances?|money|coins?|crypto|nfts?|deposits?)"

/** Signing or allowing something: what a drainer asks for. */
const SIGNED =
  "(?:signed|signing|approved|approving|connected|connecting|clicked|authori[sz]ed|permitted|confirmed|interacted|gaves+(?:an?s+)?(?:approval|permission|permit)|useds+(?:a|an|the|this|that|some)s+(?:site|link|app|dapp|contract))"

/**
 * A wallet that lost funds after a signature, or was drained or hacked:
 * the drained-wallet note, never a bare claim card.
 */
const COMPROMISED: readonly RegExp[] = [
  new RegExp(
    String.raw`\b${HOLDINGS}\s+(?:got|was|were|has\s+been|have\s+been|is|are|just|been)\s+(?:\w+\s+)?(?:drained|emptied|swept|hacked|compromised)\b`,
    "i",
  ),
  /\b(?:drained|emptied|swept|hacked)\s+(?:my|our)\s+(?:wallet|account|funds|vault|tokens|btc|assets)\b/i,
  /\b(?:i|we)\s+(?:got|was|were|have\s+been|has\s+been|just\s+got)\s+(?:drained|hacked)\b/i,
  // Gone after a signature: "my funds are gone after I signed a permit".
  new RegExp(
    String.raw`\b${HOLDINGS}\s+(?:got|was|were|has|have|is|are|just|went|been|has\s+been|have\s+been)\s+(?:(?:all|just|suddenly|completely|now)\s+)*(?:gone|missing|stolen|taken|vanished|disappeared|moved|transferred|sent\s+out|empty|emptied|zero)\b[^.?!]{0,60}?\b(?:after|since|when|once|right\s+after|just\s+after)\s+(?:(?:i|we)\s+)?(?:\w+\s+)?${SIGNED}\b`,
    "i",
  ),
]

function walletCompromised(query: string): boolean {
  return COMPROMISED.some((pattern) => pattern.test(query))
}

/** Someone who may ask, Stuart's own side excepted. */
const OUTSIDE_ASKER =
  "(?:support|mods?|moderators?|admins?|administrators?|team|someone|somebody|some\\s+(?:guy|one|person)|they|he|she|guy|agent|helper|dev|developer|staff|bot|person|account|ambassador|manager|mezo|official)"

/** Stuart and Matchbox: they ask the user to sign their own proposals. */
const OWN_ASKER = "(?:stuart|matchbox|the\\s+app|this\\s+app|the\\s+site)"

/**
 * A support-type person: who a scam speaks as when it sends the user to
 * claim, vote or relock. "Someone told me to vote for SNF" is advice, not
 * a scam, and keeps its flow. "Mezo", "the team", "official" and "the
 * manager" are not: "the Mezo team says to vote before the epoch ends"
 * is news, and they count only beside a scam's place (TOLD_ABOUT).
 */
const SUPPORT_ASKER =
  "(?:support|mods?|moderators?|admins?|administrators?|agent|helper|dev|developer|staff|bot|ambassador)"

/** Steps no one but the user should ask for: handing over or moving. */
const SECRET_STEP =
  "(?:send|share|give|enter|type|paste|reveal|import|verify|validate|connect|sync|transfer|move|deposit|restore)"

/** Signing: Stuart's own flow, a scam's from anyone else. */
const SIGN_STEP = "(?:sign|approve|authori[sz]e)"

/** Stuart's flows, a scam's when a support-type person sends the user. */
const FLOW_STEP =
  "(?:claim|re-?lock|lock|vote|bridge|migrate|stake|unstake|withdraw)"

/** What a scam asks for: a secret or a code. */
const ASKED_THING =
  "for\\s+(?:my|our|the|a|your)\\s+(?:[\\w-]+\\s+)?(?:words?|phrases?|keys?|seed|mnemonic|password|pin|code|codes|signature|recovery|backup)\\b"

const GAP = "(?:\\s+[\\w'’-]+){0,4}?"

/** The ways someone asks the user for a step, given who and which steps. */
function requestPatterns(asker: string, step: string): RegExp[] {
  const mustDo = `i\\s+(?:must|have\\s+to|need\\s+to|should|gotta|got\\s+to)\\s+${step}\\b`
  return [
    // "support asked me to verify", "the mod is asking us to sign".
    new RegExp(
      `\\b${asker}\\b${GAP}\\s+(?:asked|asks|asking|requested|requests|requesting|is\\s+asking|was\\s+asking)\\s+(?:me\\s+|us\\s+)?to\\s+${step}\\b`,
      "i",
    ),
    // "they need me to claim": needs and wants only with "me" or "us", so
    // "the team needs to verify the gauge contract" is not one.
    new RegExp(
      `\\b${asker}\\b${GAP}\\s+(?:wants|wanted|want|needs|needed|need|requires|required)\\s+(?:me|us)\\s+to\\s+${step}\\b`,
      "i",
    ),
    // "the admin told me to approve", "mezo team told me I need to re-lock".
    new RegExp(
      `\\b${asker}\\b${GAP}\\s+(?:told|tells|telling|says|said|claims?|claimed|insists?|insisted)\\s+(?:me\\s+|us\\s+)?(?:that\\s+)?(?:to\\s+${step}\\b|(?:[\\w'’#,-]+\\s+){0,8}?${mustDo})`,
      "i",
    ),
  ]
}

/**
 * Someone asking for a secret or a risky step ("support asked for my
 * words", "the admin says I must approve my lock").
 */
const SECRET_REQUEST: readonly RegExp[] = [
  new RegExp(
    `\\b(?:${OUTSIDE_ASKER}|${OWN_ASKER})\\b${GAP}\\s+(?:asked|asks|asking|wants|wanted|requested|requests|requesting|needs|needed|is\\s+asking|was\\s+asking)\\s+(?:me\\s+|us\\s+)?${ASKED_THING}`,
    "i",
  ),
  ...requestPatterns(`(?:${OUTSIDE_ASKER}|${OWN_ASKER})`, SECRET_STEP),
  ...requestPatterns(OUTSIDE_ASKER, SIGN_STEP),
]

/** A support-type person sending the user to claim, vote or relock. */
const FLOW_REQUEST: readonly RegExp[] = requestPatterns(
  SUPPORT_ASKER,
  FLOW_STEP,
)

/**
 * A place a scam sends the user to: "their contract", "this site", "a v2
 * contract", "rewards moved to a new contract", a link, or a domain the
 * message ties the action to (below). Read only beside someone telling
 * the user something, or a report of contact.
 */
const SCAM_PLACE: readonly RegExp[] = [
  /\btheir\s+(?:own\s+|new\s+|official\s+)?(?:contracts?|sites?|websites?|apps?|dapps?|bots?|links?|portals?|pages?|forms?)\b/i,
  /\b(?:this|that)\s+(?:site|website|link|portal|bot|url)\b/i,
  /\b(?:new|v\d+|updated|upgraded|different|another|second|migrated|migration)\s+(?:(?:rewards?|claim|claiming|staking|voting|lock|locking)\s+)?(?:contracts?|sites?|websites?|portals?|links?|apps?)\b/i,
  /\b(?:moved|migrated|migrating|moving|moves|switched)\s+(?:over\s+)?to\s+(?:(?:a|the)\s+)?(?:v\d+\b|(?:new|another|different|updated|separate)\s+(?:[\w-]+\s+)?(?:contracts?|sites?|websites?|apps?|dapps?|portals?|links?|addresses?|urls?|domains?|platforms?)\b)/i,
  /\b(?:a|an|this|the|that|their|some)\s+(?:[\w-]+\s+)?(?:link|url)s?\b/i,
]

/** A link or a dotted name, with or without a scheme. */
const PLACE_LINK =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+|(?<![\w@.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?![\w-])(?:[/?#:][^\s<>"']*)?)/gi

/**
 * The words before a place that tie the action to it: "claim at", "vote
 * on", "relock through", "connect to", "approve via", "sign on their
 * site", "rewards are at", "sent me a link to".
 */
const TIED_BEFORE = new RegExp(
  [
    String.raw`\b(?:claim\w*|vot\w*|re-?lock\w*|lock\w*|connect\w*|approv\w*|sign\w*|verif\w*|validat\w*|migrat\w*|stak\w*|unstak\w*|withdraw\w*|bridg\w*|deposit\w*|send|sync\w*|import\w*|restor\w*|go|head|visit|open|use)\b(?:\s+[\w'’-]+){0,3}?\s+(?:at|on|through|via|to|into|in|with|using)`,
    String.raw`\b(?:rewards?|airdrops?|tokens?|funds?|claims?|claiming|votes?|voting|locks?|staking)\s+(?:are|is|was|were|moved|now|went|live|available)(?:\s+(?:now|live|available)){0,2}\s+(?:at|on|to|via|through)`,
    String.raw`\b(?:sent|sends|gave|shared|dm(?:ed|['’]?d)?|messaged|posted|dropped)\s+(?:me|us)\s+(?:(?:a|the|this|their|some)\s+)?(?:[\w-]+\s+)?(?:links?|urls?|sites?|websites?|addresses?)?\s*(?:to|for|:)?`,
  ]
    .map(
      (part) =>
        String.raw`${part}\s*(?:(?:the|their|this|that|a|an)\s+)?(?:(?:site|website|page|link|url|portal|app|dapp|contract)\s+)?["'“‘(<]?$`,
    )
    .join("|"),
  "i",
)

/**
 * The words after a place that tie it to the action: "x.app to claim",
 * "x.app is where you claim", "x.app is the new site".
 */
const TIED_AFTER =
  /^[)"'”’>]?\s*(?:(?:to|for|and)\s+(?:claim|vot|re-?lock|lock|connect|approv|sign|verif|validat|migrat|stak|withdraw|bridg|deposit|sync|import|restor)|(?:is|was)\s+(?:where|the\s+(?:new\s+|official\s+|real\s+)?(?:site|place|page|link|contract|portal|app)\b))/i

/** Whether a link or domain is on the project's or Mezo's own hosts. */
function ownPlace(link: string): boolean {
  if (/[@\\]/.test(link)) return false
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(link)?.[1]?.toLowerCase()
  if (scheme !== undefined && scheme !== "http" && scheme !== "https") {
    return false
  }
  try {
    const url = new URL(scheme === undefined ? `https://${link}` : link)
    if (url.username !== "" || url.password !== "" || url.port !== "") {
      return false
    }
    return ownHost(url.hostname.toLowerCase().replace(/\.$/, ""))
  } catch {
    return false
  }
}

/**
 * Whether a message names a scam's place. A link or domain counts only
 * when it is not one of the project's own (ownHost, as the sourcing check
 * reads them) and the message ties the action to it ("claim at
 * mezo-rewards.xyz", "someone sent me a link to claim-mezo.app"); one
 * named as a source ("coingecko.com shows BTC is up", "the docs at
 * mezo.org explain it") is not.
 */
function scamPlace(query: string): boolean {
  if (SCAM_PLACE.some((pattern) => pattern.test(query))) return true
  for (const match of query.matchAll(PLACE_LINK)) {
    const link = match[0].replace(/[.,;:!?)\]'"’”]+$/u, "")
    if (ownPlace(link)) continue
    const before = query.slice(Math.max(0, match.index - 80), match.index)
    const after = query.slice(match.index + link.length)
    if (TIED_BEFORE.test(before) || TIED_AFTER.test(after)) return true
  }
  return false
}

/** Someone outside telling the user something beside a scam's place. */
const TOLD_ABOUT = new RegExp(
  `\\b${OUTSIDE_ASKER}\\b${GAP}\\s+(?:told|tells|telling|says|said|claims?|claimed|insists?|insisted|asked|asks|asking|wants|wanted|needs|needed|need|sent|sends|dm(?:ed|['’]?d)?|messaged)\\b`,
  "i",
)

/**
 * The user asking whether to hand something over: a secret to anyone, or
 * anything to an outside party ("is it safe to give it to the mod"). Not
 * a vote to a gauge, BTC to the user's own address or an address to
 * Matchbox.
 */
const IS_IT_SAFE_TO_GIVE =
  /\bis\s+(?:it|this|that)\s+(?:safe|ok|okay|fine|legit|alright|smart|wise)\s+to\s+(?:give|send|share|paste|enter|type|show|hand|tell|import|reveal)\b((?:\s+[\w'’#-]+){0,8}?)\s+(?:to|with|into)\s+([^?.!,;]*)/i

const SECRET_OBJECT = new RegExp(
  String.raw`\b(?:${SECRET_WORD}|password|pin|codes?|signature)\b`,
  "i",
)

/** An outside party as the one receiving: a person, a link, a site. */
const OUTSIDE_PARTY: readonly RegExp[] = [
  /^(?:(?:the|a|an|this|that|some|their|his|her|any|random|these|those|one)\s+)?(?:[\w'’-]+\s+){0,2}?(?:mods?|moderators?|admins?|administrators?|support|team|guys?|someone|somebody|person|people|strangers?|dev|developers?|agents?|helpers?|friends?|bots?|accounts?|ambassadors?|managers?|telegram|discord|whatsapp|dms?|links?|urls?)\b/i,
  /^(?:him|her|them|this\s+guy|that\s+guy)\b/i,
  /^(?:(?:a|an|that|some|their|random|another|unknown|any|other)\s+)(?:[\w'’-]+\s+){0,2}?(?:sites?|websites?|forms?|portals?|apps?|contracts?)\b/i,
  /^0x[0-9a-f]{40}\b/i,
  /^https?:/i,
  /^[a-z0-9-]+\.(?:com|io|xyz|app|net|org|finance|site|live|claims?)\b/i,
]

function askedIfSafeToGive(query: string): boolean {
  const asked = IS_IT_SAFE_TO_GIVE.exec(query)
  if (asked === null) return false
  const object = asked[1] ?? ""
  const recipient = (asked[2] ?? "").trim()
  if (SECRET_OBJECT.test(object)) return true
  return OUTSIDE_PARTY.some((pattern) => pattern.test(recipient))
}

/** Someone asking for a secret or a risky step, or the user asking. */
function secretRequested(query: string): boolean {
  return (
    SECRET_REQUEST.some((pattern) => pattern.test(query)) ||
    redirectRequested(query) ||
    askedIfSafeToGive(query)
  )
}

/**
 * Someone sending the user to claim, vote or relock: a support-type person
 * asking for it, or anyone outside naming a scam's place ("a discord mod
 * told me rewards moved to a v2 contract").
 */
function redirectRequested(query: string): boolean {
  if (FLOW_REQUEST.some((pattern) => pattern.test(query))) return true
  if (!scamPlace(query)) return false
  return (
    TOLD_ABOUT.test(query) ||
    CONTACT_REPORT.some((pattern) => pattern.test(query))
  )
}

/** Someone reaching the user unasked: "X DMed me", "got a DM from". */
const CONTACT_REPORT: readonly RegExp[] = [
  /\b(?:dm(?:ed|['’]?d)?|direct[\s-]messaged|messaged|contacted|texted|called|emailed|pinged|reached\s+out\s+to|wrote\s+to|added)\s+me\b/i,
  /\b(?:sent|sends)\s+me\s+(?:a\s+|an\s+)?(?:dm|direct\s+message|message|text|link)\b/i,
  /\b(?:got|received|getting|have|had)\s+(?:a|an|this|that|some)\s+(?:[\w-]+\s+){0,2}?(?:dms?|direct\s+messages?|messages?|texts?|emails?|calls?)\s+(?:from|saying|telling|asking|that)\b/i,
]

/** Stuart's own flows a message may ask for beside a report of contact. */
const NORMAL_ACTION =
  /\b(?:claim|claims|vote|votes|voting|ballot|re-?lock|compound|explain|summari[sz]e|compare|rank|optimi[sz]e|show|list)\b/i

/** A step a scam wants, or a target it supplies. */
const RISKY_ASK =
  /\b(?:approve|approval|transfer|send|move|deposit|withdraw|bridge|sign|share|give|import|connect|verify|validate|sync|paste)\b|0x[0-9a-f]{40}\b|https?:\/\/|\b[a-z0-9-]+\.(?:com|io|xyz|app|net|org|finance|site|live|claims?)\b/i

/**
 * Keywords that only ask whether something is safe: they count only when
 * the message names something risky to hand over or allow ("is it safe to
 * transfer my veBTC"), not "is it safe to paste my address into Matchbox".
 */
const GENERIC_ASK: ReadonlySet<string> = new Set([
  "is it safe",
  "is that ok",
  "is this safe",
])
const RISKY_SUBJECT =
  /\b(?:approv\w*|transfer\w*|nfts?|permissions?|access|seed|phrases?|keys?|dms?|telegram|whatsapp|airdrops?|links?|sites?|websites?|contracts?|scam\w*|strangers?|someone|admins?|mods?|moderators?|support)\b/

/** Safety notes, ranked first for a safety question. */
function isSafetyNote(entry: KnowledgeEntry): boolean {
  return entry.id.startsWith("safety.")
}

/**
 * Keyword search. A keyword phrase scores its word count plus two; a title
 * word scores one. Entries under `minScore` are dropped.
 *
 * With `page`, the notes written on that docs page rank first and need only
 * one point, since the reader is already looking at the topic. Without it
 * the search is unchanged. For a safety question (isSafetyQuestion) the
 * safety notes rank first, before the page's.
 */
export function searchMezoKnowledge(
  query: string,
  options: {
    limit?: number
    minScore?: number
    page?: string | null
    /** The notes to search; every note by default. */
    entries?: readonly KnowledgeEntry[]
  } = {},
): KnowledgeMatch[] {
  const page = options.page ?? null
  const text = normalize(query.replace(/[?!.,]+/g, " "))
  const words = new Set(
    text
      .trim()
      .split(" ")
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  )
  const matches: KnowledgeMatch[] = []
  for (const entry of options.entries ?? MEZO_KNOWLEDGE) {
    let score = 0
    for (const keyword of entry.keywords) {
      if (GENERIC_ASK.has(keyword) && !RISKY_SUBJECT.test(text)) continue
      if (containsPhrase(text, keyword)) {
        score += 2 + keyword.split(" ").length
      }
    }
    for (const word of normalize(entry.title).trim().split(" ")) {
      if (word.length > 3 && words.has(word)) score += 1
    }
    const onPage = page !== null && knowledgePage(entry) === page
    if (onPage ? score >= 1 : score >= (options.minScore ?? 3)) {
      matches.push({ entry, score })
    }
  }
  const safety = isSafetyQuestion(query)
  // A safety question always gets a safety note, even with no keyword of
  // one ("my key is 0x...", a pasted phrase, "support asked for my words").
  const secrets = (options.entries ?? MEZO_KNOWLEDGE).find(
    (entry) => entry.id === "safety.secrets",
  )
  if (
    safety &&
    secrets !== undefined &&
    !matches.some((match) => isSafetyNote(match.entry))
  ) {
    matches.push({ entry: secrets, score: 0 })
  }
  // A secret already given away gets the secrets note, a request to claim
  // elsewhere the redirect note, ahead of any other match.
  const required = safety ? requiredSafetyNote(query) : null
  const requiredEntry = (options.entries ?? MEZO_KNOWLEDGE).find(
    (entry) => entry.id === required,
  )
  if (
    requiredEntry !== undefined &&
    !matches.some((match) => match.entry.id === required)
  ) {
    matches.push({ entry: requiredEntry, score: 0 })
  }
  function rank(match: KnowledgeMatch): number {
    if (match.entry.id === required) return 3
    if (safety && isSafetyNote(match.entry)) return 2
    return page !== null && knowledgePage(match.entry) === page ? 1 : 0
  }
  return matches
    .sort((left, right) => rank(right) - rank(left) || right.score - left.score)
    .slice(0, options.limit ?? 3)
}
