import {
  type Abi,
  type AbiEvent,
  keccak256,
  toEventSelector,
  toEventSignature,
  toHex,
} from "viem"
import { describe, expect, it } from "vitest"
import { ENCLAVE_ROLE } from "./abis/enclave"
import {
  BORROW_CONTRACT_KINDS,
  BORROW_EVENTS_ABI_BY_KIND,
  BORROW_INDEXED_EVENTS,
  BORROW_STATIC_CONTRACTS,
  BORROW_TOKEN_DECIMALS,
  type BorrowContractKind,
} from "./borrow"

function events(abi: Abi): AbiEvent[] {
  return abi.filter((item): item is AbiEvent => item.type === "event")
}

function fingerprint(event: AbiEvent): string {
  const mask = event.inputs.map((input) => (input.indexed ? "1" : "0"))
  return `${toEventSignature(event)} ${mask.join("")}`
}

// topic0 of every log each contract emitted on mainnet, blocks 8,199,414 to
// 13,098,469 (eth_getLogs over the four static addresses, 9 Nov 2026), with
// the signature and indexed mask from the verified sources.
const SEEN_ON_MAINNET: Record<BorrowContractKind, Record<string, string>> = {
  morphoBlue: {
    "0x167d3e9c1016ab80e58802ca9da10ce5c6a0f4debc46a2e7a2cd9e56899a4fb5":
      "SetOwner(address) 1",
    "0x590e04cdebeccba40f566186b9746ad295a4cd358ea4fefaaea6ce79630d96c0":
      "EnableIrm(address) 1",
    "0x297b80e7a896fad470c630f6575072d609bde997260ff3db851939405ec29139":
      "EnableLltv(uint256) 0",
    "0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac":
      "CreateMarket(bytes32,(address,address,address,address,uint256)) 10",
    "0x9d9bd501d0657d7dfe415f779a620a62b78bc508ddc0891fbbd8b7ac0f8fce87":
      "AccrueInterest(bytes32,uint256,uint256,uint256) 1000",
    "0xedf8870433c83823eb071d3df1caa8d008f12f6440918c20d75a3602cda30fe0":
      "Supply(bytes32,address,address,uint256,uint256) 11100",
    "0xa3b9472a1399e17e123f3c2e6586c23e504184d504de59cdaa2b375e880c6184":
      "SupplyCollateral(bytes32,address,address,uint256) 1110",
    "0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43":
      "Borrow(bytes32,address,address,address,uint256,uint256) 101100",
    "0x52acb05cebbd3cd39715469f22afbf5a17496295ef3bc9bb5944056c63ccaa09":
      "Repay(bytes32,address,address,uint256,uint256) 11100",
    "0xe80ebd7cc9223d7382aab2e0d1d6155c65651f83d53c8b9b06901d167e321142":
      "WithdrawCollateral(bytes32,address,address,address,uint256) 10110",
    "0xa56fc0ad5702ec05ce63666221f796fb62437c32db1aa1aa075fc6484cf58fbf":
      "Withdraw(bytes32,address,address,address,uint256,uint256) 101100",
    "0xd5e969f01efe921d3f766bdebad25f0a05e3f237311f56482bf132d0326309c0":
      "SetAuthorization(address,address,address,bool) 1110",
    "0xc76f1b4fe4396ac07a9fa55a415d4ca430e72651d37d3401f3bed7cb13fc4f12":
      "FlashLoan(address,address,uint256) 110",
  },
  enclaveDebtManager: {
    "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b":
      "Upgraded(address) 1",
    "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d":
      "RoleGranted(bytes32,address,address) 111",
    "0xbd79b86ffe0ab8e8776151514217cd7cacd52c909f66475c3af44e129f0b00ff":
      "RoleAdminChanged(bytes32,bytes32,bytes32) 111",
    "0x428d0ce3ec19d535d61922be4f747f68df18c0a0411da1190470f0441d24024c":
      "MaxRateSet(uint16) 0",
    "0xcda03296b648d791f2cee5a5af4b32860d8a3d01fae4126b12b4081224003767":
      "MintCapSet(uint256) 0",
    "0x7f26b83ff96e1f2b6a682f133852f6798a09c465da95921460cefb3847402498":
      "Initialized(uint8) 0",
    "0x71b8cfcb91be8c2c8670be096e68d6366139b0e2d777e4f77ade632a4d721196":
      "PositionOpened(bytes32,address,address,uint256,address,uint16,uint16,uint256,uint256,uint256[]) 1110000000",
    "0x3d8708181c6452c5711a2b4c6ed3f12149f6ea35f78549aba00a89d041e766ca":
      "InterestAccrued(uint256,uint256) 00",
    "0x2118334e388b7134a6f90e5aaf39ebfd7b72debb8d1c454fbe09d4156482c475":
      "DebtIncreased(bytes32,uint256,uint256) 100",
    "0x868c03be9ffd10b7bd6294b60684c640d935b4f31deaf6662984e7de7da07087":
      "DebtRepaid(bytes32,uint256,uint256) 100",
    "0xb77a99aa6bf8135a033a72ab89373f6f8977dc081d277755b7622c1782a14799":
      "PositionClosed(bytes32) 1",
    "0x4847e7e5826ec6214e03626d14dec2d43abd228be3af7578f3a18a65039b1992":
      "PledgedVeBtcAdded(bytes32,uint256[],uint256[]) 100",
    "0x02403dfe11b4461cb23bc722e800e5bad3ef47f2b1bd6bad6a40289132fd185d":
      "PledgedVeBtcRemoved(bytes32,uint256[],uint256[]) 100",
  },
  enclave: {
    "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b":
      "Upgraded(address) 1",
    "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d":
      "RoleGranted(bytes32,address,address) 111",
    "0x2ef3b31367aadc981ad7b0bed66d93204eb87895be6713c6a0c8eeccaad37168":
      "TargetAdded(address,bytes4) 10",
    "0x55401f576dcb9c3b22fea6cff64e445ef355d4926a6ebb44375c2d791224141c":
      "TargetRemoved(address,bytes4) 10",
    "0x8b917d12c706d2a1e7feb0dba8684995968ec5c5c2e9bcb5dbefd7bc2b4be160":
      "TripartyBridgeRequested(uint256,uint256,(bytes32,uint32,uint64)) 100",
    "0xc191dbc92ff828ba0f902138e7e3d86dc2b2fe594b6f7461d177c4fdc23f411c":
      "VeBTCLocked(uint256,uint256,uint256) 100",
    "0xf08a12783bb24e7fca3a2ae189ac5e38ab4d14aae267bd8875549a1e3bf710b1":
      "VeBTCIncreased(uint256,uint256) 10",
    "0x70ee39b800124b25688df7f2766718c2116e7c75b078bb937f72fdc9cc87334e":
      "CallExecuted(address,bytes4,bytes,bytes) 1000",
    "0x487f64e34ad7437cb951e3ebfd9a4cae6c3fe11d8983fb574c0705ad57affe46":
      "VeBTCWithdrawn(uint256) 1",
  },
}

