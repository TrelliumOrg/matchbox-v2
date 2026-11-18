import { isAddress } from "../lib/format"
import {
  isRpcUrl,
  type NetworkSetting,
  type SigningSetting,
} from "../settings/settings-store"
import type { RpcTestResult } from "./rpc-test"

/**
 * The Network and Signing views edit a draft and save it to the settings
 * store. These decide what a draft saves as, or null while it cannot be
 * saved yet.
 */

export type NetworkDraft = { mode: "matchbox" | "custom"; rpcUrl: string }

/** The last Test, for the URL it ran against. */
export type RpcTestRun = { url: string; result: RpcTestResult }

export function networkDraftFrom(setting: NetworkSetting): NetworkDraft {
  return setting.mode === "custom"
    ? { mode: "custom", rpcUrl: setting.rpcUrl }
    : { mode: "matchbox", rpcUrl: "" }
}

/** A custom RPC saves only after it passed Test, as typed. */
export function networkToSave(
  draft: NetworkDraft,
  test: RpcTestRun | null,
): NetworkSetting | null {
  if (draft.mode === "matchbox") return { mode: "matchbox" }
  const url = draft.rpcUrl.trim()
  if (!isRpcUrl(url)) return null
  if (test === null || test.url !== url || test.result.kind !== "ok")
    return null
  return { mode: "custom", rpcUrl: url }
}

export type SigningDraft = { mode: "wallet" | "multisig"; safe: string }

export function signingDraftFrom(setting: SigningSetting): SigningDraft {
  return setting.mode === "multisig"
    ? { mode: "multisig", safe: setting.safe ?? "" }
    : { mode: "wallet", safe: "" }
}

/** Multisig needs the Safe's address. */
export function signingToSave(draft: SigningDraft): SigningSetting | null {
  if (draft.mode === "wallet") return { mode: "wallet" }
  const safe = draft.safe.trim()
  return isAddress(safe) ? { mode: "multisig", safe } : null
}

/** The value beside Network and Signing in the panel. */
export function networkLabel(setting: NetworkSetting): string {
  return setting.mode === "custom" ? "Custom RPC" : "Matchbox"
}

export function signingLabel(setting: SigningSetting): string {
  return setting.mode === "multisig" ? "Multisig" : "Wallet"
}
