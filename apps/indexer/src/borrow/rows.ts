import type { BorrowContractKind } from "@matchbox/chain"
import type { Address, Hex } from "viem"
import type { Network } from "../ingest/networks"

// Rows of the borrow tables (db/migrations/matchbox/0012_borrow.sql). Amounts
// are exact bigints here and decimal strings on the way to Postgres
// (numeric(78,0)); nothing converts them to floating point.

/** A contract the borrow stream fetches logs for (matchbox.borrow_contracts). */
export type BorrowContract = {
  network: Network
  address: Address
  kind: BorrowContractKind
  template: string
  createdBlock: bigint
  createdTx: Hex | null
}

// The CHECK constraints in 0012_borrow.sql list the same values
// (test/borrow/schema.test.ts).
export const MORPHO_ACTIONS = [
  "MARKET_CREATED",
  "SUPPLIED",
  "WITHDRAWN",
  "COLLATERAL_SUPPLIED",
  "COLLATERAL_WITHDRAWN",
  "BORROWED",
  "REPAID",
  "LIQUIDATED",
  "INTEREST_ACCRUED",
  "FEE_SET",
] as const

export type MorphoAction = (typeof MORPHO_ACTIONS)[number]

type LogKey = {
  network: Network
  txHash: Hex
  logIndex: number
  blockNumber: bigint
  timestamp: bigint
  txFrom: Address
}

export type MorphoEventRow = LogKey & {
  marketId: Hex
  action: MorphoAction
  caller: Address | null
  onBehalf: Address | null
  receiver: Address | null
  assets: bigint | null
  shares: bigint | null
  seizedAssets: bigint | null
  badDebtAssets: bigint | null
  badDebtShares: bigint | null
  prevBorrowRate: bigint | null
  feeShares: bigint | null
  fee: bigint | null
}

/** A Morpho Blue market and its totals, as Morpho.market(id) holds them. */
export type MorphoMarketRow = {
  network: Network
  marketId: Hex
  loanToken: Address
  collateralToken: Address
  oracle: Address
  irm: Address
  lltv: bigint
  loanDecimals: number | null
  collateralDecimals: number | null
  fee: bigint
  totalSupplyAssets: bigint
  totalSupplyShares: bigint
  totalBorrowAssets: bigint
  totalBorrowShares: bigint
  totalCollateral: bigint
  lastUpdate: bigint
  createdBlock: bigint
  createdTx: Hex
  createdTimestamp: bigint
  updatedBlock: bigint
}

export const ENCLAVE_ACTIONS = [
  "POSITION_OPENED",
  "DEBT_INCREASED",
  "DEBT_REPAID",
  "POSITION_CLOSED",
  "COLLATERAL_PLEDGED",
  "COLLATERAL_RELEASED",
  "INTEREST_RATE_SET",
  "ORIGINATOR_FEE_RATE_SET",
  "CR_THRESHOLDS_SET",
  "VEBTC_LOCKED",
  "VEBTC_INCREASED",
  "VEBTC_MERGED",
  "VEBTC_WITHDRAWN",
] as const

export type EnclaveAction = (typeof ENCLAVE_ACTIONS)[number]

export type EnclaveEventRow = LogKey & {
  veBtcTokenId: bigint
  contractAddress: Address
  enclave: Address
  positionId: Hex | null
  borrower: Address | null
  action: EnclaveAction
  amount: bigint | null
  principal: bigint | null
  interestRate: number | null
  originatorFeeRate: number | null
  warningCr: bigint | null
  minimumCr: bigint | null
  lockDuration: bigint | null
  otherVeBtcTokenId: bigint | null
  pledgedVeBtc: bigint[]
}

/** An Enclave position, rebuilt from its latest enclave_events row. */
export type EnclavePosition = {
  positionId: Hex
  enclave: Address
  borrower: Address
  principal: bigint
  pledged: bigint[]
  open: boolean
}
