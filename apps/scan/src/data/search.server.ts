import { searchQuickSchema } from "@matchbox/contracts/blockscout"
import { escrowOf, lockName } from "@matchbox/domain/activity"
import { epochIndexFor } from "@matchbox/domain/epoch"
import { formatDay, shortAddress } from "@matchbox/domain/format"
import type { z } from "zod"
import { readBlockscout } from "./blockscout/read.server"
import { canonicalQuery } from "./caller.server"
import { poolMatches } from "./scan/crosschain-views"
import { readScan } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import type { SearchHit, SearchResult } from "./search"

/**
 * The palette's remote step (scan-plan.md, search): our labels, gauge
 * names, epochs and locks from `/internal/scan/search` first, and only on
 * a miss Blockscout's quick search through the proxy. Names and tags are
 * chain or label supplied: the palette renders them as untrusted text.
 */

const minQuery = 2

function blockscoutHits(
  hits: readonly z.infer<typeof searchQuickSchema>[number][],
): SearchHit[] {
  return hits.flatMap((hit): SearchHit[] => {
    const address = hit.address_hash?.toLowerCase() ?? null
    if (hit.type === "token" && address !== null) {
      return [
        {
          group: "addresses",
          icon: "token",
          title: hit.name ?? hit.symbol ?? address,
          tag: hit.symbol ?? "Token",
          detail: shortAddress(address),
          path: `/address/${address}`,
          untrusted: true,
        },
      ]
    }
    if (
      (hit.type === "address" || hit.type === "contract") &&
      address !== null
    ) {
      return [
        {
          group: "addresses",
          icon: hit.type === "contract" ? "contract" : "address",
          title: hit.name ?? shortAddress(address),
          tag: hit.type === "contract" ? "Contract" : null,
          detail: shortAddress(address),
          path: `/address/${address}`,
          untrusted: true,
        },
      ]
    }
    if (
      hit.type === "transaction" &&
      typeof hit.transaction_hash === "string"
    ) {
      const hash = hit.transaction_hash.toLowerCase()
      return [
        {
          group: "transactions",
          icon: "transaction",
          title: "Transaction",
          tag: null,
          detail: hash,
          path: `/tx/${hash}`,
          untrusted: false,
        },
      ]
    }
    if (hit.type === "block" && typeof hit.block_number === "number") {
      return [
        {
          group: "jump",
          icon: "block",
          title: `Block ${hit.block_number.toLocaleString("en-US")}`,
          tag: null,
          detail: "Block",
          path: `/block/${hit.block_number}`,
          untrusted: false,
        },
      ]
    }
    return []
  })
}

async function fromBlockscout(q: string): Promise<SearchResult> {
  const read = await readBlockscout(
    "search/quick",
    canonicalQuery({ q }),
    searchQuickSchema,
  )
  if (read.status === "ok") {
    return {
      status: "ok",
      source: "blockscout",
      hits: blockscoutHits(read.data),
    }
  }
  return {
    status: read.status === "rate-limited" ? "limited" : "failed",
    source: "blockscout",
    hits: [],
  }
}

/**
 * The remote search, then the tracked pools on every chain that match
 * (from the catalog, no read: the API's search does not know pools off
 * Mezo), as "Jump to" rows after the rest.
 */
export async function searchAll(input: {
  q: string
  kind: "name" | "address" | "address-prefix"
}): Promise<SearchResult> {
  const result = await searchApi(input)
  const pools = poolMatches(input.q.slice(0, 80), input.kind).map(
    (pool): SearchHit => ({
      group: "jump",
      icon: "pool",
      title: pool.title,
      tag: null,
      detail: pool.where,
      path: pool.path,
      untrusted: false,
    }),
  )
  return pools.length === 0
    ? result
    : { ...result, hits: [...result.hits, ...pools] }
}

async function searchApi(input: {
  q: string
  kind: "name" | "address" | "address-prefix"
}): Promise<SearchResult> {
  const q = input.q.trim().slice(0, 80)
  if (q.length < minQuery) return { status: "ok", source: "scan", hits: [] }
  const read = await readScan(
    "search",
    canonicalQuery({ kind: input.kind, q }),
    scanSchemas.search,
  )
  const hits: SearchHit[] =
    read.status !== "ok"
      ? []
      : read.data.data.hits.flatMap((hit): SearchHit[] => {
          switch (hit.type) {
            case "gauge":
              return [
                {
                  group: "gauges",
                  icon: "gauge",
                  title: hit.name,
                  tag: null,
                  detail: shortAddress(hit.address),
                  path: `/gauges/${hit.address.toLowerCase()}`,
                  untrusted: true,
                },
              ]
            case "label": {
              const { label } = hit
              const gauge =
                label.gauge ?? (label.kind === "gauge" ? label.address : null)
              return [
                {
                  group: gauge === null ? "addresses" : "gauges",
                  icon: gauge === null ? "address" : "gauge",
                  title: label.name,
                  tag: label.tags[0] ?? null,
                  detail: shortAddress(label.address),
                  path:
                    gauge === null
                      ? `/address/${label.address.toLowerCase()}`
                      : `/gauges/${gauge.toLowerCase()}`,
                  untrusted: true,
                },
              ]
            }
            case "epoch": {
              const number = epochIndexFor(hit.epoch_start)
              return [
                {
                  group: "jump",
                  icon: "epoch",
                  title: `Epoch ${number}`,
                  tag: null,
                  detail: `${formatDay(hit.epoch_start)} to ${formatDay(hit.epoch_start + 604_800)}`,
                  path: `/epochs/${number}`,
                  untrusted: false,
                },
              ]
            }
            case "lock": {
              const escrow = escrowOf(hit.escrow)
              if (escrow === null) return []
              return [
                {
                  group: "jump",
                  icon: "lock",
                  title: lockName(escrow, hit.token_id),
                  tag: null,
                  detail: "Lock",
                  path: `/locks/${escrow}/${hit.token_id}`,
                  untrusted: false,
                },
              ]
            }
            default:
              return []
          }
        })
  if (hits.length > 0) return { status: "ok", source: "scan", hits }
  // A full address with no label: its shape already offers the page.
  if (input.kind === "address") {
    return {
      status:
        read.status === "ok" ||
        read.status === "disabled" ||
        read.status === "missing"
          ? "ok"
          : read.status === "rate-limited"
            ? "limited"
            : "failed",
      source: "scan",
      hits: [],
    }
  }
  return fromBlockscout(q)
}
