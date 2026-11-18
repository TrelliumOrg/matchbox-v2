import { env } from "cloudflare:workers"
import {
  createReadModelClient,
  dataModeFrom,
} from "@matchbox/app-kit/read-model"
import {
  chainHeadSchema,
  pricesResponseSchema,
} from "@matchbox/contracts/read-models"
import { liveConfig, walletRpcUrl } from "@matchbox/live/config"
import {
  getRequestHeader,
  setResponseHeader,
} from "@tanstack/react-start/server"
import { z } from "zod"
import { degradedHeader } from "../cache-policy"
import { apiReadTimeoutMs, fetchApi } from "./caller.server"
import { nowSeconds } from "./clock.server"
import { fixtureResponse } from "./fixtures"
import { fixtureScenario, scanFixture } from "./scan/fixtures"
import { scanSchemas } from "./scan/schemas"
import { readShell, type ShellSeed } from "./shell"

/**
 * The shell's data. Until the Scan API exists (`/internal/scan/*`, built by
 * the API owner), the head and prices come from the read models Pro already
 * uses. Swap these two paths when Scan's land.
 */
export const shellPaths = {
  head: "/internal/pro/head",
  prices: "/internal/pro/prices",
} as const

const client = createReadModelClient({
  timeoutMs: apiReadTimeoutMs,
  prefix: "",
  fixtures: fixtureResponse,
  service: "matchscan",
  mode: () => dataModeFrom(env.SCAN_DATA),
})

const headResponse = z.object({ data: chainHeadSchema })

type Delays = Pick<ShellSeed, "delayed" | "borrowDelayed">

/** What the status read found; `known: false` when it could not tell. */
type DelayRead = Delays & { known: boolean }

const noDelays: Delays = { delayed: false, borrowDelayed: false }

/**
 * Whether Scan's data lags (`/internal/scan/status`): the copy step has
 * halted tables or is failing (`halted` or `stale`), or the live Borrow
 * snapshot is behind (`liveSnapshot.stale`). Read beside the head and
 * prices.
 *
 * A 503 is the API without Scan's database: nothing is copied, so nothing
 * lags behind a copy, and the page may be stored. Any other failure (a
 * timeout, a 5xx or 429, an unreadable or invalid body) means the page
 * cannot say whether its data is current: `known` is false and the page
 * is degraded, so no shared cache keeps an "all current" page.
 */
async function scanDelays(fixtures: boolean): Promise<DelayRead> {
  const unknown = { ...noDelays, known: false }
  try {
    let status: number
    let body: unknown
    if (fixtures) {
      const answer = scanFixture(
        "status",
        new URLSearchParams(),
        fixtureScenario(getRequestHeader("x-scan-fixture") ?? null),
      )
      status = answer.status
      body = answer.body
    } else {
      const response = await fetchApi("/internal/scan/status")
      status = response.status
      body = response.ok ? await response.json() : null
    }
    if (status === 503) return { ...noDelays, known: true }
    const parsed = scanSchemas.status.safeParse(body)
    if (status !== 200 || !parsed.success) return unknown
    const data = parsed.data.data
    return {
      delayed: data.halted === true || data.stale,
      borrowDelayed: data.liveSnapshot?.stale === true,
      known: true,
    }
  } catch {
    return unknown
  }
}

/** Never rejects: a failed read degrades the shell (see readShell). */
export async function loadShell(): Promise<ShellSeed> {
  const fixtures = client.dataMode() === "fixtures"
  const [shell, { known, ...delays }] = await Promise.all([
    readShellOnce(fixtures),
    scanDelays(fixtures),
  ])
  const degraded = shell.degraded || !known
  if (degraded) setResponseHeader(degradedHeader, "1")
  return { ...shell, ...delays, degraded }
}

function readShellOnce(fixtures: boolean): Promise<ShellSeed> {
  return readShell(
    {
      head: async () =>
        (await client.readModel(shellPaths.head, headResponse)).data,
      prices: async () =>
        (await client.readModel(shellPaths.prices, pricesResponseSchema)).data,
    },
    {
      live: liveConfig(fixtures, env.MEZO_RPC_URL),
      rpc: walletRpcUrl(env.MEZO_RPC_URL),
      nowSeconds: nowSeconds(),
    },
  )
}
