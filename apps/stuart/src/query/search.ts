import type { GaugeCard } from "@matchbox/contracts/read-models"
import type { SearchResponse, SearchResult } from "@matchbox/stuart-ui/contract"
import { getAddress } from "viem"
import { displayUsd } from "./format"
import type { ReadModelSource } from "./providers/readModels"
import { usdToMicro } from "./providers/units"
import { mayCarrySecret } from "./secretShapes"

// The Ctrl K bar's search: gauges by name or address prefix (the API's
// directory query), a wallet for a pasted address (with its Mezo ID), and a
// transaction for a pasted hash. Read only, no model, cheap: one directory
// page and at most one identity lookup per query. Text that may carry a
// key or phrase is never sent to the directory (the API Worker logs its
// request URLs): it gets no results.

const MATCHSCAN = "https://scan.matchbox.markets"
const GAUGE_LIMIT = 6

const TX_HASH = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function gaugeDetail(card: GaugeCard): string {
  const usd = card.incentives.usd
  if (usd === null || card.incentives.tokens.length === 0)
    return "No incentives"
  return `${displayUsd(usdToMicro(usd))} this epoch`
}

function gaugeResult(card: GaugeCard): SearchResult {
  return {
    type: "gauge",
    id: `gauge:${card.gauge.address.toLowerCase()}`,
    address: getAddress(card.gauge.address),
    name: card.gauge.name.trim().slice(0, 80),
    kind: card.gauge.kind,
    tokenId: card.gauge.vebtcTokenId,
    picture: card.gauge.picture,
    detail: gaugeDetail(card),
  }
}

export async function searchQuery(
  raw: string,
  readModels: ReadModelSource,
): Promise<SearchResponse> {
  const query = raw.replace(/\s+/g, " ").trim().slice(0, 120)
  if (query.length === 0) return { query, results: [] }
  const results: SearchResult[] = []
  if (TX_HASH.test(query)) {
    const hash = query.toLowerCase()
    results.push({
      type: "transaction",
      id: `tx:${hash}`,
      hash,
      url: `${MATCHSCAN}/tx/${hash}`,
    })
    return { query, results }
  }
  if (mayCarrySecret(raw.slice(0, 2_000))) return { query: "", results: [] }
  const [gauges, identity] = await Promise.all([
    query.length >= 2
      ? readModels.searchGauges(query.slice(0, 64), GAUGE_LIMIT).catch(() => [])
      : Promise.resolve([]),
    ADDRESS.test(query)
      ? readModels.identity(query.toLowerCase()).catch(() => null)
      : Promise.resolve(null),
  ])
  if (ADDRESS.test(query)) {
    results.push({
      type: "wallet",
      id: `wallet:${query.toLowerCase()}`,
      address: getAddress(query),
      mezoId: identity,
    })
  }
  for (const card of gauges) results.push(gaugeResult(card))
  return { query, results: results.slice(0, 12) }
}
