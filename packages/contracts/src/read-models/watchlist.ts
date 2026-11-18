import { z } from "zod"
import { addressSchema } from "../common"
import { unixSecondsSchema } from "./primitives"

// A wallet's watch list: gauges and other wallets it follows. Stored in
// READ_DB. Writes carry an unsigned client id for now.
// TODO(matchbox-id): require a signed-in Matchbox ID session for writes and
// key the list by the account, not the wallet.

export const watchKindSchema = z.enum(["gauge", "wallet"])

export type WatchKind = z.infer<typeof watchKindSchema>

export const watchItemSchema = z.object({
  kind: watchKindSchema,
  address: addressSchema,
  addedAt: unixSecondsSchema,
})

export type WatchItem = z.infer<typeof watchItemSchema>

/** Most items one list may hold. */
export const watchListLimit = 100

export const watchListSchema = z.object({
  owner: addressSchema,
  /** Newest first. */
  items: z.array(watchItemSchema).max(watchListLimit),
})

export type WatchList = z.infer<typeof watchListSchema>

export const watchListResponseSchema = z.object({ data: watchListSchema })

export type WatchListResponse = z.infer<typeof watchListResponseSchema>

/** Header carrying the unsigned client id on watch list writes. */
export const watchClientHeader = "X-Matchbox-Client"

/** 8 to 64 URL-safe characters (a random id the browser keeps). */
export const watchClientIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, "Expected an 8 to 64 character client id")
