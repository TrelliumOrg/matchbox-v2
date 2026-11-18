import { MORPHO_MARKETS } from "@matchbox/chain"
import { demoGauges } from "@matchbox/contracts/read-models/fixtures"
import type {
  ScanActivityItem,
  ScanLabelItem,
  ScanLiveLock,
  ScanLockItem,
  ScanLockVoteItem,
} from "@matchbox/contracts/scan"
import { fixtureHead, fixtureIds } from "../../blockscout/fixtures"
import transaction from "../../blockscout/fixtures/transaction.json"
import {
  btcToken,
  currentEpoch,
  epochStart,
  fakeAddress,
  fakeHash,
  fixtureNow,
  mezoToken,
  musdcToken,
  musdToken,
  units,
  vebtc,
  vemezo,
} from "./shared"

/**
 * One small, consistent Mezo for every /internal/scan fixture: the
 * recorded transaction's sender as a voter with two locks and loans, the
 * demo gauges (shared with Pro's fixtures) as the gauges they vote for,
 * and the activity, votes and loans that tie them together. Rows have the
 * shapes the API answers with (`@matchbox/contracts/scan`).
 */

/** The recorded transaction's sender: our fixture voter and borrower. */
export const wallet = transaction.from.hash.toLowerCase()
/** Another voter, owner of the other locks. */
export const otherVoter = fakeAddress("c0ffee")
/** The pool the recorded swap went through (its mUSDC transfer's recipient). */
export const swapPool = "0xed812aec0fecc8fd882ac3eccc43f3aa80a6c356"
/** The router the recorded transaction called. */
export const router = transaction.to.hash.toLowerCase()
/** The recorded block's proposer. */
export const proposer = "0xd7fb1de0a4c2ffe5474e003656302a3f3a388a8a"

export const gauges = {
  kilnLabs: demoGauges.kilnLabs.address.toLowerCase(),
  northgate: demoGauges.northgate.address.toLowerCase(),
  satsCollective: demoGauges.satsCollective.address.toLowerCase(),
  hearthCapital: demoGauges.hearthCapital.address.toLowerCase(),
}

const at = (epoch: number, offset: number): number => epochStart(epoch) + offset

// -- labels ---------------------------------------------------------------

function label(
  address: string,
  name: string,
  kind: string,
  tags: string[],
  extra: Partial<ScanLabelItem> = {},
): ScanLabelItem {
  return {
    address,
    name,
    kind,
    tags,
    source: "curated",
    pool: null,
    gauge: null,
    updated_at: fixtureNow - 86_400,
    ...extra,
  }
}

export const labels: Record<string, ScanLabelItem> = {
  [fixtureIds.address]: label(fixtureIds.address, "BoostVoter", "voter", [
    "Voter",
  ]),
  [router]: label(router, "Universal Router", "router", ["DEX"], {
    source: "contracts",
  }),
  [swapPool]: label(swapPool, "mUSDC/MUSD", "pool", ["Pool"], {
    pool: swapPool,
  }),
  [proposer]: label(proposer, "Kiln Labs", "validator", ["Validator"]),
  [vebtc]: label(vebtc, "veBTC", "escrow", ["Escrow"]),
  [vemezo]: label(vemezo, "veMEZO", "escrow", ["Escrow"]),
  [gauges.kilnLabs]: label(gauges.kilnLabs, "Kiln Labs", "gauge", ["Gauge"], {
    gauge: gauges.kilnLabs,
  }),
  [gauges.northgate]: label(
    gauges.northgate,
    "Northgate Capital",
    "gauge",
    ["Gauge"],
    { gauge: gauges.northgate },
  ),
}

/** The labels for `addresses` that exist, as the documents carry them. */
export function labelsFor(
  addresses: readonly (string | null | undefined)[],
): Record<string, ScanLabelItem> {
  const out: Record<string, ScanLabelItem> = {}
  for (const address of addresses) {
    if (typeof address !== "string") continue
    const found = labels[address.toLowerCase()]
    if (found !== undefined) out[found.address] = found
  }
  return out
}

