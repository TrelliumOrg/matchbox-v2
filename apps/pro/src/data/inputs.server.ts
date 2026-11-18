import { env } from "cloudflare:workers"
import { addressInputSchema } from "@matchbox/contracts/common"
import {
  chainHeadSchema,
  gaugeDirectoryResponseSchema,
  gaugeProfileResponseSchema,
  pricesResponseSchema,
  proSummaryResponseSchema,
  protocolActivityResponseSchema,
  protocolEpochResponseSchema,
  protocolResponseSchema,
  walletActivityResponseSchema,
  walletBalancesResponseSchema,
  walletOverviewResponseSchema,
  walletRewardsResponseSchema,
} from "@matchbox/contracts/read-models"
import { canonicalMezoId } from "@matchbox/domain/mezo-id"
import { z } from "zod"
import type { EpochReference } from "./adapters"
import { fixtureEpochReference } from "./fixture-api"
import { dataMode } from "./source.server"
import type { ActivityFilter } from "./view-models"

/**
 * Server-only inputs: request validation, the shared response schemas (zod
 * stays on the Worker), the epoch numbering and the live config.
 */

export function parseAddress(value: unknown): string {
  return addressInputSchema.parse(value)
}

const filters = ["all", "votes", "claims", "locks", "incentives"] as const

export function parseFilter(value: unknown): ActivityFilter {
  return filters.find((filter) => filter === value) ?? "all"
}

/** A page cursor from the browser: the API's bounds, or none. */
export function parseCursor(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 200
    ? value
    : null
}

/**
 * `?after=<block>` for a read that must include a transaction the browser
 * just had mined, or nothing. The API reads past the answers it cached
 * before that block; one that predates the parameter ignores it.
 */
export function afterQuery(value: unknown, lead: "?" | "&" = "?"): string {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value < 1e12
    ? `${lead}after=${value}`
    : ""
}

export const headResponse = () => z.object({ data: chainHeadSchema })
export const pricesResponse = () => pricesResponseSchema
export const directoryResponse = () => gaugeDirectoryResponseSchema
export const profileResponse = () => gaugeProfileResponseSchema
export const protocolResponse = () => protocolResponseSchema
export const summaryResponse = () => proSummaryResponseSchema
export const protocolEpochResponse = () => protocolEpochResponseSchema
export const protocolActivityResponse = () => protocolActivityResponseSchema
export const overviewResponse = () => walletOverviewResponseSchema
export const rewardsResponse = () => walletRewardsResponseSchema
export const activityResponse = () => walletActivityResponseSchema
export const balancesResponse = () => walletBalancesResponseSchema

/** Fixtures and the API both number epochs like the chain (Epoch 9 on 5 Nov). */
export function epochReference(): EpochReference | null {
  return dataMode() === "fixtures" ? fixtureEpochReference : null
}

/**
 * How the browser follows new blocks. Fixtures simulate a block every 3.8s
 * so nothing leaves the machine; the API mode subscribes to the BlockHub
 * WebSocket through `/live/heads` and polls when it drops.
 */
export type LiveConfig =
  | { mode: "simulated" }
  | { mode: "blockhub"; rpcUrl: string | null }

/** Mezo mainnet's public RPC, for the wallet's reads and simulations. */
export const publicMezoRpc = "https://mainnet.mezo.public.validationcloud.io"

/**
 * The RPC the browser's wallet runtime reads and simulates through:
 * `MEZO_RPC_URL` when set (an Anvil fork in end-to-end tests), else the
 * public one. In every data mode, so fixtures can still sign.
 */
export function walletRpcUrl(): string {
  const rpc = z.url().safeParse(env.MEZO_RPC_URL)
  return rpc.success ? rpc.data : publicMezoRpc
}

export function liveConfig(): LiveConfig {
  if (dataMode() === "fixtures") return { mode: "simulated" }
  const rpc = z.url().safeParse(env.MEZO_RPC_URL)
  return { mode: "blockhub", rpcUrl: rpc.success ? rpc.data : null }
}

/**
 * An identity lookup key: a lower-case address, a Mezo ID by Mezo's rules
 * (@matchbox/domain/mezo-id), or null.
 */
export function parseIdentityKey(value: unknown): string | null {
  const address = addressInputSchema.safeParse(value)
  if (address.success) return address.data
  return typeof value === "string" ? canonicalMezoId(value) : null
}
