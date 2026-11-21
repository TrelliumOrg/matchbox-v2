import { env } from "cloudflare:workers"
import {
  blockscoutClientHeader,
  blockscoutEndUserHeader,
  endUserKey,
} from "@matchbox/contracts/blockscout"
import {
  activityCategory,
  walletActivityResponseSchema,
} from "@matchbox/contracts/read-models"
import {
  type HistoryCsvKind,
  historyCsvFileName,
  historyCsvLines,
  historyCsvNote,
  historyCsvStart,
} from "@matchbox/contracts/read-models/history-csv"
import { fixtureResponse } from "./fixture-api"
import { busyExportWallet } from "./fixture-history"
import { dataMode, log, proClientName } from "./source.server"

// "Download CSV" on Activity and Rewards: a plain link to
// `/<address>/activity.csv` or `/<address>/rewards.csv`, served here
// before the router, so it needs no script. The file comes from the API's
// internal route (apps/api history-export.ts), streamed through as an
// attachment, so the browser saves it and stays on the page, with the
// visitor's end-user key for its download limit. With fixtures, it is
// built here from the fixture pages.
//
// A refusal or a failure is never a file: a browser would save the error
// text as the CSV, or list a failed download with no reason. It is a 303
// back to the page the link was on, with `?download=<reason>`, which the
// page shows as a message (`downloadNotice` in activity-row.tsx).

const exportPath = /^\/(0x[0-9a-fA-F]{40})\/(activity|rewards)\.csv$/

export type ExportRequest = { address: string; kind: HistoryCsvKind }

/** The wallet and file a path asks for, or null. */
export function matchExport(pathname: string): ExportRequest | null {
  const match = exportPath.exec(pathname)
  if (match === null) return null
  const [, address = "", kind] = match
  return {
    address: address.toLowerCase(),
    kind: kind === "rewards" ? "rewards" : "activity",
  }
}

/** Headers of the API's answer that reach the browser. */
const passed = [
  "content-type",
  "content-disposition",
  "etag",
  "cache-control",
  "retry-after",
]

/** Why a download did not happen, as the page's `download` query says. */
export type ExportRefusal = "busy" | "busy-day" | "none" | "failed"

/**
 * A refused download's reason from its `Retry-After`: a wait over a minute
 * is the day's limit (200 a visitor), not the minute's. Seconds or an HTTP
 * date; anything else is the minute's.
 */
export function busyReason(
  retryAfter: string | null,
  nowMs: number,
): "busy" | "busy-day" {
  if (retryAfter === null) return "busy"
  const text = retryAfter.trim()
  const seconds = /^\d+$/.test(text)
    ? Number(text)
    : (Date.parse(text) - nowMs) / 1000
  return seconds > 60 ? "busy-day" : "busy"
}

/** A page a Download CSV link is on: Activity or Rewards, any wallet. */
const pagePath = /^(?:\/[A-Za-z0-9._-]{1,80})?\/(?:activity|rewards)$/

/**
 * Where a refused download goes back to: the page it was asked from
 * (`Referer`) when that is Activity or Rewards on this origin, else the
 * wallet's page for the file. Only a path is returned, never an origin, so
 * it cannot send anyone elsewhere.
 */
export function returnPath(
  request: Request,
  wanted: ExportRequest,
  reason: ExportRefusal,
): string {
  const own = new URL(request.url)
  let path = `/${wanted.address}/${wanted.kind}`
  let search = new URLSearchParams()
  const referer = request.headers.get("referer")
  if (referer !== null) {
    try {
      const from = new URL(referer)
      if (from.origin === own.origin && pagePath.test(from.pathname)) {
        path = from.pathname
        search = new URLSearchParams(from.search)
      }
    } catch {
      // Not a URL: the wallet's page.
    }
  }
  search.set("download", reason)
  return `${path}?${search}`
}

function refused(
  request: Request,
  wanted: ExportRequest,
  reason: ExportRefusal,
): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: returnPath(request, wanted, reason),
      "cache-control": "no-store",
    },
  })
}

async function fromApi(
  request: Request,
  wanted: ExportRequest,
): Promise<Response> {
  const headers = new Headers({ accept: "text/csv" })
  headers.set(blockscoutClientHeader, proClientName)
  const key = await endUserKey(
    request.headers.get("cf-connecting-ip"),
    env.BLOCKSCOUT_CALLER_SALT,
  )
  if (key !== null) headers.set(blockscoutEndUserHeader, key)
  const conditional = request.headers.get("if-none-match")
  if (conditional !== null) headers.set("if-none-match", conditional)
  if (env.INTERNAL_TOKEN !== undefined) {
    headers.set("authorization", `Bearer ${env.INTERNAL_TOKEN}`)
  }
  const path = `/internal/pro/wallets/${wanted.address}/${wanted.kind}.csv`
  // A HEAD stays a HEAD: the API answers it without reading or charging.
  const method = request.method === "HEAD" ? "HEAD" : "GET"
  const response =
    env.API === undefined
      ? await fetch(new URL(path, env.API_ORIGIN), { headers, method })
      : await env.API.fetch(
          new Request(`https://api.internal${path}`, { headers, method }),
        )
  if (response.status === 404) return refused(request, wanted, "none")
  if (response.status === 429) {
    const reason = busyReason(response.headers.get("retry-after"), Date.now())
    return refused(request, wanted, reason)
  }
  if (response.status !== 200 && response.status !== 304) {
    log.error({
      message: "history export failed",
      kind: wanted.kind,
      status: response.status,
    })
    return refused(request, wanted, "failed")
  }
  const out = new Headers()
  for (const name of passed) {
    const value = response.headers.get(name)
    if (value !== null) out.set(name, value)
  }
  return new Response(response.body, { status: response.status, headers: out })
}

/** The fixture pages as the API would write them. */
function fromFixtures(wanted: ExportRequest): Response {
  const now = Date.now()
  let text = historyCsvStart
  let cursor: string | null = null
  let pending = false
  for (let guard = 0; guard < 200; guard += 1) {
    const query = new URLSearchParams({ limit: "100" })
    if (cursor !== null) query.set("cursor", cursor)
    const answer = fixtureResponse(
      `/internal/pro/wallets/${wanted.address}/activity?${query}`,
      now,
    )
    if (answer.status !== 200) break
    const page = walletActivityResponseSchema.parse(answer.body).data
    for (const row of page.rows) {
      if (
        wanted.kind === "activity" ||
        activityCategory(row.type) === "claims"
      ) {
        text += historyCsvLines(row, Math.floor(now / 1000))
      }
    }
    cursor = page.nextCursor
    if (cursor === null) {
      pending = page.pending === true
      break
    }
  }
  if (pending) text += historyCsvNote({ kind: "pending" })
  return new Response(text, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${historyCsvFileName(wanted.address, wanted.kind, Math.floor(now / 1000))}"`,
      "cache-control": "no-store",
    },
  })
}

/** Serves a CSV download; any other method than GET or HEAD is refused. */
export async function exportResponse(
  request: Request,
  wanted: ExportRequest,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } })
  }
  try {
    if (dataMode() !== "fixtures") return await fromApi(request, wanted)
    // One fixture wallet's downloads are refused, as the API's limit does.
    if (wanted.address === busyExportWallet) {
      return refused(request, wanted, "busy")
    }
    return fromFixtures(wanted)
  } catch (error) {
    log.error({ message: "history export failed", kind: wanted.kind, error })
    return refused(request, wanted, "failed")
  }
}
