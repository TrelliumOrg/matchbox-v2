import { getAddress } from "viem"
import { CHAIN_ID, type SupportedChainId } from "./chains"

export const CONTRACTS = {
  testnet: {
    mezoToken: getAddress("0x7B7c000000000000000000000000000000000001"),
    veMEZO: getAddress("0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b"),
    veBTC: getAddress("0x38E35d92E6Bfc6787272A62345856B13eA12130a"),
    boostVoter: getAddress("0x21d7bDF5a5929AD179F8cA0c9014A0B62ae6Bfd1"),
    poolsVoter: getAddress("0x263F1Fd5fB7F866881e1B6cD7d5d6c40Fd985F0D"),
    validatorsVoter: getAddress("0xac1bA4627d2Ec488bEdd562bB857275C45003844"),
    thirdPartyVoter: getAddress("0x62FE6d71BE2Ac2806Da046bf93b02C279246251D"),
    validatorPool: getAddress("0x7B7C000000000000000000000000000000000011"),
    factoryRegistry: getAddress("0x93915fF0ddEd1bfD587ef996Ee91504ab97E95Cf"),
    gaugeFactory: getAddress("0x2c015840d034fe74bea8c62dd00a11e3aa338ad5"),
  },
  mainnet: {
    mezoToken: getAddress("0x7B7c000000000000000000000000000000000001"),
    veMEZO: getAddress("0xb90fdAd3DFD180458D62Cc6acedc983D78E20122"),
    veBTC: getAddress("0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279"),
    boostVoter: getAddress("0x2Ba614a598Cffa5a19d683cDCA97bac3a49313d1"),
    poolsVoter: getAddress("0x48233cCC97B87Ba93bCA212cbEe48e3210211f03"),
    validatorsVoter: getAddress("0xe99a9ad5Ed26BD30e4DB25397f378817e9b9515a"),
    thirdPartyVoter: getAddress("0x2e6D2F2CaCC1d24F9f9358030674eB307397A6EB"),
    validatorPool: getAddress("0x7B7C000000000000000000000000000000000011"),
    factoryRegistry: getAddress("0x04B94f55780682478c8D8329368AAAfD320F4D32"),
    gaugeFactory: getAddress("0x4150DcE1c6d013fa7EBaf4fFCd879D08daA0CCAd"), // CL: "0xfc41E1AAe0e58E8bDC32e85d8C995A902FEdEb13"
  },
} as const

export function getContracts(chainId: SupportedChainId) {
  return chainId === CHAIN_ID.testnet ? CONTRACTS.testnet : CONTRACTS.mainnet
}

/**
 * mUSD on Mezo mainnet. BorrowerOperations, TroveManager, PriceFeed,
 * CollSurplusPool and the token come from feat/pro-rebuild's Stuart
 * providers; SortedTroves and StabilityPool were read from
 * TroveManager.sortedTroves() and stabilityPool() on 8 Nov 2026, which also
 * confirmed the others. Testnet addresses are not recorded yet.
 */
export const MUSD_CONTRACTS = {
  mainnet: {
    musd: getAddress("0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"),
    borrowerOperations: getAddress(
      "0x44b1bac67dDA612a41a58AAf779143B181dEe031",
    ),
    troveManager: getAddress("0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193"),
    sortedTroves: getAddress("0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f"),
    stabilityPool: getAddress("0x73245Eff485aB3AAc1158B3c4d8f4b23797B0e32"),
    priceFeed: getAddress("0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88"),
    collSurplusPool: getAddress("0xBF51807ACb3394B8550f0554FB9098856Ef5F491"),
    pcv: getAddress("0x391EcC7ffEFc48cff41D0F2Bb36e38b82180B993"),
    savingsRate: getAddress("0xb4D498029af77680cD1eF828b967f010d06C51CC"),
  },
} as const

/**
 * The distributors that pay lock rewards on mainnet: MEZO rebases into
 * veMEZO locks and chain fees (BTC) into veBTC locks. For a live lock each
 * claim is a deposit into the lock, so the tokens never reach the owner.
 */
export const REWARDS_DISTRIBUTORS = {
  mainnet: {
    veMEZO: getAddress("0x075108f275ed81c9cfc01065e6e50ceea81d6363"),
    veBTC: getAddress("0xb58477e074265bdc7f7ca6100ed0f7de264f74a2"),
  },
} as const

// Order matters: the indexer's resolveLockOwner returns the first escrow
// holding the tokenId, exactly as the explorer subgraph does.
export const OWNER_LOOKUP_ESCROWS = [
  "0xb90fdad3dfd180458d62cc6acedc983d78e20122", // veMEZO mainnet
  "0xace816ca2bcc9b12c59799dcc5a959fb9b98111b", // veMEZO testnet
  "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279", // veBTC mainnet
  "0x38e35d92e6bfc6787272a62345856b13ea12130a", // veBTC testnet
] as const

// The four mainnet voters. A reward claim sent straight to one of them names
// the claimed lock in its calldata.
export const VOTER_ADDRESSES = [
  "0x2ba614a598cffa5a19d683cdca97bac3a49313d1", // BoostVoter
  "0x48233ccc97b87ba93bca212cbee48e3210211f03", // PoolsVoter
  "0x2e6d2f2cacc1d24f9f9358030674eb307397a6eb", // ThirdPartyVoter
  "0xe99a9ad5ed26bd30e4db25397f378817e9b9515a", // ValidatorsVoter
] as const

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
