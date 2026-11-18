import type { Abi, Address } from "viem"
import { GAUGE_EVENTS_ABI } from "./abis/gauges"
import {
  BORROWER_OPERATIONS_EVENTS_ABI,
  TROVE_MANAGER_EVENTS_ABI,
} from "./abis/musd"
import { POOL_EVENTS_ABI, POOL_FACTORY_EVENTS_ABI } from "./abis/pools"
import { VOTING_REWARD_EVENTS_ABI } from "./abis/rewards"
import {
  MERKLE_DISTRIBUTOR_EVENTS_ABI,
  MEZO_MINTER_EVENTS_ABI,
  MUSD_SAVINGS_RATE_EVENTS_ABI,
  PCV_EVENTS_ABI,
  REBASE_DISTRIBUTOR_EVENTS_ABI,
  SPLITTER_EVENTS_ABI,
} from "./abis/system"
import {
  BOOST_VOTER_EVENTS_ABI,
  NON_POOLS_VOTER_EVENTS_ABI,
  POOLS_VOTER_EVENTS_ABI,
} from "./abis/voters"
import { VOTING_ESCROW_EVENTS_ABI } from "./abis/voting-escrow"

// The indexer's view of Mezo: which kinds of contract it reads, which events
// it ingests for each, and the contracts it knows before discovery. Moved
// from apps/matchbox-indexer/src/ingest (store.ts, topics.ts and
// static-contracts.ts on Matchbox main) so addresses and ABIs have one home.

export const CONTRACT_KINDS = [
  "votingEscrow",
  "boostVoter",
  "poolsVoter",
  "thirdPartyVoter",
  "validatorsVoter",
  "splitter",
  "minter",
  "rebaseDistributor",
  "merkleDistributor",
  "musdSavingsRate",
  "pcv",
  "poolFactory",
  "pool",
  "gauge",
  "bribeVotingReward",
  "feeVotingReward",
  // Warehouse-only kinds: the explorer never indexed these.
  "voterBribeReward",
  "musdBorrowerOperations",
  "musdTroveManager",
] as const

export type ContractKind = (typeof CONTRACT_KINDS)[number]

/** The events ABI the indexer decodes each kind of contract with. */
export const EVENTS_ABI_BY_KIND: Record<ContractKind, Abi> = {
  votingEscrow: VOTING_ESCROW_EVENTS_ABI,
  boostVoter: BOOST_VOTER_EVENTS_ABI,
  poolsVoter: POOLS_VOTER_EVENTS_ABI,
  thirdPartyVoter: NON_POOLS_VOTER_EVENTS_ABI,
  validatorsVoter: NON_POOLS_VOTER_EVENTS_ABI,
  splitter: SPLITTER_EVENTS_ABI,
  minter: MEZO_MINTER_EVENTS_ABI,
  rebaseDistributor: REBASE_DISTRIBUTOR_EVENTS_ABI,
  merkleDistributor: MERKLE_DISTRIBUTOR_EVENTS_ABI,
  musdSavingsRate: MUSD_SAVINGS_RATE_EVENTS_ABI,
  pcv: PCV_EVENTS_ABI,
  poolFactory: POOL_FACTORY_EVENTS_ABI,
  pool: POOL_EVENTS_ABI,
  gauge: GAUGE_EVENTS_ABI,
  bribeVotingReward: VOTING_REWARD_EVENTS_ABI,
  feeVotingReward: VOTING_REWARD_EVENTS_ABI,
  voterBribeReward: VOTING_REWARD_EVENTS_ABI,
  musdBorrowerOperations: BORROWER_OPERATIONS_EVENTS_ABI,
  musdTroveManager: TROVE_MANAGER_EVENTS_ABI,
}

// Events the explorer subgraph handles, per contract kind (canonical
// signatures from apps/activity-subgraph/subgraph.yaml on main;
// test/ingest/manifest.test.ts fails on drift), plus the warehouse-only kinds
// at the end. Ingest stores only these: pools alone emit Sync/Fees/LP
// Transfer/Approval at roughly twice the rate of everything the decoder reads,
// which would not fit the warehouse. Widening a set is a config change plus a
// re-backfill (about 30 minutes).
const VOTE_EVENTS = [
  "Abstained(address,address,uint256,uint256,uint256,uint256)",
  "Voted(address,address,uint256,uint256,uint256,uint256)",
  "DistributeReward(address,address,uint256)",
  "GaugeKilled(address)",
  "GaugeRevived(address)",
  "NotifyReward(address,address,uint256)",
]

const REWARD_EVENTS = [
  "NotifyReward(address,address,uint256,uint256)",
  "ClaimRewards(address,address,uint256)",
]

