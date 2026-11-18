import { z } from "zod"
import { addressSchema } from "../common"
import { unixSecondsSchema } from "./primitives"

// A wallet's Mezo ID ("alice.mezo") and the accounts linked to it, from
// Mezo's accounts API (api.mezo.org). The API caches it for a day and
// answers `unavailable` instead of failing when Mezo's API is down.

export const linkedAccountSchema = z.object({
  /** Mezo's account type ("evm", "btc", ...). */
  type: z.string().min(1),
  evmAddress: addressSchema.nullable(),
  btcAddress: z.string().min(1).nullable(),
})

export type LinkedAccount = z.infer<typeof linkedAccountSchema>

export const walletIdentitySchema = z.object({
  address: addressSchema,
  /** `found`: Mezo knows the wallet; `unavailable`: the lookup failed. */
  status: z.enum(["found", "not-found", "unavailable"]),
  /** "alice.mezo"; null without one (or when unavailable). */
  mezoId: z.string().min(1).nullable(),
  linkedAccounts: z.array(linkedAccountSchema),
})

export type WalletIdentity = z.infer<typeof walletIdentitySchema>

/** Not chain data, so the meta names the source and when it was asked. */
export const walletIdentityResponseSchema = z.object({
  data: walletIdentitySchema,
  meta: z.object({
    source: z.literal("mezo-accounts"),
    checkedAt: unixSecondsSchema,
  }),
})

export type WalletIdentityResponse = z.infer<
  typeof walletIdentityResponseSchema
>