// -- locks ----------------------------------------------------------------

function lock(
  fields: Partial<ScanLockItem> &
    Pick<ScanLockItem, "escrow" | "token_id" | "amount">,
): ScanLockItem {
  return {
    owner: wallet,
    unlock_at: null,
    created_at: at(30, 3_600),
    last_extended_at: null,
    withdrawn_at: null,
    is_permanent: false,
    is_withdrawn: false,
    is_merged: false,
    merged_into_token_id: null,
    merged_at: null,
    boost: null,
    activity_count: 1,
    updated_at: fixtureNow - 600,
    ...fields,
  }
}

export const locks: ScanLockItem[] = [
  lock({
    escrow: vebtc,
    token_id: "604",
    amount: units("1.2400"),
    is_permanent: true,
    created_at: at(31, 7_200),
    last_extended_at: at(40, 3_600),
    activity_count: 3,
  }),
  lock({
    escrow: vemezo,
    token_id: "2207",
    amount: units("18402.55"),
    unlock_at: 1_835_654_400,
    created_at: at(35, 50_000),
    boost: units("4.4"),
    activity_count: 5,
  }),
  lock({
    escrow: vebtc,
    token_id: "388",
    owner: otherVoter,
    amount: units("3.1047"),
    unlock_at: 1_826_582_400,
    created_at: at(12, 9_000),
  }),
  lock({
    escrow: vemezo,
    token_id: "2930",
    owner: otherVoter,
    amount: units("250000"),
    is_permanent: true,
    created_at: at(20, 1_000),
    boost: units("3.7"),
  }),
  lock({
    escrow: vebtc,
    token_id: "120",
    owner: otherVoter,
    amount: units("0.5"),
    unlock_at: at(44, 0),
    created_at: at(2, 600),
    withdrawn_at: at(45, 7_200),
    is_withdrawn: true,
  }),
]

export const escrowAddress = { vebtc, vemezo } as const

export function findLock(escrow: string, id: string): ScanLockItem | null {
  const address =
    escrow === "vebtc" || escrow === "vemezo" ? escrowAddress[escrow] : escrow
  return (
    locks.find((each) => each.escrow === address && each.token_id === id) ??
    null
  )
}

// -- votes ----------------------------------------------------------------

function vote(
  epoch: number,
  gauge: string,
  token: string,
  weight: string,
  fields: Partial<ScanLockVoteItem> = {},
): ScanLockVoteItem {
  return {
    epoch_start: epochStart(epoch),
    gauge,
    escrow: vemezo,
    token_id: token,
    source: "BOOST_VOTER",
    pool: null,
    weight: units(weight),
    voted_at: at(epoch, 3_700),
    carried: false,
    ...fields,
  }
}

export const lockVotes: ScanLockVoteItem[] = [
  vote(currentEpoch, gauges.kilnLabs, "2207", "12000"),
  vote(currentEpoch, gauges.northgate, "2207", "6402.55"),
  vote(currentEpoch, gauges.kilnLabs, "2930", "150000"),
  vote(currentEpoch, gauges.satsCollective, "2930", "100000"),
  vote(currentEpoch - 1, gauges.kilnLabs, "2207", "18402.55", {
    carried: true,
  }),
  vote(currentEpoch - 1, gauges.hearthCapital, "2930", "250000"),
  vote(currentEpoch - 2, gauges.northgate, "2207", "18402.55"),
]

// -- the chain ------------------------------------------------------------

/**
 * A lock the chain has and Scan's store does not yet: veBTC #6179, made by
 * the fixture voter minutes before the head, as 0xcc1b…2b2b made theirs on
 * 13 Nov 2026 (permanent, voting power its amount, no votes). The API
 * makes its row from the chain (`indexed: false`): no creation time, no
 * history.
 */
