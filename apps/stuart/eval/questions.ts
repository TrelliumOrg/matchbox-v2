import {
  byApy,
  byIncentives,
  type Card,
  cardNamed,
  type GroundTruth,
  num,
} from "./truth.ts"

// The eval's question set: every Stuart intent, three swept wallets, one the
// sweep has not reached, and Mezo support questions. Each expectation is
// computed from ground truth (truth.ts), never from Stuart's code.

export type Category =
  | "ranking"
  | "gauge"
  | "protocol"
  | "price"
  | "wallet"
  | "loan"
  | "activity"
  | "clarify"
  | "out_of_scope"
  | "support"
  | "action"
  | "search"

export type ExpectedNumber = {
  label: string
  value: number
  // Relative tolerance (0.01 = 1%); `abs` is an absolute floor.
  rel: number
  abs?: number
}

export type Expectation = {
  intents: string[]
  numbers?: ExpectedNumber[]
  // Each group: at least one term must appear (case-insensitive).
  terms?: string[][]
  // None of these may appear (case-insensitive).
  forbid?: string[]
  // The answer must carry no digits at all (declines, clarifications).
  noNumbers?: boolean
  // A docs citation (evidence kind "docs") must back the answer.
  docs?: boolean
  // The answer must carry a prepared transaction of this kind (and lock
  // action); `exact` checks every claimed amount against earned() on chain.
  proposal?: { kind: string; action?: string; exact?: boolean }
  // A gauge_ranking block with this objective, and its first row's kind.
  objective?: string
  rowKind?: string
}

export type Question = {
  id: string
  category: Category
  query: string
  wallet: string | null
  expect: (truth: GroundTruth) => Expectation
}

// Swept by the warehouse (meta.source "warehouse") and one live-only wallet.
export const WALLETS = {
  multiLock: "0x937135f85a37ff0c6540a1eff09293aa32696ad3",
  mixed: "0xc9442775a305d8d428dcb8f9029d34bc121c2a67",
  snfOwner: "0x147379a0174780570d07d70a14fb244ee5f2d786",
  unswept: "0xfc33181fbab11d8c33cd904f7ee1d4c62685470f",
} as const

const pct = (card: Card) => num(card.apy)
const usd = (card: Card) => num(card.incentives.usd)
// The card's USD is priced when the API built it; Stuart prices at the
// latest reference price. MEZO and BTC incentives are repriced here at the
// same /prices snapshot so the eval compares like with like.
function liveUsd(card: Card, truth: GroundTruth): number {
  let total = 0
  for (const line of card.incentives.tokens) {
    const symbol = line.token.symbol
    if (symbol === "MEZO") total += num(line.amount) * truth.mezoUsd
    else if (symbol === "BTC") total += num(line.amount) * truth.btcUsd
    else return usd(card)
  }
  return total
}
const NO_WALLET_TERMS = [
  ["wallet", "connect", "watch", "select an address", "no address"],
]

function top(cards: Card[], label: string): Card {
  const first = cards[0]
  if (first === undefined) throw new Error(`No ${label}`)
  return first
}

