import { ESCROW_MAXTIME } from "@matchbox/chain"
import { describe, expect, it } from "vitest"
import { escrowMaxTimeDrift } from "../src/escrow-maxtime"
import { fakeRpc } from "./fake-rpc"

// Decoder v3 decodes lock ends with ESCROW_MAXTIME as constants; the tick
// reads each escrow's maxLockTime slot so an upgrade that changes it is
// noticed (src/escrow-maxtime.ts).

const VEBTC = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"

describe("escrow MAXTIME drift", () => {
  it("is empty while both slots hold ESCROW_MAXTIME", async () => {
    expect(await escrowMaxTimeDrift(fakeRpc())).toEqual([])
  })

  it("names an escrow whose slot changed", async () => {
    expect(
      await escrowMaxTimeDrift(fakeRpc({ [VEBTC]: 7n * 86_400n })),
    ).toEqual([
      { escrow: VEBTC, expected: ESCROW_MAXTIME[VEBTC], onChain: 604_800n },
    ])
  })
})
