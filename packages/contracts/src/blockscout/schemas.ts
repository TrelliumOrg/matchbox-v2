import { z } from "zod"

// Blockscout (api.explorer.mezo.org, v12) responses as the API Worker's
// proxy serves them (`/internal/blockscout/api/v2/*`). Each schema keeps
// only the fields an explorer needs and keeps Blockscout's field names, so
// a reader written against Blockscout (Stuart's) still parses what is kept.
// `z.object` strips everything else, so parsing is the trim. An upstream
// shape change fails here, in one place.
//
// Amounts (wei values, fees, token values, supplies, prices) stay decimal
// strings exactly as Blockscout sends them. Counts and heights that
// Blockscout sends as JSON numbers stay numbers; the ones it sends as
// strings (counters) stay strings.

/** Base-10 non-negative integer string ("0", "275749987500"). */
export const integerStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "Expected a non-negative integer string")

/** Decimal string, as Blockscout sends prices and supplies ("74973.5"). */
export const decimalStringSchema = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/, "Expected a decimal string")

/** Any-case 0x address; Blockscout sends checksummed addresses. */
export const hexAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected an address")

export const hexHashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 32-byte hash")

export const hexDataSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, "Expected hex data")

/** ISO 8601 timestamp ("2026-11-09T21:51:16.000000Z"). */
export const timestampSchema = z.string().min(1)

/** Keyset cursor for the next page; pass its entries back as the query. */
export const nextPageParamsSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .nullable()

export type NextPageParams = z.infer<typeof nextPageParamsSchema>

function page<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    next_page_params: nextPageParamsSchema,
  })
}

export const implementationSchema = z.object({
  address_hash: hexAddressSchema,
  name: z.string().nullable(),
})

/** An address as Blockscout embeds it in other resources. */
export const addressRefSchema = z.object({
  hash: hexAddressSchema,
  name: z.string().nullable(),
  is_contract: z.boolean().nullable(),
  is_verified: z.boolean().nullable(),
  implementations: z.array(implementationSchema).nullable(),
})

export type BlockscoutAddressRef = z.infer<typeof addressRefSchema>

/**
 * A token as embedded in transfers and balances: metadata only. Holder
 * counts, supply and prices change, so embedded copies leave them out
 * (immutable transactions must not freeze them); `tokenSchema` has them.
 */
export const tokenRefSchema = z.object({
  address_hash: hexAddressSchema,
  name: z.string().nullable(),
  symbol: z.string().nullable(),
  decimals: integerStringSchema.nullable(),
  type: z.string(),
  icon_url: z.string().nullable(),
})

export type BlockscoutTokenRef = z.infer<typeof tokenRefSchema>

/** `/tokens`, `/tokens/{address}`: metadata plus the moving figures. */
export const tokenSchema = tokenRefSchema.extend({
  holders_count: integerStringSchema.nullable(),
  total_supply: integerStringSchema.nullable(),
  exchange_rate: decimalStringSchema.nullable(),
  circulating_market_cap: decimalStringSchema.nullable(),
  volume_24h: decimalStringSchema.nullable(),
})

export type BlockscoutToken = z.infer<typeof tokenSchema>

export const blockSchema = z.object({
  height: z.number().int().nonnegative(),
  hash: hexHashSchema,
  parent_hash: hexHashSchema,
  timestamp: timestampSchema,
  transactions_count: z.number().int().nonnegative(),
  gas_used: integerStringSchema,
  gas_limit: integerStringSchema,
  base_fee_per_gas: integerStringSchema.nullable(),
  burnt_fees: integerStringSchema.nullable(),
  priority_fee: integerStringSchema.nullable(),
  transaction_fees: integerStringSchema.nullable(),
  size: z.number().int().nonnegative().nullable(),
  /** The proposer. */
  miner: addressRefSchema,
  /** Blockscout is still refetching the block; never cache it for long. */
  is_pending_update: z.boolean().nullable(),
})

export type BlockscoutBlock = z.infer<typeof blockSchema>

export const decodedParameterSchema = z.object({
  name: z.string(),
  type: z.string(),
  value: z.json(),
})

export const decodedInputSchema = z.object({
  method_call: z.string(),
  method_id: z.string(),
  parameters: z.array(decodedParameterSchema),
})

export const feeSchema = z.object({
  type: z.string(),
  value: integerStringSchema.nullable(),
})

export const tokenTransferTotalSchema = z.object({
  value: integerStringSchema.nullish(),
  decimals: integerStringSchema.nullish(),
  token_id: integerStringSchema.nullish(),
})

export const tokenTransferSchema = z.object({
  transaction_hash: hexHashSchema,
  block_number: z.number().int().nonnegative().nullable(),
  log_index: z.number().int().nonnegative().nullable(),
  timestamp: timestampSchema.nullable(),
  type: z.string(),
  method: z.string().nullable(),
  from: addressRefSchema,
  to: addressRefSchema,
  token: tokenRefSchema,
  total: tokenTransferTotalSchema.nullable(),
})

