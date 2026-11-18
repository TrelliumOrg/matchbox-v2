import { getAddress, isAddress } from "viem"
import { describe, expect, it } from "vitest"
import {
  CONTRACTS,
  getContracts,
  MUSD_CONTRACTS,
  OWNER_LOOKUP_ESCROWS,
  VOTER_ADDRESSES,
} from "./addresses"
import { CHAIN_ID } from "./chains"
import {
  EXPLORER_STATIC_CONTRACTS,
  MEZO_STATIC_CONTRACTS,
  WAREHOUSE_STATIC_CONTRACTS,
} from "./indexer"

describe("contracts", () => {
  it("picks the network by chain id", () => {
    expect(getContracts(CHAIN_ID.testnet)).toBe(CONTRACTS.testnet)
    expect(getContracts(CHAIN_ID.mainnet)).toBe(CONTRACTS.mainnet)
  })

  it("keeps the escrow lookup order the subgraph uses", () => {
    expect(OWNER_LOOKUP_ESCROWS).toEqual([
      CONTRACTS.mainnet.veMEZO.toLowerCase(),
      CONTRACTS.testnet.veMEZO.toLowerCase(),
      CONTRACTS.mainnet.veBTC.toLowerCase(),
      CONTRACTS.testnet.veBTC.toLowerCase(),
    ])
  })

  it("lists the four mainnet voters", () => {
    const mainnet = CONTRACTS.mainnet
    expect(VOTER_ADDRESSES).toEqual(
      [
        mainnet.boostVoter,
        mainnet.poolsVoter,
        mainnet.thirdPartyVoter,
        mainnet.validatorsVoter,
      ].map((address) => address.toLowerCase()),
    )
  })
})

describe("static contracts", () => {
  it("stores valid lowercase addresses once each", () => {
    const addresses = MEZO_STATIC_CONTRACTS.map((contract) => contract.address)
    for (const address of addresses) {
      expect(isAddress(address)).toBe(true)
      expect(address).toBe(address.toLowerCase())
    }
    expect(new Set(addresses).size).toBe(addresses.length)
  })

  it("links all 18 Legacy reward contracts to a pool and gauge", () => {
    const legacy = EXPLORER_STATIC_CONTRACTS.filter((contract) =>
      contract.template.startsWith("Legacy"),
    )
    expect(legacy).toHaveLength(18)
    for (const contract of legacy) {
      expect(contract.pool).not.toBeNull()
      expect(contract.gauge).not.toBeNull()
      expect(typeof contract.fromBlock).toBe("bigint")
    }
  })

  it("matches the app addresses on mainnet", () => {
    const byTemplate = new Map(
      EXPLORER_STATIC_CONTRACTS.map((contract) => [
        contract.template,
        contract,
      ]),
    )
    const mainnet = CONTRACTS.mainnet
    const expected: [string, string][] = [
      ["VeMEZO", mainnet.veMEZO],
      ["VeBTC", mainnet.veBTC],
      ["BoostVoter", mainnet.boostVoter],
      ["PoolsVoter", mainnet.poolsVoter],
      ["ThirdPartyVoter", mainnet.thirdPartyVoter],
      ["ValidatorsVoter", mainnet.validatorsVoter],
      ["MUSDSavingsRate", MUSD_CONTRACTS.mainnet.savingsRate],
      ["PCV", MUSD_CONTRACTS.mainnet.pcv],
    ]
    for (const [template, address] of expected) {
      expect(byTemplate.get(template)?.address).toBe(address.toLowerCase())
    }
  })

  it("starts the mUSD contracts at their deploy blocks", () => {
    expect(
      WAREHOUSE_STATIC_CONTRACTS.map((contract) => [
        getAddress(contract.address),
        contract.fromBlock,
      ]),
    ).toEqual([
      [MUSD_CONTRACTS.mainnet.borrowerOperations, 178_630n],
      [MUSD_CONTRACTS.mainnet.troveManager, 178_660n],
    ])
  })

  it("links each core pool to itself", () => {
    for (const contract of EXPLORER_STATIC_CONTRACTS) {
      if (contract.kind === "pool") {
        expect(contract.pool).toBe(contract.address)
      }
    }
  })
})
