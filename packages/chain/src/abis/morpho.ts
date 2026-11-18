import { parseAbi } from "viem"

// Morpho Blue (morpho-org/morpho-blue src/libraries/EventsLib.sol), as
// verified on Mezo at 0x565834cE7E40b8987BC20EbF83E2159467bDA311. The
// contract emits these from a library, so Blockscout's contract ABI lists
// none of them; the signatures below match the verified EventsLib source and
// the topics of every log the contract has emitted.

/** Every Morpho Blue event. */
export const MORPHO_BLUE_EVENTS_ABI = parseAbi([
  "event SetOwner(address indexed newOwner)",
  "event SetFee(bytes32 indexed id, uint256 newFee)",
  "event SetFeeRecipient(address indexed newFeeRecipient)",
  "event EnableIrm(address indexed irm)",
  "event EnableLltv(uint256 lltv)",
  "event CreateMarket(bytes32 indexed id, (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)",
  "event Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
  "event Withdraw(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)",
  "event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)",
  "event Repay(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
  "event SupplyCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets)",
  "event WithdrawCollateral(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets)",
  "event Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)",
  "event FlashLoan(address indexed caller, address indexed token, uint256 assets)",
  "event SetAuthorization(address indexed caller, address indexed authorizer, address indexed authorized, bool newIsAuthorized)",
  "event IncrementNonce(address indexed caller, address indexed authorizer, uint256 usedNonce)",
  "event AccrueInterest(bytes32 indexed id, uint256 prevBorrowRate, uint256 interest, uint256 feeShares)",
])

/** Morpho Blue views (verified ABI). */
export const MORPHO_BLUE_ABI = [
  ...MORPHO_BLUE_EVENTS_ABI,
  ...parseAbi([
    "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
    "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
    "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
    "function owner() view returns (address)",
    "function feeRecipient() view returns (address)",
  ]),
] as const

/** AdaptiveCurveIrm views. */
export const ADAPTIVE_CURVE_IRM_ABI = parseAbi([
  "function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)",
  "function rateAtTarget(bytes32 id) view returns (int256)",
])

/** A Morpho Blue market oracle: collateral price scaled by 1e36. */
export const MORPHO_ORACLE_ABI = parseAbi([
  "function price() view returns (uint256)",
])