export const QUESTIONS: Question[] = [
  // Rankings
  {
    id: "rank.apy.default",
    category: "ranking",
    query: "Which gauges pay the most per vote this epoch?",
    wallet: null,
    expect: (truth) => {
      const best = top(byApy(truth.boost), "boost apy")
      return {
        intents: ["rank_gauges"],
        numbers: [{ label: "top APY", value: pct(best), rel: 0.01 }],
        terms: [[best.gauge.name.trim()]],
      }
    },
  },
  {
    id: "rank.apy.validators",
    category: "ranking",
    query: "Which validators pay the most per vote?",
    wallet: null,
    expect: (truth) => {
      const best = top(byApy(truth.validators), "validator apy")
      return {
        intents: ["rank_gauges"],
        terms: [[best.gauge.name.trim()]],
        numbers: [
          { label: "incentives", value: liveUsd(best, truth), rel: 0.01 },
        ],
      }
    },
  },
  {
    id: "rank.incentives.default",
    category: "ranking",
    query: "Which gauges have the most incentives this epoch?",
    wallet: null,
    expect: (truth) => {
      const best = top(byIncentives(truth.boost), "boost incentives")
      return {
        intents: ["rank_gauges"],
        terms: [[best.gauge.name.trim()]],
        numbers: [
          { label: "incentives", value: liveUsd(best, truth), rel: 0.005 },
        ],
      }
    },
  },
  {
    id: "rank.incentives.pools",
    category: "ranking",
    query: "Which pools have the most incentives deposited?",
    wallet: null,
    expect: (truth) => {
      const best = top(byIncentives(truth.pools), "pool incentives")
      return {
        intents: ["rank_gauges"],
        terms: [[best.gauge.name.trim()]],
        numbers: [
          { label: "incentives", value: liveUsd(best, truth), rel: 0.005 },
        ],
      }
    },
  },
  {
    id: "rank.consistent",
    category: "ranking",
    query: "Which gauges were most consistently funded over the last 8 epochs?",
    wallet: null,
    expect: () => ({ intents: ["rank_gauges"] }),
  },
  {
    id: "rank.count",
    category: "ranking",
    query: "How many boost gauges have incentives this epoch?",
    wallet: null,
    expect: (truth) => ({
      intents: ["rank_gauges", "protocol_stats"],
      numbers: [
        {
          label: "funded boost gauges",
          value: truth.boost.filter((card) => usd(card) > 0).length,
          rel: 0,
        },
      ],
    }),
  },

  // Gauge explainers
  {
    id: "gauge.snf.boost",
    category: "gauge",
    query: "What is the boost multiplier for the SNF gauge right now?",
    wallet: null,
    expect: (truth) => ({
      intents: ["explain_gauge"],
      numbers: [{ label: "boost", value: truth.chain.snfBoost, rel: 0.001 }],
      terms: [["SNF"]],
    }),
  },
  {
    id: "gauge.snf.votes",
    category: "gauge",
    query: "How many votes does the SNF gauge have?",
    wallet: null,
    expect: (truth) => ({
      intents: ["explain_gauge"],
      numbers: [{ label: "votes", value: truth.chain.snfWeight, rel: 0.001 }],
    }),
  },
  {
    id: "gauge.5910.explain",
    category: "gauge",
    query: "Explain veBTC #5910",
    wallet: null,
    expect: (truth) => {
      const card = cardNamed(truth.boost, "veBTC #5910")
      return {
        intents: ["explain_gauge"],
        numbers: [{ label: "APY", value: pct(card), rel: 0.01 }],
      }
    },
  },
  {
    id: "gauge.chooseme",
    category: "gauge",
    query: "Tell me about the ChooseMe validator",
    wallet: null,
    expect: (truth) => {
      const card = cardNamed(truth.validators, "ChooseMe")
      return {
        intents: ["explain_gauge"],
        terms: [["ChooseMe"]],
        numbers: [
          { label: "incentives", value: liveUsd(card, truth), rel: 0.01 },
        ],
      }
    },
  },
  {
    id: "gauge.snf.apy_change",
    category: "gauge",
    query: "Why is SNF APY so low?",
    wallet: null,
    expect: (truth) => {
      const card = cardNamed(truth.boost, "SNF")
      return {
        intents: ["explain_gauge"],
        numbers: [{ label: "APY", value: pct(card), rel: 0.01 }],
      }
    },
  },

  // Protocol totals
  {
    id: "protocol.vemezo_locked",
    category: "protocol",
    query: "How much MEZO is locked as veMEZO?",
    wallet: null,
    expect: (truth) => ({
      intents: ["protocol_stats"],
      numbers: [
        { label: "veMEZO supply", value: truth.chain.vemezoSupply, rel: 0.002 },
      ],
      forbid: ["no wallet"],
    }),
  },
  {
    id: "protocol.lockers",
    category: "protocol",
    query: "How many veMEZO lockers are there?",
    wallet: null,
    expect: (truth) => ({
      intents: ["protocol_stats"],
      numbers: [
        {
          label: "lockers",
          value: truth.summary.stats.vemezoLockers,
          rel: 0.01,
        },
      ],
    }),
  },
  {
    id: "protocol.vebtc_locked",
    category: "protocol",
    query: "How much BTC is locked in veBTC?",
    wallet: null,
    expect: (truth) => ({
      intents: ["protocol_stats"],
      numbers: [
        { label: "veBTC supply", value: truth.chain.vebtcSupply, rel: 0.002 },
      ],
    }),
  },
  {
    id: "protocol.incentives",
    category: "protocol",
    query: "What are total voting incentives this epoch?",
    wallet: null,
    expect: (truth) => ({
      intents: ["protocol_stats"],
      numbers: [
        {
          label: "incentives",
          value: num(truth.summary.incentives.usd),
          rel: 0.01,
        },
      ],
    }),
  },
  {
    id: "protocol.epoch",
    category: "protocol",
    query: "What epoch is it and when does it end?",
    wallet: null,
    expect: (truth) => ({
      intents: ["protocol_stats"],
      // Numbered from Epoch 0 = Thu 11 Dec 2025 (matchbox-v3, Decided 9 Nov).
      numbers: [
        {
          label: "epoch",
          value: Math.floor((truth.epoch.start - 1_765_411_200) / 604_800),
          rel: 0,
        },
      ],
      terms: [
        [
          new Date(truth.epoch.end * 1000).toISOString().slice(0, 10),
          new Date(truth.epoch.end * 1000).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }),
          new Date(truth.epoch.end * 1000).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }),
          "Thursday",
        ],
      ],
    }),
  },

  // Prices
  {
    id: "price.mezo",
    category: "price",
    query: "What is the MEZO price?",
    wallet: null,
    expect: (truth) => ({
      intents: ["protocol_stats"],
      numbers: [{ label: "MEZO", value: truth.mezoUsd, rel: 0.02 }],
    }),
  },
  {
    id: "price.btc",
    category: "price",
    query: "What's the BTC price on Mezo?",
    wallet: null,
    expect: (truth) => ({
      intents: ["protocol_stats"],
      numbers: [{ label: "BTC", value: truth.btcUsd, rel: 0.01 }],
    }),
  },

  // Wallets
  {
    id: "wallet.multi.claimable",
    category: "wallet",
    query: "What are my claimable rewards?",
    wallet: WALLETS.multiLock,
    expect: (truth) => {
      const wallet = truth.wallets[WALLETS.multiLock]
      return {
        intents: ["claim_rewards"],
        numbers: [
          {
            label: "claimable USD",
            value: wallet?.claimableUsd ?? 0,
            rel: 0.02,
          },
        ],
      }
    },
  },
  {
    id: "wallet.multi.locks",
    category: "wallet",
    query: "How much MEZO do I have locked?",
    wallet: WALLETS.multiLock,
    expect: (truth) => {
      const wallet = truth.wallets[WALLETS.multiLock]
      return {
        intents: ["navigate", "wallet_locks"],
        numbers: [
          {
            label: "veMEZO locked",
            value: wallet?.vemezoLocked ?? 0,
            rel: 0.005,
          },
        ],
      }
    },
  },
  {
    id: "wallet.multi.earning",
    category: "wallet",
    query: "What am I earning?",
    wallet: WALLETS.multiLock,
    expect: () => ({ intents: ["wallet_earnings"] }),
  },
  {
    id: "wallet.mixed.power",
    category: "wallet",
    query: "How much veMEZO voting power do I have?",
    wallet: WALLETS.mixed,
    expect: (truth) => {
      const wallet = truth.wallets[WALLETS.mixed]
      return {
        intents: ["navigate", "wallet_locks"],
        numbers: [
          {
            label: "veMEZO power",
            value: wallet?.vemezoPower ?? 0,
            rel: 0.005,
          },
        ],
      }
    },
  },
  {
    id: "wallet.mixed.claimable",
    category: "wallet",
    query: "Show my claimable rewards",
    wallet: WALLETS.mixed,
    expect: (truth) => {
      const wallet = truth.wallets[WALLETS.mixed]
      const value = wallet?.claimableUsd ?? 0
      return {
        intents: ["claim_rewards"],
        ...(value > 0
          ? { numbers: [{ label: "claimable USD", value, rel: 0.02 }] }
          : { terms: [["no ", "nothing", "none"]] }),
      }
    },
  },
  {
    id: "wallet.snf.vebtc",
    category: "wallet",
    query: "How much BTC do I have locked in veBTC?",
    wallet: WALLETS.snfOwner,
    expect: (truth) => {
      const wallet = truth.wallets[WALLETS.snfOwner]
      return {
        intents: ["navigate", "wallet_locks"],
        numbers: [
          {
            label: "veBTC locked",
            value: wallet?.vebtcLocked ?? 0,
            rel: 0.005,
          },
        ],
      }
    },
  },
  {
    id: "wallet.snf.lockcount",
    category: "wallet",
    query: "Show my locks",
    wallet: WALLETS.snfOwner,
    expect: (truth) => ({
      intents: ["navigate", "wallet_locks"],
      numbers: [
        {
          label: "locks",
          value: truth.wallets[WALLETS.snfOwner]?.locks.length ?? 0,
          rel: 0,
        },
      ],
    }),
  },
  {
    id: "wallet.unswept.locks",
    category: "wallet",
    query: "Show my locks",
    wallet: WALLETS.unswept,
    expect: (truth) => ({
      intents: ["navigate", "wallet_locks"],
      numbers: [
        {
          label: "locks",
          value: truth.wallets[WALLETS.unswept]?.locks.length ?? 0,
          rel: 0,
        },
      ],
    }),
  },
  {
    id: "wallet.unswept.claimable",
    category: "wallet",
    query: "What are my claimable rewards?",
    wallet: WALLETS.unswept,
    expect: (truth) => {
      const value = truth.wallets[WALLETS.unswept]?.claimableUsd ?? 0
      return {
        intents: ["claim_rewards"],
        ...(value > 0
          ? { numbers: [{ label: "claimable USD", value, rel: 0.02 }] }
          : { terms: [["no ", "nothing", "none"]] }),
      }
    },
  },
  {
    id: "wallet.none.claimable",
    category: "wallet",
    query: "What are my claimable rewards?",
    wallet: null,
    expect: () => ({
      intents: ["claim_rewards", "navigate", "unsupported", "clarify"],
      terms: NO_WALLET_TERMS,
      noNumbers: true,
    }),
  },

  // Loans
  {
    id: "loan.none",
    category: "loan",
    query: "How healthy is my mUSD trove?",
    wallet: WALLETS.multiLock,
    expect: (truth) => ({
      intents: ["loan_position"],
      ...((truth.wallets[WALLETS.multiLock]?.troveStatus ?? 0) === 1
        ? {}
        : { terms: [["no ", "not ", "none", "closed"]] }),
    }),
  },
  {
    id: "loan.active",
    category: "loan",
    query: "What is my trove's collateral ratio?",
    wallet: "trove",
    expect: (truth) => ({
      intents: ["loan_position"],
      numbers: truth.trove
        ? [{ label: "ICR %", value: truth.trove.icrPercent, rel: 0.01 }]
        : [],
    }),
  },
  {
    id: "loan.shock",
    category: "loan",
    query: "What happens to my trove if BTC drops 20%?",
    wallet: "trove",
    expect: () => ({ intents: ["liquidation_scenario"] }),
  },

  // Activity
  {
    id: "activity.bridge",
    category: "activity",
    query: "Show my Wormhole bridge transfers",
    wallet: WALLETS.multiLock,
    expect: () => ({ intents: ["bridge_search"] }),
  },

  // Clarifications
  {
    id: "clarify.best",
    category: "clarify",
    query: "What are the best gauges?",
    wallet: null,
    expect: () => ({ intents: ["clarify"], noNumbers: true }),
  },
  {
    id: "clarify.deposit",
    category: "clarify",
    query: "Deposit 100 MUSD",
    wallet: WALLETS.multiLock,
    expect: () => ({ intents: ["clarify"] }),
  },
  {
    id: "clarify.repay",
    category: "clarify",
    query: "Repay my loan",
    wallet: WALLETS.multiLock,
    expect: () => ({ intents: ["clarify"], noNumbers: true }),
  },

  // Out of scope
  {
    id: "oos.weather",
    category: "out_of_scope",
    query: "What's the weather in Paris?",
    wallet: null,
    expect: () => ({ intents: ["unsupported"], noNumbers: true }),
  },
  {
    id: "oos.poem",
    category: "out_of_scope",
    query: "Write me a poem about Ethereum",
    wallet: null,
    expect: () => ({ intents: ["unsupported"], noNumbers: true }),
  },

  // Mezo support and how-to
  {
    id: "support.thursday",
    category: "support",
    query:
      "Why does my vote transaction revert on Thursday right after midnight?",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [["00:00", "midnight"], ["01:00", "one hour", "1 hour"], ["UTC"]],
      docs: true,
    }),
  },
  {
    id: "support.revote",
    category: "support",
    query: "Can I vote twice with the same lock in one epoch?",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [["once", "one vote", "1 vote", "only one"], ["epoch"]],
      docs: true,
    }),
  },
  {
    id: "support.boost",
    category: "support",
    query: "How does boosting a veBTC gauge with veMEZO change what I earn?",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [["boost"], ["5x", "5×", "five", "up to 5"]],
      docs: true,
    }),
  },
  {
    id: "support.approve",
    category: "support",
    query:
      "A site asks me to approve my veBTC NFT so it can vote for me. Is that ok?",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [
        ["custody", "control", "transfer"],
        ["don't", "do not", "never", "not"],
      ],
      forbid: ["approve it", "go ahead"],
      docs: true,
    }),
  },
  {
    id: "support.relayer",
    category: "support",
    query: "Can I use a relayer to vote without paying gas?",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [["disabled", "not available", "no longer", "turned off"]],
      docs: true,
    }),
  },
  {
    id: "support.mezo_gauge",
    category: "support",
    query: "How do I vote for a MEZO gauge?",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [["ThirdPartyVoter", "third-party voter", "third party voter"]],
      docs: true,
    }),
  },
  {
    id: "support.borrow",
    category: "support",
    query: "Where can I borrow MUSD against BTC now?",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [["Morpho"], ["Enclave"]],
      docs: true,
    }),
  },
  {
    id: "support.vemezo",
    category: "support",
    query: "What is veMEZO?",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [["lock"], ["MEZO"], ["vot"]],
      docs: true,
    }),
  },
  // Actions propose transactions (watched wallets get a read-only card).
  {
    id: "action.claim_all",
    category: "action",
    query: "Claim all my rewards",
    wallet: WALLETS.multiLock,
    expect: () => ({
      intents: ["claim_rewards"],
      terms: [["to claim from"]],
      proposal: { kind: "claim", exact: true },
    }),
  },
  {
    id: "action.withdraw_expired",
    category: "action",
    query: "Withdraw my expired lock",
    wallet: WALLETS.unswept,
    expect: () => ({
      intents: ["navigate"],
      terms: [["withdraw"]],
      proposal: { kind: "lock", action: "withdraw" },
    }),
  },
  {
    id: "action.claim_relock",
    category: "action",
    query: "Claim my rewards and relock them",
    wallet: WALLETS.multiLock,
    expect: () => ({
      intents: ["claim_rewards"],
      proposal: { kind: "claim_relock" },
    }),
  },
  // Rankings by funded epochs and gauge kinds.
  {
    id: "rank.consistency_rewards",
    category: "ranking",
    query: "Which gauges have most consistently had rewards?",
    wallet: WALLETS.multiLock,
    expect: () => ({
      intents: ["rank_gauges"],
      objective: "most_consistently_funded",
      forbid: ["claimable", "to claim"],
    }),
  },
  {
    id: "rank.kind_pool",
    category: "ranking",
    query: "Which pools have the most incentives deposited?",
    wallet: null,
    expect: () => ({
      intents: ["rank_gauges"],
      objective: "most_incentives_deposited",
      rowKind: "pool",
    }),
  },
  // Support questions the router leaves to the model (mezo_knowledge).
  {
    id: "support.model.difference",
    category: "support",
    query: "What's the difference between veBTC and veMEZO?",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [["BTC"], ["MEZO"]],
      docs: true,
    }),
  },
  {
    id: "support.model.boost_low",
    category: "support",
    query: "Why is my boost only 1.66x?",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [["share", "total"]],
      docs: true,
    }),
  },
  {
    id: "support.model.boost_rewards",
    category: "support",
    query: "If my veBTC gets boosted to 5x what happens to my rewards?",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [["share", "larger", "more"]],
      docs: true,
    }),
  },
  {
    id: "support.model.incentives",
    category: "support",
    query: "Explain how incentives get paid out",
    wallet: null,
    expect: () => ({
      intents: ["mezo_help"],
      terms: [["epoch"], ["pro rata", "proportion", "voting weight", "share"]],
      docs: true,
    }),
  },
]
