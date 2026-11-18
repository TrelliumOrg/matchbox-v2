import { describe, expect, it } from "vitest"
import { MUSD_CONTRACTS } from "./addresses"
import { BORROW_CONTRACTS } from "./borrow"
import {
  ENCLAVE_DEBT_TOPICS,
  MUSD_FEE_SOURCES,
  SCAN_STREAM_TOKENS,
} from "./scan-stream"

describe("scan stream registry", () => {
  it("names the mUSD token and PCV from MUSD_CONTRACTS", () => {
    expect(MUSD_FEE_SOURCES.musd).toBe(
      MUSD_CONTRACTS.mainnet.musd.toLowerCase(),
    )
    expect(MUSD_FEE_SOURCES.pcv).toBe(MUSD_CONTRACTS.mainnet.pcv.toLowerCase())
    expect(MUSD_FEE_SOURCES.enclaveDebtManager).toBe(
      BORROW_CONTRACTS.mainnet.enclaveDebtManager.toLowerCase(),
    )
  })

  it("marks Enclave debt transactions by six EnclaveDebtManager events", () => {
    expect(ENCLAVE_DEBT_TOPICS).toHaveLength(6)
    // InterestAccrued, seen beside an Enclave repayment's mint at 9,092,142.
    expect(
      ENCLAVE_DEBT_TOPICS.some((topic) => topic.startsWith("0x3d870818")),
    ).toBe(true)
  })

  it("lists six lowercase tokens once each", () => {
    const addresses = SCAN_STREAM_TOKENS.map((token) => token.address)
    expect(new Set(addresses).size).toBe(6)
    for (const address of addresses) expect(address).toBe(address.toLowerCase())
  })
})
