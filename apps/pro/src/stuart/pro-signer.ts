import {
  ERC20_ABI,
  VOTER_WRITE_ABI,
  VOTING_ESCROW_WRITE_ABI,
  VOTING_REWARD_WRITE_ABI,
} from "@matchbox/chain"
import type { Proposal } from "@matchbox/stuart-ui/contract"
import type {
  StuartSignRequest,
  StuartSignResult,
} from "@matchbox/stuart-ui/store"
import {
  call,
  getAccount,
  sendTransaction,
  waitForTransactionReceipt,
} from "@wagmi/core"
import { type Abi, getAddress, type Hex, isHex } from "viem"
import type { HeadStore } from "../live/heads"
import { failureCopy } from "../tx/errors"
import { type RefreshTarget, refreshAfterBlock } from "../tx/refresh"
import { showToast } from "../tx/toasts"
import {
  mezoChainId,
  requireConfig,
  switchToMezo,
} from "../wallet/wallet-runtime"
import { getWallet, loadWallet, subscribeWallet } from "../wallet/wallet-store"
import { isUserRejection } from "../wallet/wallets"
import { signProposal } from "./sign-proposal"

/**
 * Pro's signer for Stuart, on wagmi. Loaded on the first signature, with the
 * wallet code; the transaction host (and its toasts) mounts with it.
 */

/** Every write ABI Pro knows, so a revert is named from the contract. */
const writeAbi: Abi = [
  ...VOTER_WRITE_ABI,
  ...VOTING_ESCROW_WRITE_ABI,
  ...VOTING_REWARD_WRITE_ABI,
  ...ERC20_ABI,
]

const success: Record<
  Proposal["kind"],
  { toast: string; refresh: RefreshTarget[] }
> = {
  vote: {
    toast: "Vote confirmed",
    refresh: ["voter", "overview", "gauges", "gauge", "activity", "home"],
  },
  claim: {
    toast: "Rewards claimed",
    refresh: ["rewards", "overview", "voter", "activity"],
  },
  claim_surplus: {
    toast: "Surplus claimed",
    refresh: ["overview", "activity"],
  },
  repay: { toast: "Repaid", refresh: ["overview", "activity"] },
  zap: { toast: "Deposited", refresh: ["overview", "activity"] },
  earn_deposit: { toast: "Deposited", refresh: ["overview", "activity"] },
  claim_relock: {
    toast: "Claimed and relocked",
    refresh: ["rewards", "overview", "voter", "activity", "home"],
  },
  lock: {
    toast: "Lock updated",
    refresh: ["overview", "voter", "activity", "home"],
  },
}

function calldata(value: string): Hex {
  if (!isHex(value)) throw new Error("Calldata is not hex")
  return value
}

/** Resolves once wagmi has reconnected (or found no wallet). */
function walletReady(signal: AbortSignal): Promise<void> {
  void loadWallet()
  return new Promise((resolve, reject) => {
    const stop = subscribeWallet(check)
    function check(): void {
      if (getWallet().phase !== "ready") return
      stop()
      resolve()
    }
    signal.addEventListener(
      "abort",
      () => {
        stop()
        reject(new Error("Closed"))
      },
      { once: true },
    )
    check()
  })
}

export async function signWithPro(
  request: StuartSignRequest,
  store: HeadStore,
): Promise<StuartSignResult> {
  await walletReady(request.signal)
  const config = requireConfig()
  const account = (): string | null => getWallet().account?.address ?? null
  return signProposal(request, {
    account,
    chainId: mezoChainId,
    async ensureChain() {
      if (getAccount(config).chainId !== mezoChainId) await switchToMezo(config)
    },
    async simulate(target) {
      await call(config, {
        account: getAddress(target.from),
        to: getAddress(target.to),
        data: calldata(target.data),
        chainId: mezoChainId,
      })
    },
    send: (target) =>
      sendTransaction(config, {
        account: getAddress(target.from),
        to: getAddress(target.to),
        data: calldata(target.data),
        chainId: mezoChainId,
      }),
    async wait(hash) {
      const receipt = await waitForTransactionReceipt(config, {
        hash,
        chainId: mezoChainId,
      })
      return {
        hash,
        status: receipt.status,
        blockNumber: receipt.blockNumber,
      }
    },
    failure: (error) => failureCopy(error, writeAbi),
    isRejection: isUserRejection,
    done(proposal, last) {
      const copy = success[proposal.kind]
      showToast({
        title: copy.toast,
        block: last.blockNumber,
        hash: last.hash,
        tone: "positive",
      })
      refreshAfterBlock({
        store,
        block: last.blockNumber,
        targets: copy.refresh,
        address: proposal.from,
      })
    },
  })
}
