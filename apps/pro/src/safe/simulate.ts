import {
  SAFE_ABI,
  SAFE_CONTRACTS,
  SIMULATE_TX_ACCESSOR_ABI,
} from "@matchbox/chain"
import { type Config, call } from "@wagmi/core"
import {
  type Address,
  decodeAbiParameters,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  sliceHex,
} from "viem"
import { revertData, revertDataCopy } from "../tx/errors"
import { mezoChainId } from "../wallet/wallet-runtime"
import { type BatchedStep, type SafeCall, safeCallFor } from "./batch"

/**
 * Simulates what the Safe will execute, as the Safe, before any owner
 * signs: eth_call to the Safe's StorageAccessible.simulateAndRevert, which
 * DELEGATECALLs SimulateTxAccessor.simulate(to, value, data, operation) and
 * always reverts with (success, length, returndata). No signature, no
 * nonce, no state change. When the batch fails, growing prefixes find the
 * first call that fails so the review names it.
 */

export type SafeSimulation =
  | { ok: true; gas: bigint }
  | {
      ok: false
      /** Index in the plan of the call that fails, when it was found. */
      index: number | null
      reason: string | null
    }

type Outcome = { success: boolean; returnData: Hex; gas: bigint }

/** simulateAndRevert's revert data: success word, length word, returndata. */
export function decodeSimulation(data: Hex): Outcome | null {
  if (data.length < 2 + 64 * 2) return null
  const [delegated] = decodeAbiParameters(
    [{ type: "bool" }],
    sliceHex(data, 0, 32),
  )
  if (!delegated) return null
  const result = decodeFunctionResult({
    abi: SIMULATE_TX_ACCESSOR_ABI,
    functionName: "simulate",
    data: sliceHex(data, 64),
  })
  const [gas, success, returnData] = result
  return { success, returnData, gas }
}

export function simulationCall(safeCall: SafeCall): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "simulateAndRevert",
    args: [
      SAFE_CONTRACTS.mainnet.simulateTxAccessor,
      encodeFunctionData({
        abi: SIMULATE_TX_ACCESSOR_ABI,
        functionName: "simulate",
        args: [safeCall.to, safeCall.value, safeCall.data, safeCall.operation],
      }),
    ],
  })
}

async function run(
  config: Config,
  safe: Address,
  safeCall: SafeCall,
): Promise<Outcome | null> {
  try {
    await call(config, {
      to: safe,
      data: simulationCall(safeCall),
      chainId: mezoChainId,
    })
    // simulateAndRevert always reverts; a plain return is not a Safe.
    return null
  } catch (error) {
    const data = revertData(error)
    return data === null ? null : decodeSimulation(data)
  }
}

export async function simulateSafeBatch(
  config: Config,
  safe: Address,
  batch: readonly BatchedStep[],
): Promise<SafeSimulation> {
  if (batch.length === 0) return { ok: true, gas: 0n }
  const whole = await run(
    config,
    safe,
    safeCallFor(batch.map((each) => each.call)),
  )
  if (whole === null) return { ok: false, index: null, reason: null }
  if (whole.success) return { ok: true, gas: whole.gas }
  for (let length = 1; length <= batch.length; length++) {
    const prefix = batch.slice(0, length)
    const last = prefix.at(-1)
    if (last === undefined) break
    const outcome =
      length === batch.length
        ? whole
        : await run(config, safe, safeCallFor(prefix.map((each) => each.call)))
    if (outcome !== null && !outcome.success) {
      return {
        ok: false,
        index: last.index,
        reason: revertDataCopy(outcome.returnData, last.call.abi),
      }
    }
  }
  return { ok: false, index: null, reason: null }
}
