import {
  type Address,
  getAddress,
  type Hex,
  keccak256,
  stringToHex,
} from "viem"
import { exportSplitCopy, splitForSafe } from "../safe/batch"
import type { PlanStep } from "./plans"

/**
 * "Export for Safe": a Safe Transaction Builder batch file (chain 31612),
 * one transaction per step, with the exact calldata of the same
 * `PlanStep.prepare` the wallet signs. Transaction Builder batches the
 * file into one Safe transaction itself. A step that needs an earlier
 * receipt (Auto max on a lock still to be created) cannot be computed yet:
 * it and every step after it are left out and reported, so the file only
 * holds what can be signed now.
 *
 * Transaction Builder only takes a dropped file (it cannot load a URL), so
 * the sheet downloads it and opens the builder inside the Safe.
 */

export type SafeBatchTransaction = { to: Address; value: string; data: Hex }

export type SafeBatchMeta = {
  name: string
  description: string
  txBuilderVersion?: string | undefined
  createdFromSafeAddress?: string | undefined
  checksum?: Hex | undefined
}

export type SafeBatchFile = {
  version: "1.0"
  chainId: string
  createdAt: number
  meta: SafeBatchMeta
  transactions: SafeBatchTransaction[]
}

export type SafeExport = {
  file: SafeBatchFile
  /** Steps left out, by their place in the plan (1 based) and label. */
  skipped: { step: number; label: string }[]
  /** "Step 3 needs the new lock id: export it after step 2 lands" */
  note: string | null
}

export function safeExport(input: {
  steps: readonly PlanStep[]
  name: string
  safe?: string | null
  createdAt: number
}): SafeExport {
  const batches = splitForSafe(input.steps)
  const meta: SafeBatchMeta = {
    name: input.name,
    description: batches.now.map(({ step }) => step.label).join(", "),
  }
  if (input.safe !== undefined && input.safe !== null) {
    meta.createdFromSafeAddress = getAddress(input.safe)
  }
  const file: SafeBatchFile = {
    version: "1.0",
    chainId: "31612",
    createdAt: input.createdAt,
    meta,
    transactions: batches.now.map(({ call }) => ({
      to: getAddress(call.to),
      value: (call.value ?? 0n).toString(),
      data: call.data,
    })),
  }
  return {
    file: withChecksum(file),
    skipped: batches.later.map(({ step, index }) => ({
      step: index + 1,
      label: step.label,
    })),
    note: exportSplitCopy(batches),
  }
}

// Transaction Builder's checksum (apps/tx-builder/src/lib/checksum.ts):
// keccak256 of a key-sorted serialization with meta.name set to null, so a
// file it imports reads as unchanged since export.

function serialize(json: unknown): string {
  if (Array.isArray(json)) return `[${json.map(serialize).join(",")}]`
  if (typeof json === "object" && json !== null) {
    const keys = Object.keys(json).sort()
    let out = `{${JSON.stringify(keys)}`
    for (const key of keys) out += `${serialize(Reflect.get(json, key))},`
    return `${out}}`
  }
  return JSON.stringify(json ?? null)
}

export function safeBatchChecksum(file: SafeBatchFile): Hex {
  const { checksum: _checksum, ...meta } = file.meta
  return keccak256(
    stringToHex(serialize({ ...file, meta: { ...meta, name: null } })),
  )
}

function withChecksum(file: SafeBatchFile): SafeBatchFile {
  return { ...file, meta: { ...file.meta, checksum: safeBatchChecksum(file) } }
}

/** "vote-2026-11-09.json" */
export function safeExportFileName(flow: string, at: Date): string {
  return `${flow}-${at.toISOString().slice(0, 10)}.json`
}

/** Saves the file in the browser. */
export function downloadSafeExport(
  fileName: string,
  file: SafeBatchFile,
): void {
  const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