export type BlockscoutTokenTransfer = z.infer<typeof tokenTransferSchema>

/**
 * A transaction in a list: no input data and no transfers. Confirmations
 * and the current exchange rate are left out of every transaction shape
 * because they change after the transaction is final (derive
 * confirmations from the head).
 */
export const transactionSummarySchema = z.object({
  hash: hexHashSchema,
  block_number: z.number().int().nonnegative().nullable(),
  timestamp: timestampSchema.nullable(),
  /** "ok", "error", or null while pending. */
  status: z.string().nullable(),
  result: z.string().nullable(),
  method: z.string().nullable(),
  transaction_types: z.array(z.string()),
  from: addressRefSchema,
  to: addressRefSchema.nullable(),
  created_contract: addressRefSchema.nullable(),
  value: integerStringSchema,
  fee: feeSchema.nullable(),
  gas_used: integerStringSchema.nullable(),
  gas_limit: integerStringSchema.nullable(),
  gas_price: integerStringSchema.nullable(),
  nonce: z.number().int().nonnegative().nullable(),
  position: z.number().int().nonnegative().nullable(),
  historic_exchange_rate: decimalStringSchema.nullable(),
})

export type BlockscoutTransactionSummary = z.infer<
  typeof transactionSummarySchema
>

export const transactionSchema = transactionSummarySchema.extend({
  type: z.number().int().nullable(),
  base_fee_per_gas: integerStringSchema.nullable(),
  max_fee_per_gas: integerStringSchema.nullable(),
  max_priority_fee_per_gas: integerStringSchema.nullable(),
  priority_fee: integerStringSchema.nullable(),
  transaction_burnt_fee: integerStringSchema.nullable(),
  raw_input: hexDataSchema,
  decoded_input: decodedInputSchema.nullable(),
  revert_reason: z.record(z.string(), z.json()).nullable(),
  token_transfers: z.array(tokenTransferSchema).nullable(),
  token_transfers_overflow: z.boolean().nullable(),
  has_error_in_internal_transactions: z.boolean().nullable(),
  /** Blockscout is still refetching it; never cache it for long. */
  is_pending_update: z.boolean().nullable(),
})

export type BlockscoutTransaction = z.infer<typeof transactionSchema>

export const decodedLogSchema = z.object({
  method_call: z.string(),
  method_id: z.string(),
  parameters: z.array(decodedParameterSchema.extend({ indexed: z.boolean() })),
})

export const logSchema = z.object({
  transaction_hash: hexHashSchema,
  block_number: z.number().int().nonnegative(),
  /** The block's time; absent from older Blockscout versions. */
  block_timestamp: timestampSchema.nullish(),
  block_hash: hexHashSchema.nullable(),
  index: z.number().int().nonnegative(),
  address: addressRefSchema,
  topics: z.array(hexDataSchema.nullable()),
  data: hexDataSchema,
  decoded: decodedLogSchema.nullable(),
})

export type BlockscoutLog = z.infer<typeof logSchema>

export const internalTransactionSchema = z.object({
  transaction_hash: hexHashSchema,
  block_number: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
  timestamp: timestampSchema.nullable(),
  type: z.string().nullable(),
  from: addressRefSchema,
  to: addressRefSchema.nullable(),
  created_contract: addressRefSchema.nullable(),
  value: integerStringSchema,
  gas_limit: integerStringSchema.nullable(),
  success: z.boolean().nullable(),
  error: z.string().nullable(),
})

export type BlockscoutInternalTransaction = z.infer<
  typeof internalTransactionSchema
>

/** `status` 1 is complete; anything else means not processed yet. */
export const indexingMetaSchema = z.object({
  status: z.number().int(),
  message: z.string().nullable(),
})

export const addressSchema = addressRefSchema.extend({
  coin_balance: integerStringSchema.nullable(),
  exchange_rate: decimalStringSchema.nullable(),
  block_number_balance_updated_at: z.number().int().nonnegative().nullable(),
  creator_address_hash: hexAddressSchema.nullable(),
  creation_transaction_hash: hexHashSchema.nullable(),
  proxy_type: z.string().nullable(),
  token: tokenRefSchema.nullable(),
  has_logs: z.boolean().nullable(),
  has_token_transfers: z.boolean().nullable(),
  has_tokens: z.boolean().nullable(),
  has_validated_blocks: z.boolean().nullable(),
})

export type BlockscoutAddress = z.infer<typeof addressSchema>

export const addressCountersSchema = z.object({
  transactions_count: integerStringSchema.nullable(),
  token_transfers_count: integerStringSchema.nullable(),
  gas_usage_count: integerStringSchema.nullable(),
  validations_count: integerStringSchema.nullable(),
})

