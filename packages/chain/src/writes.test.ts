import { encodeFunctionData, toFunctionSelector } from "viem"
import { describe, expect, it } from "vitest"
import {
  CHAIN_ID,
  MEZO_MAINNET,
  VEBTC_MAX_LOCK_SECONDS,
  VEMEZO_MAX_LOCK_SECONDS,
  VOTER_WRITE_ABI,
  VOTING_ESCROW_WRITE_ABI,
  VOTING_REWARD_WRITE_ABI,
} from "./index"

function names(abi: readonly { type: string; name?: string }[], type: string) {
  return abi.filter((item) => item.type === type).map((item) => item.name)
}

describe("write ABIs", () => {
  it("never carries an ERC-721 approval (approve is custody on the escrows)", () => {
    for (const abi of [
      VOTING_ESCROW_WRITE_ABI,
      VOTER_WRITE_ABI,
      VOTING_REWARD_WRITE_ABI,
    ]) {
      expect(names(abi, "function")).not.toContain("approve")
      expect(names(abi, "function")).not.toContain("setApprovalForAll")
    }
  })

  it("matches the verified escrow selectors", () => {
    const selectors = Object.fromEntries(
      VOTING_ESCROW_WRITE_ABI.filter((item) => item.type === "function").map(
        (item) => [item.name, toFunctionSelector(item)],
      ),
    )
    expect(selectors).toMatchObject({
      createLock: "0xb52c05fe",
      increaseAmount: "0xb2383e55",
      increaseUnlockTime: "0x9d507b8b",
      merge: "0xd1c2babb",
      withdraw: "0x2e1a7d4d",
      lockPermanent: "0xe75b1c2e",
      unlockPermanent: "0x35b0f6bd",
      safeTransferFrom: "0x42842e0e",
    })
  })

  it("names the voting window reverts", () => {
    expect(names(VOTER_WRITE_ABI, "error")).toEqual(
      expect.arrayContaining([
        "AlreadyVotedOrDeposited",
        "DistributeWindow",
        "NotWhitelistedNFT",
        "SpecialVotingWindow",
      ]),
    )
  })

  it("encodes a vote", () => {
    expect(
      encodeFunctionData({
        abi: VOTER_WRITE_ABI,
        functionName: "vote",
        args: [2207n, ["0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e"], [7000n]],
      }).slice(0, 10),
    ).toBe("0x7ac09bf7")
  })

  it("knows the lock limits and the chain", () => {
    expect(VEMEZO_MAX_LOCK_SECONDS).toBe(125_798_400)
    expect(VEBTC_MAX_LOCK_SECONDS).toBe(2_419_200)
    expect(MEZO_MAINNET.id).toBe(CHAIN_ID.mainnet)
  })
})
