import type { Proposal } from "./contract"

/**
 * "Export for Safe" (matchbox-v3 Signing): a Safe Transaction Builder batch
 * file for chain 31612, one transaction per call in index order, with the
 * exact calldata the wallet would sign. Transaction Builder takes a dropped
 * file, so the card downloads it. No checksum: the builder accepts a file
 * without one.
 */

export type SafeBatchFile = {
  version: "1.0"
  chainId: string
  createdAt: number
  meta: { name: string; description: string; createdFromSafeAddress?: string }
  transactions: { to: string; value: string; data: string }[]
}

export function safeBatch(input: {
  proposal: Proposal
  name: string
  createdAt: number
  safe?: string | null
}): SafeBatchFile {
  const calls = [...input.proposal.calls].sort((a, b) => a.index - b.index)
  return {
    version: "1.0",
    chainId: String(input.proposal.chainId),
    createdAt: input.createdAt,
    meta: {
      name: input.name,
      description: calls
        .map((call) =>
          call.detail === undefined
            ? call.label
            : `${call.label}, ${call.detail}`,
        )
        .join(". "),
      ...(input.safe === null || input.safe === undefined
        ? {}
        : { createdFromSafeAddress: input.safe }),
    },
    transactions: calls.map((call) => ({
      to: call.to,
      value: "0",
      data: call.data,
    })),
  }
}

/** Saves the batch as a JSON file the person drops into Transaction Builder. */
export function downloadSafeBatch(file: SafeBatchFile, id: string): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `matchbox-${id}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