export const chainOnlyLock: ScanLockItem = {
  escrow: vebtc,
  token_id: "6179",
  owner: wallet,
  amount: units("0.05"),
  unlock_at: 0,
  created_at: null,
  last_extended_at: null,
  withdrawn_at: null,
  is_permanent: true,
  is_withdrawn: false,
  is_merged: false,
  merged_into_token_id: null,
  merged_at: null,
  boost: null,
  activity_count: null,
  updated_at: null,
}

/** Each escrow's longest lock: voting power decays over it. */
const maxLockSeconds: Record<string, bigint> = {
  [vebtc]: 28n * 86_400n,
  [vemezo]: 208n * 7n * 86_400n,
}

/**
 * A lock as the chain has it at the fixture head (the lock route's `live`):
 * a permanent lock votes its whole amount, a timed one its amount times
 * the time left over its escrow's longest lock (at most its amount); its
 * votes are this epoch's rows.
 * Null for a withdrawn or merged lock, which the API does not read.
 */
export function liveLockOf(lock: ScanLockItem): ScanLiveLock | null {
  if (lock.is_withdrawn || lock.is_merged) return null
  const left = BigInt(Math.max(0, (lock.unlock_at ?? 0) - fixtureNow))
  const amount = BigInt(lock.amount)
  const longest = maxLockSeconds[lock.escrow] ?? 1n
  const power = lock.is_permanent
    ? amount
    : left >= longest
      ? amount
      : (amount * left) / longest
  const votes = lockVotes.filter(
    (vote) =>
      vote.escrow === lock.escrow &&
      vote.token_id === lock.token_id &&
      vote.epoch_start === epochStart(currentEpoch),
  )
  const voted = votes.map((vote) => vote.voted_at)
  return {
    block: fixtureHead.block,
    voting_power: power.toString(),
    votes: votes.map((vote) => ({
      gauge: vote.gauge,
      source: vote.source,
      weight: vote.weight,
      voted_at: vote.voted_at,
    })),
    last_voted_at: voted.length === 0 ? null : Math.max(...voted),
  }
}

// -- activity -------------------------------------------------------------

let activitySeq = 0
function activity(
  fields: Partial<ScanActivityItem> &
    Pick<ScanActivityItem, "action_type" | "timestamp">,
): ScanActivityItem {
  activitySeq += 1
  const epoch = Math.floor((fields.timestamp - epochStart(0)) / 604_800)
  return {
    id: `fx-${activitySeq}`,
    tx_hash: fakeHash(`a${activitySeq.toString(16)}`),
    log_index: 0,
    block_number: 13_000_000 + activitySeq * 1_000,
    epoch_start: epochStart(epoch),
    source: "BOOST_VOTER",
    contract_address: vemezo,
    tx_from: wallet,
    actor: wallet,
    recipient: null,
    lock_escrow: null,
    token_id: null,
    amount: null,
    token: null,
    gauge: null,
    pool: null,
    reward_contract: null,
    weight: null,
    extra: {},
    ...fields,
  }
}

/** The recorded swap, as the jobs Worker decodes it. */
export const swapActivity = activity({
  action_type: "SWAP",
  tx_hash: fixtureIds.transaction,
  block_number: transaction.block_number,
  log_index: 0,
  timestamp: Math.floor(Date.parse(transaction.timestamp) / 1000),
  source: "DEX",
  contract_address: swapPool,
  pool: swapPool,
  token: musdcToken,
  amount: "5000000",
})

