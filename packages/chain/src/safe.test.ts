import { getAbiItem, toFunctionSelector } from "viem"
import { describe, expect, it } from "vitest"
import {
  MULTI_SEND_CALL_ONLY_ABI,
  SAFE_ABI,
  SAFE_CONTRACTS,
  SIMULATE_TX_ACCESSOR_ABI,
} from "./index"

describe("Safe on Mezo", () => {
  it("names the canonical 1.4.1 deployments", () => {
    expect(SAFE_CONTRACTS.mainnet.multiSendCallOnly).toBe(
      "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
    )
    expect(SAFE_CONTRACTS.mainnet.simulateTxAccessor).toBe(
      "0x3d4BA2E0884aa488718476ca2FB8Efc291A46199",
    )
  })

  it("matches Safe's selectors", () => {
    expect(
      toFunctionSelector(
        getAbiItem({ abi: MULTI_SEND_CALL_ONLY_ABI, name: "multiSend" }),
      ),
    ).toBe("0x8d80ff0a")
    expect(
      toFunctionSelector(
        getAbiItem({ abi: SAFE_ABI, name: "simulateAndRevert" }),
      ),
    ).toBe("0xb4faba09")
    expect(
      toFunctionSelector(
        getAbiItem({ abi: SAFE_ABI, name: "execTransaction" }),
      ),
    ).toBe("0x6a761202")
    expect(
      toFunctionSelector(
        getAbiItem({ abi: SIMULATE_TX_ACCESSOR_ABI, name: "simulate" }),
      ),
    ).toBe("0x1c5fb211")
  })
})
