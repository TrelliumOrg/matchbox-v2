import { getAddress, type Hex, zeroAddress } from "viem"
import { describe, expect, it } from "vitest"
import { hashSafeTx, normalizeSignature, safeTx } from "./safe-tx"

describe("SafeTx", () => {
  it("hashes like the Safe's own getTransactionHash", () => {
    // eth_call getTransactionHash on Mezo's Safe 1.4.1 L2 singleton
    // (0x29fc…C762, chain 31612), 9 Nov 2026.
    const safe = getAddress("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762")
    const tx = safeTx(
      {
        to: getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2"),
        value: 0n,
        data: "0x8d80ff0a00",
        operation: 1,
      },
      7n,
    )
    expect(tx).toMatchObject({
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
    })
    expect(hashSafeTx(safe, tx)).toBe(
      "0x7553033daeff4dcf823c5d0f8345c8305d2fc5e015439bbad2405aee929c4e0d",
    )
  })

  it("moves a 0 or 1 recovery id to 27 or 28", () => {
    const body: Hex = `0x${"11".repeat(64)}`
    expect(normalizeSignature(`${body}00`)).toBe(`${body}1b`)
    expect(normalizeSignature(`${body}01`)).toBe(`${body}1c`)
    expect(normalizeSignature(`${body}1c`)).toBe(`${body}1c`)
  })
})