// Events the borrow ABIs carry that no mainnet log has used yet (verified
// sources only).
const NOT_YET_SEEN = new Set([
  "SetFee(bytes32,uint256) 10",
  "Liquidate(bytes32,address,address,uint256,uint256,uint256,uint256,uint256) 11100000",
  "PositionCRThresholdsSet(bytes32,uint256,uint256) 100",
  "PositionInterestRateSet(bytes32,uint16,uint16) 100",
  "PositionOriginatorFeeRateSet(bytes32,uint16,uint16) 100",
  "VeBTCMerged(uint256,uint256) 11",
])

describe("borrow ABIs", () => {
  it.each(BORROW_CONTRACT_KINDS)(
    "match every topic %s emitted on mainnet",
    (kind) => {
      const byTopic = new Map(
        [
          ...events(BORROW_EVENTS_ABI_BY_KIND[kind]),
          // RoleGranted on an Enclave decodes with the manager's ABI.
          ...events(BORROW_EVENTS_ABI_BY_KIND.enclaveDebtManager),
        ].map((event) => [toEventSelector(event), fingerprint(event)]),
      )
      for (const [topic, expected] of Object.entries(SEEN_ON_MAINNET[kind])) {
        expect(byTopic.get(topic as `0x${string}`), topic).toBe(expected)
      }
    },
  )

  it.each(BORROW_CONTRACT_KINDS)("declares every event %s ingests", (kind) => {
    const declared = new Map(
      events(BORROW_EVENTS_ABI_BY_KIND[kind]).map((event) => [
        toEventSignature(event),
        fingerprint(event),
      ]),
    )
    const seen = new Set(Object.values(SEEN_ON_MAINNET[kind]))
    for (const signature of BORROW_INDEXED_EVENTS[kind]) {
      const print = declared.get(signature)
      expect(print, signature).toBeDefined()
      expect(
        seen.has(print ?? "") || NOT_YET_SEEN.has(print ?? ""),
        `${signature} is neither seen on mainnet nor listed as unseen`,
      ).toBe(true)
    }
  })

  it.each(BORROW_CONTRACT_KINDS)("has one fragment per topic in %s", (kind) => {
    const topics = events(BORROW_EVENTS_ABI_BY_KIND[kind]).map((event) =>
      toEventSelector(event),
    )
    expect(new Set(topics).size).toBe(topics.length)
  })

  it("names the Enclave role", () => {
    expect(ENCLAVE_ROLE).toBe(keccak256(toHex("ENCLAVE_ROLE")))
  })
})

describe("borrow contracts", () => {
  it("are lowercase and unique", () => {
    const addresses = BORROW_STATIC_CONTRACTS.map(
      (contract) => contract.address,
    )
    for (const address of addresses) expect(address).toBe(address.toLowerCase())
    expect(new Set(addresses).size).toBe(addresses.length)
    for (const address of Object.keys(BORROW_TOKEN_DECIMALS)) {
      expect(address).toBe(address.toLowerCase())
    }
  })
})
