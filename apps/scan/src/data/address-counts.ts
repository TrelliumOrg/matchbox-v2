/**
 * An address's transaction count as its All transactions list has it.
 *
 * Blockscout's counter (`/addresses/{a}/counters`, `transactions_count`)
 * counts the transactions the address sent or was sent, and leaves out
 * the one that created it (no `to`, the address only as its created
 * contract), which the address's own list does show. A contract only ever
 * called through other contracts, an Enclave, read "0 transactions" beside
 * 158 transfers and a list of one. The creation is added back, so the
 * count and the list agree.
 */
export function transactionCount(
  counted: string | null,
  creation: string | null,
): string | null {
  if (counted === null || !/^[0-9]+$/.test(counted)) return null
  return (BigInt(counted) + (creation === null ? 0n : 1n)).toString()
}

/** "1 transaction", "4,169 transactions" (`grouped` already formatted). */
export function transactionWord(count: string): string {
  return count === "1" ? "transaction" : "transactions"
}
