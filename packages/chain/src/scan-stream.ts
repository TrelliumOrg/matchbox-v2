import { type Address, type Hex, pad, parseAbi, toEventSelector } from "viem"
import { ENCLAVE_DEBT_MANAGER_EVENTS_ABI } from "./abis/enclave"
import {
  BORROWER_OPERATIONS_EVENTS_ABI,
  TROVE_MANAGER_EVENTS_ABI,
} from "./abis/musd"
import {
  MUSD_BORROWER_OPERATIONS_DEPLOY_BLOCK,
  WAREHOUSE_STATIC_CONTRACTS,
} from "./indexer"

// What the indexer's scan stream reads for Matchscan
// (apps/indexer/src/scan-stream): ERC-20 Transfer on six tokens, rolled up
// per UTC day, and the mUSD fees. Read on mainnet on 10 Nov 2026 at block
// 13,124,532 (symbol(), decimals(), eth_getCode bisection for the first
// block with code, and totalSupply() bisection for the first block with
// supply).

/**
 * Whether a token's supply can be replayed from its Transfer events.
 * "no": supply appears without any event (Mezo's bridge mints the bridged
 * tokens silently: their first supply sits in a block with no log at all;
 * MEZO is a precompile with a genesis supply). "candidate": the first
 * supply was exactly a Transfer from the zero address; a full replay
 * against totalSupply() must still pass before replayed supply is
 * published.
 */
export type SupplyFromTransfers = "no" | "candidate"

export type ScanStreamToken = {
  symbol: string
  address: Address
  decimals: number
  /** First block with code. */
  deployBlock: bigint
  /** First block with a non-zero totalSupply(), and how it got there. */
  firstSupplyBlock: bigint
  supplyFromTransfers: SupplyFromTransfers
}

export const SCAN_STREAM_TOKENS: readonly ScanStreamToken[] = [
  {
    symbol: "MEZO",
    address: "0x7b7c000000000000000000000000000000000001",
    decimals: 18,
    deployBlock: 0n,
    firstSupplyBlock: 0n,
    supplyFromTransfers: "no",
  },
  {
    symbol: "mUSDC",
    address: "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
    decimals: 6,
    deployBlock: 75_221n,
    firstSupplyBlock: 402_234n,
    supplyFromTransfers: "no",
  },
  {
    symbol: "mUSDT",
    address: "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e",
    decimals: 6,
    deployBlock: 75_247n,
    firstSupplyBlock: 557_833n,
    supplyFromTransfers: "no",
  },
  {
    symbol: "mSolvBTC",
    address: "0xa10ad2570ea7b93d19fdae6bd7189ff4929bc747",
    decimals: 18,
    deployBlock: 75_135n,
    firstSupplyBlock: 434_893n,
    supplyFromTransfers: "no",
  },
  {
    symbol: "mcbBTC",
    address: "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7",
    decimals: 8,
    deployBlock: 75_328n,
    firstSupplyBlock: 402_438n,
    supplyFromTransfers: "no",
  },
  {
    symbol: "mbhBTC",
    address: "0xe2232789d4cf5bb1ffada1a105cc59b18d639318",
    decimals: 18,
    deployBlock: 6_725_112n,
    firstSupplyBlock: 7_638_288n,
    supplyFromTransfers: "candidate",
  },
]

/** ERC-20 Transfer, the only token event the scan stream reads. */
export const ERC20_TRANSFER_EVENTS_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
])

export const ERC20_TRANSFER_TOPIC: Hex = toEventSelector(
  "Transfer(address,address,uint256)",
)

function warehouseAddress(template: string): Address {
  const contract = WAREHOUSE_STATIC_CONTRACTS.find(
    (candidate) => candidate.template === template,
  )
  if (contract === undefined) throw new Error(`No ${template} contract`)
  return contract.address
}

/**
 * mUSD fees. BorrowingFeePaid and RefinancingFeePaid (BorrowerOperations,
 * MUSD minted to PCV), Redemption's collateral fee (TroveManager, BTC), and
 * the MUSD minted to PCV (Transfer(0x0, PCV)) attributed by its source, as
 * MUSD has three minters (docs/research/mezo-borrow-markets.md):
 * - trove interest: in a transaction where the ActivePool's debt changed
 *   (ActivePoolDebtUpdated), the mints beyond its borrowing and refinancing
 *   fees (InterestRateManager mints the interest);
 * - Enclave interest and fees: in a transaction where EnclaveDebtManager
 *   accrued interest or an originator fee or moved debt, the mints
 *   (EnclaveDebtManager mints them);
 * - anything else is not a fee: the 100,000,000 MUSD PCV bootstrap loan at
 *   block 179,091 is the one seen on mainnet.
 * Read on mainnet 11 Nov 2026 (TroveManager.activePool()).
 */
export const MUSD_FEE_SOURCES = {
  borrowerOperations: warehouseAddress("MusdBorrowerOperations"),
  troveManager: warehouseAddress("MusdTroveManager"),
  // MUSD_CONTRACTS.mainnet.musd and .pcv, lowercase (scan-stream.test.ts).
  musd: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
  pcv: "0x391ecc7ffefc48cff41d0f2bb36e38b82180b993",
  activePool: "0x3012c2fe1240e3754e5c200a0946bb0e07474876",
  // BORROW_CONTRACTS.mainnet.enclaveDebtManager, lowercase.
  enclaveDebtManager: "0x2c5e9afbb670c4a61ac2dcad62c258ee2391389a",
  deployBlock: MUSD_BORROWER_OPERATIONS_DEPLOY_BLOCK,
} as const satisfies Record<string, Address | bigint>

export const MUSD_FEE_EVENTS_ABI = [
  ...BORROWER_OPERATIONS_EVENTS_ABI.filter(
    (item) =>
      item.name === "BorrowingFeePaid" || item.name === "RefinancingFeePaid",
  ),
  ...TROVE_MANAGER_EVENTS_ABI.filter((item) => item.name === "Redemption"),
] as const

export const MUSD_FEE_TOPICS: readonly Hex[] = [
  toEventSelector("BorrowingFeePaid(address,uint256)"),
  toEventSelector("RefinancingFeePaid(address,uint256)"),
  toEventSelector("Redemption(uint256,uint256,uint256,uint256)"),
]

/** ActivePool's debt changed: the transaction touched trove debt. */
export const ACTIVE_POOL_DEBT_UPDATED_TOPIC: Hex = toEventSelector(
  "ActivePoolDebtUpdated(uint256,uint256)",
)

/**
 * EnclaveDebtManager events that accompany its MUSD mints to PCV: the debt
 * events, and InterestAccrued and OriginatorFeeAccrued (which the borrow
 * stream does not index).
 */
export const ENCLAVE_DEBT_TOPICS: readonly Hex[] =
  ENCLAVE_DEBT_MANAGER_EVENTS_ABI.filter((item) =>
    [
      "PositionOpened",
      "DebtIncreased",
      "DebtRepaid",
      "PositionClosed",
      "InterestAccrued",
      "OriginatorFeeAccrued",
    ].includes(item.name),
  ).map((item) => toEventSelector(item))

/** Topics 1 and 2 of a MUSD mint to PCV: Transfer(0x0, PCV). */
export const MUSD_PCV_MINT_TOPICS: readonly [Hex, Hex] = [
  pad("0x0000000000000000000000000000000000000000"),
  pad(MUSD_FEE_SOURCES.pcv),
]

/** First block the scan stream reads: MEZO has Transfers from genesis. */
export const SCAN_STREAM_HISTORY_START = 0n
