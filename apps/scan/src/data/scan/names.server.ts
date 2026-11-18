import {
  type KnownNames,
  mergeNames,
  namesFromDirectory,
  namesFromValidators,
  noNames,
} from "./names"
import { readScan } from "./read.server"
import { scanSchemas } from "./schemas"

/**
 * The isolate's name lookup (names.ts): `/validators` and Pro's gauge
 * directory (`/gauges`), read together at most every five minutes and
 * shared by every page this isolate renders (validators join or rename
 * days apart). Pages read it beside their own reads, so a refresh adds no
 * wait of its own, and concurrent renders share one read. A read that
 * fails keeps the last names; with none, the lookup is empty and is tried
 * again after a minute, never once per page.
 */

/** How long a good lookup is kept. */
export const namesKeepMs = 300_000
/** How soon a lookup that failed is tried again. */
export const namesRetryMs = 60_000

let held: { names: KnownNames; until: number } | null = null
let pending: Promise<KnownNames> | null = null

/** For tests: forget the isolate's lookup. */
export function forgetNames(): void {
  held = null
  pending = null
}

async function readNames(nowMs: number): Promise<KnownNames> {
  const [validators, directory] = await Promise.all([
    readScan("validators", new URLSearchParams(), scanSchemas.validators),
    readScan("gauges", new URLSearchParams(), scanSchemas.gauges),
  ])
  const parts: KnownNames[] = []
  if (validators.status === "ok") {
    parts.push(namesFromValidators(validators.data.data))
  }
  if (directory.status === "ok") {
    parts.push(namesFromDirectory(directory.data.data.gauges))
  }
  const answered = parts.length === 2
  // Both answered: exactly these names. Otherwise the last names, with
  // whatever did answer on top.
  const names = answered
    ? mergeNames(...parts)
    : mergeNames(held?.names ?? noNames, ...parts)
  held = { names, until: nowMs + (answered ? namesKeepMs : namesRetryMs) }
  return held.names
}

export function knownNames(): Promise<KnownNames> {
  const nowMs = Date.now()
  if (held !== null && nowMs < held.until) return Promise.resolve(held.names)
  if (pending === null) {
    pending = readNames(nowMs).finally(() => {
      pending = null
    })
  }
  return pending
}
