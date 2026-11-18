import type { ScanMezoIdNames } from "@matchbox/contracts/scan"
import type { AddressView } from "../views"
import { partsText, type SentencePart } from "./activity-view"

/**
 * Mezo IDs in place of bare wallet addresses in a page's lists
 * (transactions, transfers, holders, activity sentences). One read per page
 * names them all (mezo-names.server), from the IDs the API already has
 * cached: a list never asks Mezo once per row. An address that has our
 * label or Blockscout's name keeps it; a contract is no wallet and is never
 * asked about.
 */

/** The label a Mezo ID gives an address view (kind `mezo-id`). */
export const mezoIdLabelKind = "mezo-id"

function isAddressView(value: object): value is AddressView {
  return (
    "address" in value &&
    typeof value.address === "string" &&
    "contract" in value &&
    "name" in value
  )
}

type AddressPart = Extract<SentencePart, { kind: "address" }>

function isAddressPart(value: object): value is AddressPart {
  return (
    "kind" in value &&
    value.kind === "address" &&
    "address" in value &&
    typeof value.address === "string" &&
    "name" in value
  )
}

/** An address view shown as a short address: no label, no name, no code. */
function bareView(view: AddressView): boolean {
  return (view.label ?? null) === null && view.name === null && !view.contract
}

/**
 * The lower-case addresses a page shows bare, in the order they appear,
 * each once, at most `limit` of them (the read's cap).
 */
export function bareWallets(value: unknown, limit: number): string[] {
  const found = new Set<string>()
  const add = (address: string) => {
    if (found.size < limit && /^0x[0-9a-fA-F]{40}$/.test(address)) {
      found.add(address.toLowerCase())
    }
  }
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node === null || typeof node !== "object") return
    if (isAddressView(node) && bareView(node)) add(node.address)
    if (isAddressPart(node) && node.name === null) add(node.address)
    for (const child of Object.values(node)) walk(child)
  }
  walk(value)
  return [...found]
}

/**
 * The page with each bare address it shows named by its Mezo ID: an
 * address view gets a `mezo-id` label, a sentence's address its name (and
 * the sentence's text follows). Anything without an ID is left as it was.
 */
export function nameWallets<T>(value: T, names: ScanMezoIdNames): T {
  if (Object.keys(names).length === 0) return value
  const idOf = (address: string): string | null =>
    names[address.toLowerCase()] ?? null
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node === null || typeof node !== "object") return node
    const copy: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node)) copy[key] = walk(child)
    if (isAddressView(node) && bareView(node)) {
      const id = idOf(node.address)
      if (id !== null) {
        copy.label = { name: id, kind: mezoIdLabelKind, tags: [] }
      }
    }
    if (isAddressPart(node) && node.name === null) {
      const id = idOf(node.address)
      if (id !== null) copy.name = id
    }
    // A sentence's text is its parts read out: renamed parts, new text.
    if ("text" in node && typeof node.text === "string") {
      const parts = renamedParts(copy.parts, node)
      if (parts !== null) copy.text = partsText(parts)
    }
    return copy
  }
  return walk(value) as T
}

/**
 * A sentence's parts after naming, when one of its addresses was named
 * (null otherwise, or when they are not sentence parts).
 */
function renamedParts(named: unknown, original: object): SentencePart[] | null {
  if (!("parts" in original) || !Array.isArray(original.parts)) return null
  if (!Array.isArray(named) || named.length !== original.parts.length) {
    return null
  }
  const parts: SentencePart[] = []
  let renamed = false
  for (const [index, part] of named.entries()) {
    if (!isSentencePart(part)) return null
    const before: unknown = original.parts[index]
    if (
      part.kind === "address" &&
      typeof before === "object" &&
      before !== null &&
      isAddressPart(before) &&
      before.name !== part.name
    ) {
      renamed = true
    }
    parts.push(part)
  }
  return renamed ? parts : null
}

const sentenceKinds: ReadonlySet<unknown> = new Set([
  "text",
  "figure",
  "address",
  "gauge",
  "lock",
  "epoch",
  "method",
])

function isSentencePart(value: unknown): value is SentencePart {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    sentenceKinds.has(value.kind)
  )
}
