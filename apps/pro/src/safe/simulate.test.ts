import {
  SAFE_ABI,
  SAFE_CONTRACTS,
  SIMULATE_TX_ACCESSOR_ABI,
  VOTING_ESCROW_WRITE_ABI,
} from "@matchbox/chain"
import {
  concatHex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeFunctionResult,
  getAddress,
  type Hex,
  numberToHex,
  size,
} from "viem"
import { describe, expect, it } from "vitest"
import { revertDataCopy } from "../tx/errors"
import { decodeSimulation, simulationCall } from "./simulate"

/** What simulateAndRevert reverts with: success, length, returndata. */
function reverted(delegated: boolean, returnData: Hex): Hex {
  return concatHex([
    encodeAbiParameters([{ type: "bool" }], [delegated]),
    numberToHex(size(returnData), { size: 32 }),
    returnData,
  ])
}

describe("Safe simulation", () => {
  it("asks the Safe to delegatecall SimulateTxAccessor", () => {
    const to = getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2")
    const outer = decodeFunctionData({
      abi: SAFE_ABI,
      data: simulationCall({ to, value: 0n, data: "0x1234", operation: 1 }),
    })
    if (outer.functionName !== "simulateAndRevert") {
      throw new Error(`Unexpected ${outer.functionName}`)
    }
    expect(outer.args[0]).toBe(SAFE_CONTRACTS.mainnet.simulateTxAccessor)
    const inner = decodeFunctionData({
      abi: SIMULATE_TX_ACCESSOR_ABI,
      data: outer.args[1],
    })
    expect(inner.args).toEqual([to, 0n, "0x1234", 1])
  })

  it("reads a passing batch and its gas", () => {
    const result = encodeFunctionResult({
      abi: SIMULATE_TX_ACCESSOR_ABI,
      functionName: "simulate",
      result: [84_000n, true, "0x"],
    })
    expect(decodeSimulation(reverted(true, result))).toEqual({
      success: true,
      returnData: "0x",
      gas: 84_000n,
    })
  })

  it("names the revert of a failing call", () => {
    const revert = encodeErrorResult({
      abi: VOTING_ESCROW_WRITE_ABI,
      errorName: "LockExpired",
    })
    const result = encodeFunctionResult({
      abi: SIMULATE_TX_ACCESSOR_ABI,
      functionName: "simulate",
      result: [21_000n, false, revert],
    })
    const outcome = decodeSimulation(reverted(true, result))
    expect(outcome?.success).toBe(false)
    expect(
      revertDataCopy(outcome?.returnData ?? "0x", VOTING_ESCROW_WRITE_ABI),
    ).toBe("Lock expired")
  })

  it("rejects data that is not a Safe simulation", () => {
    expect(decodeSimulation("0x")).toBeNull()
    expect(decodeSimulation(reverted(false, "0x"))).toBeNull()
  })
})
