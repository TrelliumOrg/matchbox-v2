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

// The docs half carries its own content hash, so a docs edit changes this.
export const MEZO_KNOWLEDGE_VERSION = `2026-11-13.1+${docsKnowledgeVersion}`
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
      "vote for me",
      "vote on my behalf",
      "delegate",
      "is it safe",
      "is that ok",
      "is this safe",
      "scam",
      "give access",
      "permission",
      "manager",
    ],
    sources: [SOURCES.vebtcContract, SOURCES.incident],
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
 * Keyword search. A keyword phrase scores its word count plus two; a title
 * word scores one. Entries under `minScore` are dropped.
 *
 * With `page`, the notes written on that docs page rank first and need only
 * one point, since the reader is already looking at the topic. Without it
 * the search is unchanged.
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
  function rank(match: KnowledgeMatch): number {
    return page !== null && knowledgePage(match.entry) === page ? 1 : 0
  }
  return matches
    .sort((left, right) => rank(right) - rank(left) || right.score - left.score)
    .slice(0, options.limit ?? 3)
}
