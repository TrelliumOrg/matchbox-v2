import { parseAbi } from "viem"

// mUSD (mezo-org/musd, solidity/contracts/interfaces). Event signatures and
// indexed flags match the interfaces on musd main; function signatures were
// checked against the mainnet contracts with eth_call on 8 Nov 2026.
//
// TroveUpdated has two signatures: the 8-argument one from musd 1.0.2 and the
// older 6-argument one (musd commit 414e5e2 added the rate and update time).
// The 6-argument form is still emitted on testnet, never on mainnet. Both
// BorrowerOperations and TroveManager emit it.

/** The two TroveUpdated forms the indexer decodes. */
export const MUSD_TROVE_UPDATED_EVENTS_ABI = [
  {
    type: "event",
    name: "TroveUpdated",
    anonymous: false,
    inputs: [
      {
        name: "_borrower",
        type: "address",
        indexed: true,
      },
      {
        name: "_principal",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_interest",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_coll",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_stake",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_interestRate",
        type: "uint16",
        indexed: false,
      },
      {
        name: "_lastInterestUpdateTime",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_operation",
        type: "uint8",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "TroveUpdated",
    anonymous: false,
    inputs: [
      {
        name: "_borrower",
        type: "address",
        indexed: true,
      },
      {
        name: "_principal",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_interest",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_coll",
        type: "uint256",
        indexed: false,
      },
      {
        name: "stake",
        type: "uint256",
        indexed: false,
      },
      {
        name: "operation",
        type: "uint8",
        indexed: false,
      },
    ],
  },
] as const

/** Every BorrowerOperations event the indexer ingests. */
export const BORROWER_OPERATIONS_EVENTS_ABI = [
  ...MUSD_TROVE_UPDATED_EVENTS_ABI,
  ...parseAbi([
    "event TroveCreated(address indexed _borrower, uint256 arrayIndex)",
    "event BorrowingFeePaid(address indexed _borrower, uint256 _fee)",
    "event RefinancingFeePaid(address indexed _borrower, uint256 _fee)",
  ]),
] as const

/** Every TroveManager event the indexer ingests. */
export const TROVE_MANAGER_EVENTS_ABI = [
  ...MUSD_TROVE_UPDATED_EVENTS_ABI,
  ...parseAbi([
    "event TroveLiquidated(address indexed _borrower, uint256 _debt, uint256 _coll, uint8 operation)",
    "event Redemption(uint256 _attemptedAmount, uint256 _actualAmount, uint256 _collateralSent, uint256 _collateralFee)",
  ]),
] as const

/** Trove status as TroveManager.getTroveStatus and Troves() return it. */
export type TroveStatus =
  | "nonExistent"
  | "active"
  | "closedByOwner"
  | "closedByLiquidation"
  | "closedByRedemption"

export const TROVE_STATUSES: readonly TroveStatus[] = [
  "nonExistent",
  "active",
  "closedByOwner",
  "closedByLiquidation",
  "closedByRedemption",
]

export const TROVE_MANAGER_ABI = [
  ...parseAbi([
    "function Troves(address) view returns (uint256 coll, uint256 principal, uint256 interestOwed, uint256 stake, uint8 status, uint16 interestRate, uint256 lastInterestUpdateTime, uint256 maxBorrowingCapacity, uint128 arrayIndex)",
    "function getTroveOwnersCount() view returns (uint256)",
    "function getTroveFromTroveOwnersArray(uint256 _index) view returns (address)",
    "function getEntireDebtAndColl(address _borrower) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
    "function getEntireSystemColl() view returns (uint256)",
    "function getEntireSystemDebt() view returns (uint256)",
    "function getTroveStatus(address _borrower) view returns (uint8)",
    "function getTroveColl(address _borrower) view returns (uint256)",
    "function getTroveDebt(address _borrower) view returns (uint256)",
    "function getTroveStake(address _borrower) view returns (uint256)",
    "function getTroveInterestRate(address _borrower) view returns (uint16)",
    "function getTroveLastInterestUpdateTime(address _borrower) view returns (uint256)",
    "function getTroveMaxBorrowingCapacity(address _borrower) view returns (uint256)",
    "function getNominalICR(address _borrower) view returns (uint256)",
    "function getCurrentICR(address _borrower, uint256 _price) view returns (uint256)",
    "function getTCR(uint256 _price) view returns (uint256)",
    "function checkRecoveryMode(uint256 _price) view returns (bool)",
    "function totalStakes() view returns (uint256)",
    "function L_Collateral() view returns (uint256)",
    "function L_Principal() view returns (uint256)",
    "function L_Interest() view returns (uint256)",
    "function MCR() view returns (uint256)",
    "function CCR() view returns (uint256)",
    "function MUSD_GAS_COMPENSATION() view returns (uint256)",
    "function sortedTroves() view returns (address)",
    "function stabilityPool() view returns (address)",
    "function priceFeed() view returns (address)",
  ]),
  ...TROVE_MANAGER_EVENTS_ABI,
] as const

export const BORROWER_OPERATIONS_ABI = [
  ...parseAbi([
    "function minNetDebt() view returns (uint256)",
    "function repayMUSD(uint256 _amount, address _upperHint, address _lowerHint)",
    "function claimCollateral()",
  ]),
  ...BORROWER_OPERATIONS_EVENTS_ABI,
] as const

/** Troves ordered by nominal ICR, lowest risk first. */
export const SORTED_TROVES_ABI = parseAbi([
  "function getSize() view returns (uint256)",
  "function getMaxSize() view returns (uint256)",
  "function getFirst() view returns (address)",
  "function getLast() view returns (address)",
  "function getNext(address _id) view returns (address)",
  "function getPrev(address _id) view returns (address)",
  "function contains(address _id) view returns (bool)",
  "function isEmpty() view returns (bool)",
])

export const STABILITY_POOL_ABI = parseAbi([
  "function getTotalMUSDDeposits() view returns (uint256)",
  "function getCollateralBalance() view returns (uint256)",
  "function getCompoundedMUSDDeposit(address _depositor) view returns (uint256)",
  "function getDepositorCollateralGain(address _depositor) view returns (uint256)",
  "function P() view returns (uint256)",
  "function currentEpoch() view returns (uint128)",
  "function currentScale() view returns (uint128)",
])

/** 1e18-scaled USD per BTC. Reverts when the oracle is stale. */
export const PRICE_FEED_ABI = parseAbi([
  "function fetchPrice() view returns (uint256)",
])

export const COLL_SURPLUS_POOL_ABI = parseAbi([
  "function getCollateral(address _account) view returns (uint256)",
])
