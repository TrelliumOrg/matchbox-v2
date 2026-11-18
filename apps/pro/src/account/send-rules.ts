import type { WalletTokenSymbol } from "./balances"

/**
 * What Send allows. BTC pays Mezo's network fees, so Max and the balance
 * check keep a small reserve of it; ERC-20s can be sent in full.
 */

/** 0.00001 BTC, in wei: far above a transfer's fee on Mezo. */
export const btcFeeReserve = 10_000_000_000_000n

export function maxSendable(
  symbol: WalletTokenSymbol,
  balance: bigint,
): bigint {
  if (symbol !== "BTC") return balance
  return balance > btcFeeReserve ? balance - btcFeeReserve : 0n
}

/** Why the send cannot go ahead, or null. Base units throughout. */
export function sendBlocked(input: {
  amount: bigint | null
  /** null while it loads. */
  balance: bigint | null
  symbol: WalletTokenSymbol
  to: string | null
  from: string
}): string | null {
  const { amount, balance, symbol } = input
  if (amount !== null && balance !== null) {
    if (amount > balance) return "More than your balance"
    if (amount > maxSendable(symbol, balance))
      return "Keep 0.00001 BTC for fees"
  }
  if (input.to !== null && input.to.toLowerCase() === input.from.toLowerCase())
    return "Same as this wallet"
  return null
}
