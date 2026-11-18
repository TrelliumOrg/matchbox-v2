import type { AddressLabel, AddressView } from "../views"
import type { LabelMap } from "./activity-view"

/**
 * Puts our labels on every address view in a page's data: names for
 * validators, gauges and protocol contracts that Blockscout does not have.
 * Walks plain data (view models), so one call covers a whole page.
 */

export function labelOf(
  labels: LabelMap,
  address: string,
): AddressLabel | null {
  const found = labels[address.toLowerCase()]
  return found === undefined
    ? null
    : { name: found.name, kind: found.kind, tags: found.tags }
}

function isAddressView(value: object): value is AddressView {
  return (
    "address" in value &&
    typeof value.address === "string" &&
    "contract" in value &&
    "name" in value
  )
}

export function attachLabels<T>(value: T, labels: LabelMap): T {
  if (Object.keys(labels).length === 0) return value
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node === null || typeof node !== "object") return node
    const copy: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node)) copy[key] = walk(child)
    if (isAddressView(node)) {
      copy.label = labelOf(labels, node.address) ?? node.label ?? null
    }
    return copy
  }
  return walk(value) as T
}
