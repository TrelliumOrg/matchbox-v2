import { ESCROW_MAXTIME, ESCROW_MAXTIME_SLOT } from "@matchbox/chain"
import { type Address, isAddress } from "viem"
import type { RpcClient } from "./ingest/rpc"

// Decoder v3 uses each escrow's MAXTIME as a constant (ESCROW_MAXTIME in
// @matchbox/chain): history must be decoded with the value each block saw,
// and the escrows expose no getter. The value is `maxLockTime` in storage,
// written only by the initializer, so it can change only through a proxy
// upgrade. Each tick reads the slot on both escrows (one eth_getStorageAt
// each) and reports any difference, so an upgrade that changes it is
// noticed within 15 minutes instead of silently skewing lock ends.

export type EscrowMaxTimeDrift = {
  escrow: Address
  expected: bigint
  onChain: bigint
}

export async function escrowMaxTimeDrift(
  rpc: Pick<RpcClient, "getStorageAt">,
): Promise<EscrowMaxTimeDrift[]> {
  const drift: EscrowMaxTimeDrift[] = []
  for (const [escrow, expected] of Object.entries(ESCROW_MAXTIME)) {
    if (!isAddress(escrow, { strict: false })) continue
    const onChain = await rpc.getStorageAt(escrow, ESCROW_MAXTIME_SLOT)
    if (onChain !== expected) drift.push({ escrow, expected, onChain })
  }
  return drift
}