export const INDEXED_EVENTS: Record<ContractKind, string[]> = {
  votingEscrow: [
    "Deposit(address,uint256,uint8,uint256,uint256,uint256)",
    "LockPermanent(address,uint256,uint256,uint256)",
    "Merge(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
    "UnlockPermanent(address,uint256,uint256,uint256)",
    "Withdraw(address,uint256,uint256,uint256)",
    "Transfer(address,address,uint256)",
    "UpdateBoost(uint256,uint256)",
  ],
  boostVoter: [
    ...VOTE_EVENTS,
    "GaugeCreated(address,address,address)",
    "BoostPoked(uint256,uint256)",
    "BoostableTokenBurned(uint256,address)",
    "BribesAdded(address,address,uint256,address)",
  ],
  poolsVoter: [
    ...VOTE_EVENTS,
    "GaugeCreated(address,address,address,address,address,address,address,address)",
  ],
  thirdPartyVoter: [
    ...VOTE_EVENTS,
    "GaugeCreated(address,address,address)",
    "BribesAdded(address,address,uint256,address)",
    "ThirdPartyGaugeCreated(address,address,string)",
  ],
  validatorsVoter: [
    ...VOTE_EVENTS,
    "GaugeCreated(address,address,address)",
    "BribesAdded(address,address,uint256,address)",
    "ValidatorGaugeCreated(address,address,address)",
    "ValidatorLeft(address,address)",
  ],
  splitter: [
    "PeriodUpdated(uint256,uint256,uint256,uint256)",
    "Nudge(uint256,uint256,uint256)",
  ],
  minter: [
    "EpochProcessed(uint256,uint256,uint256,uint256,uint256,uint256,address)",
    "EmissionsEnabled(uint256)",
  ],
  rebaseDistributor: [
    "Claimed(uint256,uint256,uint256,uint256)",
    "CheckpointToken(uint256,uint256)",
  ],
  merkleDistributor: [
    "Claimed(uint256,uint256,address,uint256)",
    "DistributionAdded(uint256,bytes32,uint256,address,bytes)",
  ],
  musdSavingsRate: [
    "Deposit(address,uint256)",
    "Withdraw(address,uint256)",
    "YieldClaimed(address,uint256)",
    "ProtocolYieldReceived(uint256)",
    "StrategyYieldReceived(uint256)",
  ],
  pcv: ["PCVDistribution(address,uint256)", "PCVDebtPayment(uint256)"],
  poolFactory: ["PoolCreated(address,address,bool,address,uint256)"],
  pool: [
    "Mint(address,uint256,uint256)",
    "Burn(address,address,uint256,uint256)",
    "Swap(address,address,uint256,uint256,uint256,uint256)",
  ],
  gauge: [
    "Deposit(address,address,uint256)",
    "Withdraw(address,uint256)",
    "ClaimRewards(address,uint256)",
  ],
  bribeVotingReward: REWARD_EVENTS,
  feeVotingReward: REWARD_EVENTS,
  // Bribe rewards of BoostVoter, ValidatorsVoter and ThirdPartyVoter gauges.
  voterBribeReward: REWARD_EVENTS,
  // mUSD troves. TroveUpdated changed signature in musd 1.0.2: the 6-argument
  // form is the older one (still emitted on testnet, never on mainnet).
  musdBorrowerOperations: [
    "TroveUpdated(address,uint256,uint256,uint256,uint256,uint16,uint256,uint8)",
    "TroveUpdated(address,uint256,uint256,uint256,uint256,uint8)",
    "TroveCreated(address,uint256)",
    "BorrowingFeePaid(address,uint256)",
    "RefinancingFeePaid(address,uint256)",
  ],
  musdTroveManager: [
    "TroveUpdated(address,uint256,uint256,uint256,uint256,uint16,uint256,uint8)",
    "TroveUpdated(address,uint256,uint256,uint256,uint256,uint8)",
    "TroveLiquidated(address,uint256,uint256,uint8)",
    "Redemption(uint256,uint256,uint256,uint256)",
  ],
}

// First blocks with code (eth_getCode bisection on rpc-internal, 2026-10-21).
// BorrowerOperations' first log is in that same block.
export const MUSD_BORROWER_OPERATIONS_DEPLOY_BLOCK = 178_630n
export const MUSD_TROVE_MANAGER_DEPLOY_BLOCK = 178_660n

/**
 * A contract the indexer knows before discovery. `fromBlock` is the first
 * block ingest fetches its logs from: "networkStart" for core contracts (the
 * indexer's configured start block), the creation block for the Legacy*
 * reward contracts and the mUSD contracts. Addresses are lowercase.
 */