/** Newest first, as the API lists activity. */
export const walletActivity: ScanActivityItem[] = [
  swapActivity,
  activity({
    action_type: "BOOST_VOTE",
    timestamp: at(currentEpoch, 3_700),
    lock_escrow: vemezo,
    token_id: "2207",
    gauge: gauges.kilnLabs,
    weight: units("12000"),
    contract_address: fixtureIds.address,
  }),
  activity({
    action_type: "BOOST_VOTE",
    timestamp: at(currentEpoch, 3_700),
    log_index: 1,
    lock_escrow: vemezo,
    token_id: "2207",
    gauge: gauges.northgate,
    weight: units("6402.55"),
    contract_address: fixtureIds.address,
  }),
  activity({
    action_type: "VOTE_BRIBE_CLAIMED",
    timestamp: at(currentEpoch, 1_800),
    lock_escrow: vemezo,
    token_id: "2207",
    token: mezoToken,
    amount: units("6086.96"),
    gauge: gauges.kilnLabs,
  }),
  activity({
    action_type: "LOCK_EXTENDED",
    timestamp: at(40, 3_600),
    lock_escrow: vebtc,
    token_id: "604",
    contract_address: vebtc,
    extra: { post_duration: "126144000" },
  }),
  activity({
    action_type: "LOCK_PERMANENT",
    timestamp: at(40, 3_660),
    lock_escrow: vebtc,
    token_id: "604",
    contract_address: vebtc,
  }),
  activity({
    action_type: "LOCK_CREATED",
    timestamp: at(35, 50_000),
    lock_escrow: vemezo,
    token_id: "2207",
    token: mezoToken,
    amount: units("18402.55"),
  }),
  activity({
    action_type: "LOCK_CREATED",
    timestamp: at(31, 7_200),
    lock_escrow: vebtc,
    token_id: "604",
    token: btcToken,
    amount: units("1.2400"),
    contract_address: vebtc,
  }),
]

/** Activity across Mezo, newest first. */
/**
 * One transaction that refreshed votes four times, as the live indexer
 * writes pokes: no lock, no gauge, no actor, one row per log.
 */
const pokeHash = fakeHash("b250")
export const pokeActivity: ScanActivityItem[] = [3, 2, 1, 0].map((log) =>
  activity({
    action_type: "BOOST_POKE",
    id: `${pokeHash}-${log}-BOOST_POKE`,
    tx_hash: pokeHash,
    log_index: log,
    block_number: 13_118_400,
    timestamp: fixtureNow - 3_600,
    tx_from: otherVoter,
    actor: null,
  }),
)

export const allActivity: ScanActivityItem[] = [
  ...pokeActivity,
  ...walletActivity,
  activity({
    action_type: "INCENTIVE_ADDED",
    timestamp: at(currentEpoch, 900),
    tx_from: otherVoter,
    actor: otherVoter,
    gauge: gauges.kilnLabs,
    token: mezoToken,
    amount: units("6413.04"),
    contract_address: gauges.kilnLabs,
  }),
  activity({
    action_type: "BOOST_VOTE",
    timestamp: at(currentEpoch, 4_000),
    tx_from: otherVoter,
    actor: otherVoter,
    lock_escrow: vemezo,
    token_id: "2930",
    gauge: gauges.kilnLabs,
    weight: units("150000"),
    contract_address: fixtureIds.address,
  }),
].sort((a, b) => b.timestamp - a.timestamp)

// -- borrow ---------------------------------------------------------------

export const markets = {
  btcMusdc: MORPHO_MARKETS.mainnet.btcMusdc,
  btcMusd: MORPHO_MARKETS.mainnet.btcMusd,
  /**
   * The third market on Mezo (MUSD lent against BTC, 86% LLTV), which the
   * jobs Worker discovered from CreateMarket at block 13,118,789: in no
   * configured list, and with no positions yet.
   */
  discovered:
    "0x4bff245ddc101cd43e365aa1faff97351ab36a225e43d9a76aab82ff763030b8",
}

export const tokens = { btc: btcToken, musd: musdToken, musdc: musdcToken }

/** An Enclave and its debt manager (fixtures only). */
export const enclave = fakeAddress("e7c1a7e")
export const enclavePositionId = fakeHash("e7c1a7e01")
