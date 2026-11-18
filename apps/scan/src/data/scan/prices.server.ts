import { epochStartForIndex } from "@matchbox/domain/epoch"
import { canonicalQuery } from "../caller.server"
import { type DailyPrice, type DailyPrices, dayOf } from "./pricing"
import { readScan } from "./read.server"
import { scanSchemas } from "./schemas"

/**
 * BTC's and MEZO's daily closes (`/prices/{btc,mezo}`) from `from` (unix
 * seconds; Epoch 0 by default, the voting history's start) to today, both
 * read at once (or only the ones `tokens` names; the others are empty). A price that did not answer is an empty list: what it
 * would price shows as unpriced, never as $0, and the rest of the page is
 * unaffected. Ranges stop at 730 days, the API's limit.
 */
export async function readDailyPrices(
  now: number,
  from: number = epochStartForIndex(0),
  tokens: readonly ("btc" | "mezo")[] = ["btc", "mezo"],
): Promise<DailyPrices> {
  const start = Math.max(from, now - 730 * 86_400)
  const query = canonicalQuery({ from: dayOf(start), to: dayOf(now) })
  const read = (token: "btc" | "mezo") =>
    tokens.includes(token)
      ? readScan(`prices/${token}`, query, scanSchemas.prices)
      : Promise.resolve(null)
  const [btc, mezo] = await Promise.all([read("btc"), read("mezo")])
  const points = (read: typeof btc): DailyPrice[] =>
    read?.status === "ok"
      ? read.data.data.points
          .map((point) => ({ day: point.day, price: point.price }))
          .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
      : []
  return { btc: points(btc), mezo: points(mezo) }
}