export type StaticContract = {
  template: string
  kind: ContractKind
  address: Address
  pool: Address | null
  gauge: Address | null
  fromBlock: bigint | "networkStart"
}

type LegacyLink = { pool: Address; gauge: Address; fromBlock: bigint }

function staticContract(
  template: string,
  kind: ContractKind,
  address: Address,
  legacy?: LegacyLink,
): StaticContract {
  return {
    template,
    kind,
    address,
    pool: legacy?.pool ?? (kind === "pool" ? address : null),
    gauge: legacy?.gauge ?? null,
    fromBlock: legacy?.fromBlock ?? "networkStart",
  }
}

// The explorer subgraph's static data sources (apps/activity-subgraph/
// subgraph.yaml on Matchbox main).
export const EXPLORER_STATIC_CONTRACTS: StaticContract[] = [
  staticContract(
    "VeMEZO",
    "votingEscrow",
    "0xb90fdad3dfd180458d62cc6acedc983d78e20122",
  ),
  staticContract(
    "VeBTC",
    "votingEscrow",
    "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279",
  ),
  staticContract(
    "BoostVoter",
    "boostVoter",
    "0x2ba614a598cffa5a19d683cdca97bac3a49313d1",
  ),
  staticContract(
    "PoolsVoter",
    "poolsVoter",
    "0x48233ccc97b87ba93bca212cbee48e3210211f03",
  ),
  staticContract(
    "ThirdPartyVoter",
    "thirdPartyVoter",
    "0x2e6d2f2cacc1d24f9f9358030674eb307397a6eb",
  ),
  staticContract(
    "ValidatorsVoter",
    "validatorsVoter",
    "0xe99a9ad5ed26bd30e4db25397f378817e9b9515a",
  ),
  staticContract(
    "ChainFeeSplitter",
    "splitter",
    "0x0268aba7fab1cec04ce557313c94d5832b407aa3",
  ),
  staticContract(
    "MezoChainSplitter",
    "splitter",
    "0x5c6ef634e279a77d64e21d24b1a1bb4a5e59c5da",
  ),
  staticContract(
    "MezoEcosystemSplitter",
    "splitter",
    "0xe9e697d49d47c7042e768177f42d5789666d99fa",
  ),
  staticContract(
    "MezoMinter",
    "minter",
    "0x66bff681611553b3204a226b2019ec621f39ffc3",
  ),
  staticContract(
    "MezoRebaseDistributor",
    "rebaseDistributor",
    "0x075108f275ed81c9cfc01065e6e50ceea81d6363",
  ),
  staticContract(
    "MezoMerkleDistributor",
    "merkleDistributor",
    "0xb91fbb559216683aa2558596d96718407631e82d",
  ),
  staticContract(
    "MUSDSavingsRate",
    "musdSavingsRate",
    "0xb4d498029af77680cd1ef828b967f010d06c51cc",
  ),
  staticContract("PCV", "pcv", "0x391ecc7ffefc48cff41d0f2bb36e38b82180b993"),
  staticContract(
    "PoolFactory",
    "poolFactory",
    "0x83fe469c636c4081b87ba5b3ae9991c6ed104248",
  ),
  staticContract(
    "PoolMusdBtc",
    "pool",
    "0x52e604c44417233b6ccedddc0d640a405caacefb",
  ),
  staticContract(
    "PoolMusdMusdc",
    "pool",
    "0xed812aec0fecc8fd882ac3eccc43f3aa80a6c356",
  ),
  staticContract(
    "PoolMusdMusdt",
    "pool",
    "0x10906a9e9215939561597b4c8e4b98f93c02031a",
  ),
  staticContract(
    "LegacyBribeMUSDmUSDT",
    "bribeVotingReward",
    "0x6f3e2afc81a8fd8e3490ddb032a91d339b371afb",
    {
      pool: "0x10906a9e9215939561597b4c8e4b98f93c02031a",
      gauge: "0x4887fa1c88f8927932e5e1545b3b29a1a29656e7",
      fromBlock: 5231392n,
    },
  ),
  staticContract(
    "LegacyBribeBTCmxSolvBTC",
    "bribeVotingReward",
    "0x7c90026167ff9051fec3e14a5ec486e484722ded",
    {
      pool: "0x329d64572f8922c3fe90d23a3c74a360d8ea6235",
      gauge: "0x3aecbfc4aa3fc152fbefd427f87db1e97226dc20",
      fromBlock: 5231405n,
    },
  ),
  staticContract(
    "LegacyBribeMUSDCmUSDT",
    "bribeVotingReward",
    "0xa908809b0602606f86a745e13296881a9b267462",
    {
      pool: "0x2a1ab0224a7a608d3a992cb15594a2934f74f4c0",
      gauge: "0x548289b8983398db857efbb1e0cec489d72a6355",
      fromBlock: 5231405n,
    },
  ),
  staticContract(
    "LegacyBribeBTCMUSD",
    "bribeVotingReward",
    "0x94a9a494872bf7231d8378d0aef7d32ba552e305",
    {
      pool: "0x52e604c44417233b6ccedddc0d640a405caacefb",
      gauge: "0x8be20a5ff57e381025ae5e3a121b697269569aaf",
      fromBlock: 5231418n,
    },
  ),
  staticContract(
    "LegacyBribeMSolvBTCMUSD",
    "bribeVotingReward",
    "0xa2e2f01f9342582557917d114cabcce4a26bb47f",
    {
      pool: "0x5cd2a025c001e07ae354a4c22c3009908de1ac59",
      gauge: "0xf93b51466519b7c9ca318f1bde0524530632af90",
      fromBlock: 5231418n,
    },
  ),
  staticContract(
    "LegacyBribeMcbBTCBTC",
    "bribeVotingReward",
    "0x0377249dd6916f335048c7cd5541022b6ec2185c",
    {
      pool: "0x72e6b3f126cf4f6c90c08114ac29038a0e269210",
      gauge: "0xf482d0edb24c888d63a031de71d963c4f4fa79e4",
      fromBlock: 5231440n,
    },
  ),
  staticContract(
    "LegacyBribeMTMUSD",
    "bribeVotingReward",
    "0xf4c0067b6a38ca5b28fb2c8e1d8a2a20d20d2af3",
    {
      pool: "0x6688f868e9c81ee671867e77fbc618bbea2e9782",
      gauge: "0x39e06c2a671a237897ccbf9166a136eb5bdda432",
      fromBlock: 5231440n,
    },
  ),
  staticContract(
    "LegacyBribeBTCmSolvBTC",
    "bribeVotingReward",
    "0x52a9a4310a1567ce828df137b2ead4883c0221cf",
    {
      pool: "0xf6f950485b0a65828f07581ca979ef1271778d6a",
      gauge: "0x0edca8717ab81363ff722ab7bd45060800632ec8",
      fromBlock: 5231459n,
    },
  ),
  staticContract(
    "LegacyBribeMUSDCMUSD",
    "bribeVotingReward",
    "0xf2b88ec68c8fbd5261c5483d1385c46dc7619589",
    {
      pool: "0xed812aec0fecc8fd882ac3eccc43f3aa80a6c356",
      gauge: "0x2945401f5e015a122b482de0ea5bf92c005c3c75",
      fromBlock: 5231459n,
    },
  ),
  staticContract(
    "LegacyFeeMUSDmUSDT",
    "feeVotingReward",
    "0x24e2d2efc692aab0ae54e0dd8b4c19aabc463c3b",
    {
      pool: "0x10906a9e9215939561597b4c8e4b98f93c02031a",
      gauge: "0x4887fa1c88f8927932e5e1545b3b29a1a29656e7",
      fromBlock: 5231392n,
    },
  ),
  staticContract(
    "LegacyFeeBTCmxSolvBTC",
    "feeVotingReward",
    "0xce8c65d38d3eb67263a658802cb86ce963679871",
    {
      pool: "0x329d64572f8922c3fe90d23a3c74a360d8ea6235",
      gauge: "0x3aecbfc4aa3fc152fbefd427f87db1e97226dc20",
      fromBlock: 5231405n,
    },
  ),
  staticContract(
    "LegacyFeeMUSDCmUSDT",
    "feeVotingReward",
    "0xbbb03e37546e051f2588e12c47f804a216320c10",
    {
      pool: "0x2a1ab0224a7a608d3a992cb15594a2934f74f4c0",
      gauge: "0x548289b8983398db857efbb1e0cec489d72a6355",
      fromBlock: 5231405n,
    },
  ),
  staticContract(
    "LegacyFeeBTCMUSD",
    "feeVotingReward",
    "0x0453820c89084e20658068a27ebb90824f1a6c6d",
    {
      pool: "0x52e604c44417233b6ccedddc0d640a405caacefb",
      gauge: "0x8be20a5ff57e381025ae5e3a121b697269569aaf",
      fromBlock: 5231418n,
    },
  ),
  staticContract(
    "LegacyFeeMSolvBTCMUSD",
    "feeVotingReward",
    "0x0fcf5322dedbe67b68208199db234e98ef54c888",
    {
      pool: "0x5cd2a025c001e07ae354a4c22c3009908de1ac59",
      gauge: "0xf93b51466519b7c9ca318f1bde0524530632af90",
      fromBlock: 5231418n,
    },
  ),
  staticContract(
    "LegacyFeeMcbBTCBTC",
    "feeVotingReward",
    "0x7ab52a8fc9f9100fec58a5ee319ddb872c1208d7",
    {
      pool: "0x72e6b3f126cf4f6c90c08114ac29038a0e269210",
      gauge: "0xf482d0edb24c888d63a031de71d963c4f4fa79e4",
      fromBlock: 5231440n,
    },
  ),
  staticContract(
    "LegacyFeeMTMUSD",
    "feeVotingReward",
    "0xf702cd0c9fcfd453165aef6c84627937695d5a6c",
    {
      pool: "0x6688f868e9c81ee671867e77fbc618bbea2e9782",
      gauge: "0x39e06c2a671a237897ccbf9166a136eb5bdda432",
      fromBlock: 5231440n,
    },
  ),
  staticContract(
    "LegacyFeeBTCmSolvBTC",
    "feeVotingReward",
    "0x4989d0128724b8b9d5d12bc98f1df9d4adafbbfa",
    {
      pool: "0xf6f950485b0a65828f07581ca979ef1271778d6a",
      gauge: "0x0edca8717ab81363ff722ab7bd45060800632ec8",
      fromBlock: 5231459n,
    },
  ),
  staticContract(
    "LegacyFeeMUSDCMUSD",
    "feeVotingReward",
    "0x898bbe9353dc576745724e8c64a02472645561cd",
    {
      pool: "0xed812aec0fecc8fd882ac3eccc43f3aa80a6c356",
      gauge: "0x2945401f5e015a122b482de0ea5bf92c005c3c75",
      fromBlock: 5231459n,
    },
  ),
]

