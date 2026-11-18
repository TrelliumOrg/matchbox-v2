import { CONTRACTS, MUSD_CONTRACTS } from "@matchbox/chain"
import { getAddress, parseAbi } from "viem"

// Contract ABIs and addresses come from @matchbox/chain. This file keeps
// only what chain does not have yet (each verified against the deployed
// contracts on feat/pro-rebuild): PoolsVoter's combined fee and bribe
// claim, the Aerodrome Slipstream pool, quoter and router Stuart's zap
// quotes and routes through, MUSD Savings' deposit, and the Skip BTC/USD
// oracle read.

/** PoolsVoter claims fees and bribes in one call; chain lists them apart. */
export const POOLS_VOTER_CLAIM_ABI = parseAbi([
  "function claimFeesAndBribes(address[] rewards, address[][] tokens, uint256 tokenId)",
])

export const CL_POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
  "function fee() view returns (uint24)",
])

export const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, int24 tickSpacing, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
])

export const SWAP_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, int24 tickSpacing, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
])

export const SAVINGS_ABI = parseAbi(["function deposit(uint256 amount)"])

export const SKIP_ORACLE_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
])

const chain = CONTRACTS.mainnet
const musd = MUSD_CONTRACTS.mainnet

// Mezo mainnet (31612). Stuart v1 prepares mainnet proposals only.
export const MAINNET = {
  boostVoter: chain.boostVoter,
  poolsVoter: chain.poolsVoter,
  validatorsVoter: chain.validatorsVoter,
  thirdPartyVoter: chain.thirdPartyVoter,
  validatorPool: chain.validatorPool,
  veMEZO: chain.veMEZO,
  veBTC: chain.veBTC,
  mezo: chain.mezoToken,
  musd: musd.musd,
  borrowerOperations: musd.borrowerOperations,
  troveManager: musd.troveManager,
  priceFeed: musd.priceFeed,
  collSurplusPool: musd.collSurplusPool,
  musdSavings: musd.savingsRate,
  // Not in @matchbox/chain yet.
  skipOracle: getAddress("0x7b7c000000000000000000000000000000000015"),
  clSwapRouter: getAddress("0x37cDd11919ec3860eaD9efB8673d7476E5326225"),
  clQuoter: getAddress("0x4E56aF2d49D3D8F9a99155b31dd117ccDD545dC7"),
  clPoolMezoMusd200: getAddress("0x1D6e8D24c133535F2d00676F66a0e824f84765ff"),
} as const
