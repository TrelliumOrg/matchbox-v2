import { type Prices, pricesSchema } from "@matchbox/contracts/read-models"

// BTC and MEZO prices in KV, written by matchbox-jobs and read by both
// Workers. Kept apart from publish.ts so jobs need not import the gauge
// publish (and its picture decoders).

/** The KV key matchbox-jobs writes prices under. */
export const pricesKvKey = "prices:v1"

/** Latest prices from KV; null when absent or malformed. */
export async function readPricesFromKv(
  kv: KVNamespace,
): Promise<Prices | null> {
  const value: unknown = await kv.get(pricesKvKey, "json")
  const parsed = pricesSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
