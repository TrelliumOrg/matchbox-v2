import { keccak256, parseAbi, toHex } from "viem"

// Enclave borrowing (Mezo musd contracts/musd/EnclaveDebtManager.sol and the
// Enclave custody contract). Event signatures and indexed flags come from
// the verified implementations on Blockscout: EnclaveDebtManager
// 0x3Ea98a11D349B515e628C1CC74ca999230744C43, Enclave 0xf74D1bDd…273d and
// 0x05bd601c…4a69 (same events). docs/research/mezo-borrow-markets.md,
// "Enclaves", explains the system.

/** EnclaveDebtManager's role for Enclave contracts (keccak256("ENCLAVE_ROLE")). */
export const ENCLAVE_ROLE = keccak256(toHex("ENCLAVE_ROLE"))

/** Every EnclaveDebtManager event. */
export const ENCLAVE_DEBT_MANAGER_EVENTS_ABI = parseAbi([
  "event PositionOpened(bytes32 indexed positionId, address indexed enclave, address indexed borrower, uint256 debtAmount, address originator, uint16 interestRate, uint16 originatorFeeRate, uint256 warningCR, uint256 minimumCR, uint256[] pledgedVeBtc)",
  "event DebtIncreased(bytes32 indexed positionId, uint256 additionalDebt, uint256 newPrincipal)",
  "event DebtRepaid(bytes32 indexed positionId, uint256 amount, uint256 remainingPrincipal)",
  "event PositionClosed(bytes32 indexed positionId)",
  "event PledgedVeBtcAdded(bytes32 indexed positionId, uint256[] tokenIdsAdded, uint256[] pledgedTokenIds)",
  "event PledgedVeBtcRemoved(bytes32 indexed positionId, uint256[] tokenIdsRemoved, uint256[] pledgedTokenIds)",
  "event PositionCRThresholdsSet(bytes32 indexed positionId, uint256 warningCR, uint256 minimumCR)",
  "event PositionInterestRateSet(bytes32 indexed positionId, uint16 oldRate, uint16 newRate)",
  "event PositionOriginatorFeeRateSet(bytes32 indexed positionId, uint16 oldRate, uint16 newRate)",
  "event InterestAccrued(uint256 interest, uint256 totalInterestMinted)",
  "event OriginatorFeeAccrued(address indexed originator, uint256 originatorFee, uint256 totalOriginatorFeeMinted)",
  "event MaxRateSet(uint16 maxRate)",
  "event MintCapSet(uint256 mintCap)",
  "event Paused(address account)",
  "event Unpaused(address account)",
  "event Initialized(uint8 version)",
  "event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
])

/** Position status as EnclaveDebtManager.getPosition returns it. */
export type EnclavePositionStatus =
  | "nonExistent"
  | "active"
  | "closedByRepayment"
  | "closedByLiquidation"

export const ENCLAVE_POSITION_STATUSES: readonly EnclavePositionStatus[] = [
  "nonExistent",
  "active",
  "closedByRepayment",
  "closedByLiquidation",
]

/** EnclaveDebtManager views (verified ABI). */
export const ENCLAVE_DEBT_MANAGER_ABI = [
  ...ENCLAVE_DEBT_MANAGER_EVENTS_ABI,
  ...parseAbi([
    "function getPosition(bytes32 positionId) view returns ((uint256 principal, uint256 storedInterest, uint256 storedOriginatorFee, uint256 lastUpdateTimestamp, uint16 interestRate, uint16 originatorFeeRate, uint256 warningCR, uint256 minimumCR, address enclave, address borrower, address originator, uint8 status, uint256[] pledgedVeBtc))",
    "function getPledgedVeBtc(bytes32 positionId) view returns (uint256[])",
    "function getPositionDebt(bytes32 positionId) view returns (uint256 principal, uint256 accruedInterest, uint256 accruedOriginatorFee, uint256 totalDebt)",
    "function getPositionCollateral(bytes32 positionId) view returns (uint256)",
    "function getPositionCR(bytes32 positionId) view returns (uint256)",
    "function getPositionHealthStatus(bytes32 positionId) view returns (uint256 currentCR, uint256 warningCR, uint256 minimumCR, bool isBelowWarning, bool isBelowMinimum)",
    "function getVeBtcPositionId(uint256 tokenId) view returns (bytes32)",
    "function getTotalOutstandingDebt() view returns (uint256)",
    "function totalPrincipal() view returns (uint256)",
    "function totalMintedDebt() view returns (uint256)",
    "function totalDebtBurned() view returns (uint256)",
    "function totalInterestMinted() view returns (uint256)",
    "function mintCap() view returns (uint256)",
    "function maxRate() view returns (uint16)",
    "function paused() view returns (bool)",
    "function getRoleMemberCount(bytes32 role) view returns (uint256)",
    "function getRoleMember(bytes32 role, uint256 index) view returns (address)",
  ]),
] as const

/** Enclave events: veBTC locks the Enclave holds, and the BTC bridged in. */
export const ENCLAVE_EVENTS_ABI = parseAbi([
  "event VeBTCLocked(uint256 indexed tokenId, uint256 amount, uint256 lockDuration)",
  "event VeBTCIncreased(uint256 indexed tokenId, uint256 amount)",
  "event VeBTCMerged(uint256 indexed fromTokenId, uint256 indexed toTokenId)",
  "event VeBTCWithdrawn(uint256 indexed tokenId)",
  "event TripartyBridgeRequested(uint256 indexed requestId, uint256 amount, (bytes32 txHash, uint32 txOutputIndex, uint64 txOutputValue) utxo)",
  "event TripartyBridgeCompleted(uint256 indexed requestId)",
  "event CallExecuted(address indexed addr, bytes4 selector, bytes data, bytes returnData)",
  "event TargetAdded(address indexed addr, bytes4 selector)",
  "event TargetRemoved(address indexed addr, bytes4 selector)",
])

/** OpenZeppelin ERC1967 proxy upgrade event (all three borrow proxies). */
export const PROXY_UPGRADED_EVENTS_ABI = parseAbi([
  "event Upgraded(address indexed implementation)",
])
