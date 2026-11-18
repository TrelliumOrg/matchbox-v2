import type { GaugeCard } from "@matchbox/contracts/read-models"
import type { ScanLabelItem, ScanValidatorRow } from "@matchbox/contracts/scan"
import type { AddressLabel, AddressView } from "../views"

/**
 * Names for the addresses Blockscout leaves bare: block proposers by their
 * validator's name, gauges by their directory name. One lookup serves a
 * whole page (names.server keeps it per isolate), never a request per row.
 * Names are untrusted text: pages render them with UntrustedText.
 */

/** Lower-case address to name, per kind. */
export type KnownNames = {
  validators: Readonly<Record<string, string>>
  gauges: Readonly<Record<string, string>>
}

export const noNames: KnownNames = { validators: {}, gauges: {} }

/** A name longer than this is cut: rows show a few dozen characters at most. */
const longestName = 80

function clean(name: string | null): string | null {
  const text = (name ?? "").trim()
  return text === "" ? null : [...text].slice(0, longestName).join("")
}

/** What the names read needs of the `/validators` answer. */
type ValidatorsAnswer = {
  validators: readonly Pick<
    ScanValidatorRow,
    "address" | "name" | "label" | "gauge"
  >[]
  pool_without_operator: readonly { gauge: string; name: string }[]
}

/**
 * Each validator's name: Pro's directory name, else Scan's label (as the
 * Validators pages name them); and each validator gauge by the same name.
 */
export function namesFromValidators(answer: ValidatorsAnswer): KnownNames {
  const validators: Record<string, string> = {}
  const gauges: Record<string, string> = {}
  for (const row of answer.validators) {
    const name = clean(row.name ?? row.label)
    if (name === null) continue
    validators[row.address.toLowerCase()] = name
    if (row.gauge !== null) gauges[row.gauge.toLowerCase()] = name
  }
  for (const entry of answer.pool_without_operator) {
    const name = clean(entry.name)
    if (name !== null) gauges[entry.gauge.toLowerCase()] = name
  }
  return { validators, gauges }
}

/** Every gauge in Pro's directory by its name. */
export function namesFromDirectory(
  cards: readonly Pick<GaugeCard, "gauge">[],
): KnownNames {
  const gauges: Record<string, string> = {}
  for (const card of cards) {
    const name = clean(card.gauge.name)
    if (name !== null) gauges[card.gauge.address.toLowerCase()] = name
  }
  return { validators: {}, gauges }
}

/** Both lookups in one; the directory's gauge names win. */
export function mergeNames(...all: readonly KnownNames[]): KnownNames {
  const validators: Record<string, string> = {}
  const gauges: Record<string, string> = {}
  for (const names of all) {
    Object.assign(validators, names.validators)
    Object.assign(gauges, names.gauges)
  }
  return { validators, gauges }
}

/** The name an address has here, as a label; null without one. */
export function knownLabel(
  names: KnownNames,
  address: string,
): AddressLabel | null {
  const key = address.toLowerCase()
  const validator = names.validators[key]
  if (validator !== undefined) {
    return { name: validator, kind: "validator", tags: [] }
  }
  const gauge = names.gauges[key]
  if (gauge !== undefined) return { name: gauge, kind: "gauge", tags: [] }
  return null
}

function isAddressView(value: object): value is AddressView {
  return (
    "address" in value &&
    typeof value.address === "string" &&
    "contract" in value &&
    "name" in value
  )
}

/**
 * Names every address view in a page's data that has no label of ours
 * yet: a label from the labels read model wins, then these names.
 */
export function nameViews<T>(value: T, names: KnownNames): T {
  if (
    Object.keys(names.validators).length === 0 &&
    Object.keys(names.gauges).length === 0
  ) {
    return value
  }
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node === null || typeof node !== "object") return node
    const copy: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node)) copy[key] = walk(child)
    if (isAddressView(node) && (node.label ?? null) === null) {
      const label = knownLabel(names, node.address)
      if (label !== null) copy.label = label
    }
    return copy
  }
  return walk(value) as T
}

/**
 * A lock vote's gauge by its directory or validator name, which is what
 * Pro and the Gauges pages call it, over a generated label such as
 * "Gauge Pool 0xb4d4…51cc"; a gauge with neither keeps its label.
 */
export function nameVotes<
  Epoch extends {
    votes: readonly { gauge: string; gaugeName: string | null }[]
  },
>(epochs: readonly Epoch[], names: KnownNames): Epoch[] {
  return epochs.map((epoch) => ({
    ...epoch,
    votes: epoch.votes.map((vote) => ({
      ...vote,
      gaugeName: names.gauges[vote.gauge.toLowerCase()] ?? vote.gaugeName,
    })),
  }))
}

/** The names as a label map, for the activity sentences' gauges and addresses. */
export function labelMapOf(names: KnownNames): Record<string, ScanLabelItem> {
  const labels: Record<string, ScanLabelItem> = {}
  const add = (address: string, name: string, kind: string) => {
    labels[address] = {
      address,
      name,
      kind,
      tags: [],
      source: "curated",
      pool: null,
      gauge: kind === "gauge" ? address : null,
      updated_at: 0,
    }
  }
  for (const [address, name] of Object.entries(names.gauges)) {
    add(address, name, "gauge")
  }
  for (const [address, name] of Object.entries(names.validators)) {
    add(address, name, "validator")
  }
  return labels
}
