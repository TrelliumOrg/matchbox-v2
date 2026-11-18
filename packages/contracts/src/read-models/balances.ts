import { z } from "zod"
import { addressSchema } from "../common"
import { readModelResponseSchema, tokenAmountSchema } from "./primitives"

// The wallet's spendable balances: "Available to lock" on New lock and the
// ballot rows. Read live from Mezo RPC for the requested wallet and cached
// per block, never stored.

export const walletBalancesSchema = z.object({
  address: addressSchema,
  /** Native BTC (gas token, also the veBTC lock token). */
  btc: tokenAmountSchema,
  /** MEZO, the veMEZO lock token. */
  mezo: tokenAmountSchema,
  musd: tokenAmountSchema,
  /**
   * Every other registered token the wallet holds (mUSDC, mUSDT, sMUSD,
   * SolvBTC, ...), largest USD value first; zero balances left out.
   */
  tokens: z.array(tokenAmountSchema).default([]),
})

export type WalletBalances = z.infer<typeof walletBalancesSchema>

export const walletBalancesResponseSchema =
  readModelResponseSchema(walletBalancesSchema)

export type WalletBalancesResponse = z.infer<
  typeof walletBalancesResponseSchema
>
