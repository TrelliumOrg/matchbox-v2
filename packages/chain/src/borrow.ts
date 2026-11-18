import { type Abi, type Address, getAddress, type Hex } from "viem"
import {
  ENCLAVE_DEBT_MANAGER_EVENTS_ABI,
  ENCLAVE_EVENTS_ABI,
  PROXY_UPGRADED_EVENTS_ABI,
} from "./abis/enclave"
import { MORPHO_BLUE_EVENTS_ABI } from "./abis/morpho"

// Borrowing on Mezo beyond mUSD troves: Morpho Blue markets and Enclave debt
// (docs/research/mezo-borrow-markets.md). Read on mainnet on 8 and 9 Nov
// 2026; testnet addresses are not recorded.

export const BORROW_CONTRACTS = {
  mainnet: {
    morphoBlue: getAddress("0x565834cE7E40b8987BC20EbF83E2159467bDA311"),
    morphoOwner: getAddress("0x98D8899c3030741925BE630C710A98B57F397C7a"),
    adaptiveCurveIrm: getAddress("0x3760Ebc636F912a4dB9540fdA4Dec09C25C6C1e7"),
    morphoBtcMusdcVault: getAddress(
      "0x06291b67e3d7660240ab44Afc9a708d82b976a8B",
    ),
    enclaveDebtManager: getAddress(
      "0x2c5E9AFBb670c4a61aC2dCAd62C258EE2391389A",
    ),
    enclaveA: getAddress("0x4da9e77114EE66d64Ca9457DA1FcA94d4B06fB99"),
    enclaveB: getAddress("0x147379A0174780570D07d70a14FB244EE5f2D786"),
    btc: getAddress("0x7b7C000000000000000000000000000000000000"),
    mUSDC: getAddress("0x04671C72Aab5AC02A03c1098314b1BB6B560c197"),
    musd: getAddress("0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"),
  },
} as const

/** Morpho Blue market ids on mainnet (keccak256 of the market params). */
export const MORPHO_MARKETS = {
  mainnet: {
    btcMusdc:
      "0x6f88e79e8acb3a3ac2f990dcfb83b42ddae96ef406cd735f1721b2a2e1b733db",
    btcMusd:
      "0x29c2a844b71bb5db40ca26e8880552dcd40517aa10e945b15ef616c46d5d6707",
  },
} as const satisfies Record<string, Record<string, Hex>>

/**
 * Decimals of the tokens Morpho markets on Mezo lend or take as collateral,
 * keyed by lowercase address. A market naming any other token stores null
 * decimals until it is added here.
 */
export const BORROW_TOKEN_DECIMALS: Readonly<Record<Address, number>> = {
  "0x7b7c000000000000000000000000000000000000": 18, // BTC
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197": 6, // mUSDC
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186": 18, // MUSD
}

// The indexer's borrow stream. Kept apart from CONTRACT_KINDS so the
// existing warehouse registry (matchbox.contracts and its CHECK constraint)
// is untouched; borrow contracts live in matchbox.borrow_contracts.

export const BORROW_CONTRACT_KINDS = [
  "morphoBlue",
  "enclaveDebtManager",
  "enclave",
] as const

export type BorrowContractKind = (typeof BORROW_CONTRACT_KINDS)[number]

const UPGRADED = "Upgraded(address)"

/** Events the borrow stream ingests, per kind. */
export const BORROW_INDEXED_EVENTS: Record<BorrowContractKind, string[]> = {
  morphoBlue: [
    "CreateMarket(bytes32,(address,address,address,address,uint256))",
    "Supply(bytes32,address,address,uint256,uint256)",
    "Withdraw(bytes32,address,address,address,uint256,uint256)",
    "SupplyCollateral(bytes32,address,address,uint256)",
    "WithdrawCollateral(bytes32,address,address,address,uint256)",
    "Borrow(bytes32,address,address,address,uint256,uint256)",
    "Repay(bytes32,address,address,uint256,uint256)",
    "Liquidate(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)",
    "AccrueInterest(bytes32,uint256,uint256,uint256)",
    "SetFee(bytes32,uint256)",
  ],
  enclaveDebtManager: [
    "PositionOpened(bytes32,address,address,uint256,address,uint16,uint16,uint256,uint256,uint256[])",
    "DebtIncreased(bytes32,uint256,uint256)",
    "DebtRepaid(bytes32,uint256,uint256)",
    "PositionClosed(bytes32)",
    "PledgedVeBtcAdded(bytes32,uint256[],uint256[])",
    "PledgedVeBtcRemoved(bytes32,uint256[],uint256[])",
    "PositionCRThresholdsSet(bytes32,uint256,uint256)",
    "PositionInterestRateSet(bytes32,uint16,uint16)",
    "PositionOriginatorFeeRateSet(bytes32,uint16,uint16)",
    // Discovery: governance granting ENCLAVE_ROLE registers a new Enclave.
    "RoleGranted(bytes32,address,address)",
    UPGRADED,
  ],
  enclave: [
    "VeBTCLocked(uint256,uint256,uint256)",
    "VeBTCIncreased(uint256,uint256)",
    "VeBTCMerged(uint256,uint256)",
    "VeBTCWithdrawn(uint256)",
    UPGRADED,
  ],
}

/** The events ABI the borrow stream decodes each kind with. */
export const BORROW_EVENTS_ABI_BY_KIND: Record<BorrowContractKind, Abi> = {
  morphoBlue: MORPHO_BLUE_EVENTS_ABI,
  enclaveDebtManager: [
    ...ENCLAVE_DEBT_MANAGER_EVENTS_ABI,
    ...PROXY_UPGRADED_EVENTS_ABI,
  ],
  enclave: [...ENCLAVE_EVENTS_ABI, ...PROXY_UPGRADED_EVENTS_ABI],
}

/**
 * A borrow contract the indexer knows before discovery. `fromBlock` is its
 * creation block (Blockscout creation transaction), the first block with
 * logs. Addresses are lowercase.
 */
export type BorrowStaticContract = {
  template: string
  kind: BorrowContractKind
  address: Address
  fromBlock: bigint
}

export const MORPHO_BLUE_DEPLOY_BLOCK = 9_206_917n
export const ENCLAVE_DEBT_MANAGER_DEPLOY_BLOCK = 8_533_131n
export const ENCLAVE_A_DEPLOY_BLOCK = 8_199_414n
export const ENCLAVE_B_DEPLOY_BLOCK = 9_863_657n

/** Mezo mainnet. Enclaves granted ENCLAVE_ROLE later are discovered. */
export const BORROW_STATIC_CONTRACTS: BorrowStaticContract[] = [
  {
    template: "MorphoBlue",
    kind: "morphoBlue",
    address: "0x565834ce7e40b8987bc20ebf83e2159467bda311",
    fromBlock: MORPHO_BLUE_DEPLOY_BLOCK,
  },
  {
    template: "EnclaveDebtManager",
    kind: "enclaveDebtManager",
    address: "0x2c5e9afbb670c4a61ac2dcad62c258ee2391389a",
    fromBlock: ENCLAVE_DEBT_MANAGER_DEPLOY_BLOCK,
  },
  {
    template: "EnclaveA",
    kind: "enclave",
    address: "0x4da9e77114ee66d64ca9457da1fca94d4b06fb99",
    fromBlock: ENCLAVE_A_DEPLOY_BLOCK,
  },
  {
    template: "EnclaveB",
    kind: "enclave",
    address: "0x147379a0174780570d07d70a14fb244ee5f2d786",
    fromBlock: ENCLAVE_B_DEPLOY_BLOCK,
  },
]