export const tokenBalanceSchema = z.object({
  token: tokenRefSchema,
  token_id: integerStringSchema.nullable(),
  value: integerStringSchema,
})

export const tokenCountersSchema = z.object({
  transfers_count: integerStringSchema.nullable(),
  token_holders_count: integerStringSchema.nullable(),
})

export const tokenHolderSchema = z.object({
  address: addressRefSchema,
  token_id: integerStringSchema.nullable(),
  value: integerStringSchema,
})

/** One search hit; which fields are set depends on `type`. */
export const searchResultSchema = z.object({
  type: z.string(),
  name: z.string().nullish(),
  symbol: z.string().nullish(),
  address_hash: hexAddressSchema.nullish(),
  transaction_hash: hexHashSchema.nullish(),
  block_hash: hexHashSchema.nullish(),
  block_number: z.number().int().nonnegative().nullish(),
  token_type: z.string().nullish(),
  icon_url: z.string().nullish(),
  is_smart_contract_verified: z.boolean().nullish(),
  timestamp: timestampSchema.nullish(),
  url: z.string().nullish(),
})

export type BlockscoutSearchResult = z.infer<typeof searchResultSchema>

export const gasPricesSchema = z.object({
  slow: z.number().nullable(),
  average: z.number().nullable(),
  fast: z.number().nullable(),
})

export const statsSchema = z.object({
  /** Milliseconds. */
  average_block_time: z.number().nullable(),
  total_blocks: integerStringSchema.nullable(),
  total_transactions: integerStringSchema.nullable(),
  total_addresses: integerStringSchema.nullable(),
  transactions_today: integerStringSchema.nullable(),
  gas_used_today: integerStringSchema.nullable(),
  gas_prices: gasPricesSchema.nullable(),
  coin_price: decimalStringSchema.nullable(),
  market_cap: decimalStringSchema.nullable(),
  network_utilization_percentage: z.number().nullable(),
})

export const transactionsChartSchema = z.object({
  chart_data: z.array(
    z.object({
      date: z.string(),
      transactions_count: z.number().int().nonnegative(),
    }),
  ),
})

export const marketChartSchema = z.object({
  available_supply: decimalStringSchema.nullable(),
  chart_data: z.array(
    z.object({
      date: z.string(),
      closing_price: decimalStringSchema.nullable(),
      market_cap: decimalStringSchema.nullable(),
    }),
  ),
})

/** Verification status and ABI only; sources and bytecode are left out. */
export const smartContractSchema = z.object({
  name: z.string().nullable(),
  language: z.string().nullable(),
  compiler_version: z.string().nullable(),
  evm_version: z.string().nullable(),
  optimization_enabled: z.boolean().nullable(),
  optimization_runs: z.number().int().nullable(),
  license_type: z.string().nullable(),
  is_verified: z.boolean().nullable(),
  is_fully_verified: z.boolean().nullable(),
  is_partially_verified: z.boolean().nullable(),
  verified_at: timestampSchema.nullable(),
  proxy_type: z.string().nullable(),
  implementations: z.array(implementationSchema).nullable(),
  abi: z.array(z.json()).nullable(),
})

/** One frame of a call trace, flattened depth first. */
export const traceFrameSchema = z.object({
  depth: z.number().int().nonnegative(),
  type: z.string(),
  from: hexAddressSchema,
  to: hexAddressSchema.nullable(),
  /** Wei, base 10. */
  value: integerStringSchema,
  /** Base 10. */
  gas_used: integerStringSchema.nullable(),
  error: z.string().nullable(),
})

export type BlockscoutTraceFrame = z.infer<typeof traceFrameSchema>

/**
 * `/transactions/{hash}/raw-trace` summary: the call tree flattened, with
 * no input or output data. Not Blockscout's shape (a callTracer tree).
 */
export const traceSummarySchema = z.object({
  frames: z.array(traceFrameSchema),
  /** True when the tree had more frames than were kept. */
  truncated: z.boolean(),
})

export type BlockscoutTraceSummary = z.infer<typeof traceSummarySchema>

export const blocksPageSchema = page(blockSchema)
export const transactionsPageSchema = page(transactionSummarySchema)
export const logsPageSchema = page(logSchema)
export const tokenTransfersPageSchema = page(tokenTransferSchema)
export const internalTransactionsPageSchema = page(
  internalTransactionSchema,
).extend({ meta: indexingMetaSchema.nullish() })
export const tokensPageSchema = page(tokenSchema)
export const tokenBalancesPageSchema = page(tokenBalanceSchema)
export const tokenHoldersPageSchema = page(tokenHolderSchema)
export const searchPageSchema = page(searchResultSchema)
export const searchQuickSchema = z.array(searchResultSchema)
export const mainPageBlocksSchema = z.array(blockSchema)
export const mainPageTransactionsSchema = z.array(transactionSummarySchema)