// Not explorer data sources. The mUSD contracts start at their deployment
// block (first block with code), before the network start: trove history
// begins there, and each TroveUpdated delta needs the trove's previous state.
export const WAREHOUSE_STATIC_CONTRACTS: StaticContract[] = [
  {
    ...staticContract(
      "MusdBorrowerOperations",
      "musdBorrowerOperations",
      "0x44b1bac67dda612a41a58aaf779143b181dee031",
    ),
    fromBlock: MUSD_BORROWER_OPERATIONS_DEPLOY_BLOCK,
  },
  {
    ...staticContract(
      "MusdTroveManager",
      "musdTroveManager",
      "0x94afb503dbca74ac3e4929baceedfce19b93c193",
    ),
    fromBlock: MUSD_TROVE_MANAGER_DEPLOY_BLOCK,
  },
]

/**
 * Each mainnet escrow's MAXTIME, the longest lock and the end
 * UnlockPermanent sets (`floor((now + MAXTIME) / WEEK) * WEEK`). It is
 * `maxLockTime` in the escrows' storage struct (slot ESCROW_MAXTIME_SLOT;
 * no getter): veMEZO's initializer hard-codes 208 weeks, veBTC's takes it
 * as an initializer argument (28 days). The verified implementations
 * (veBTC 0x41d0…5ae3, veMEZO 0x38fb…0d9c) write it only in the initializer
 * ("SHOULD NOT be changed after deployment"), so it can change only through
 * a proxy upgrade; the indexer reads the slot every tick and alerts on
 * drift (apps/indexer/src/escrow-maxtime.ts). Confirmed on 11 Nov 2026 by
 * UnlockPermanent ends (veBTC tokens 5306 and 5963 at 26.1 and 21.2 days,
 * veMEZO 2348 and 2924 at 1,449.1 and 1,449.4 days, which fits 208 weeks
 * and not 4 x 365 days) and the slot values.
 */
export const ESCROW_MAXTIME: Readonly<Record<Address, bigint>> = {
  // veBTC: 28 days.
  "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279": 2_419_200n,
  // veMEZO: 208 weeks.
  "0xb90fdad3dfd180458d62cc6acedc983d78e20122": 125_798_400n,
}

/** Storage slot of `maxLockTime` on both escrow proxies (read 11 Nov 2026). */
export const ESCROW_MAXTIME_SLOT = 82n

/** Mezo mainnet. Testnet waits until its contract set is measured. */
export const MEZO_STATIC_CONTRACTS: StaticContract[] = [
  ...EXPLORER_STATIC_CONTRACTS,
  ...WAREHOUSE_STATIC_CONTRACTS,
]
