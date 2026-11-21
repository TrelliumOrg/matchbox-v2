/**
 * How long a wallet gets to reconnect before the screens stop waiting for
 * it. wagmi's reconnect asks the wallet for its accounts with no time
 * limit, and a wallet that never answers (a hung extension, a WalletConnect
 * relay that does not reply) left the header without Connect wallet and
 * made Claim do nothing (19 Nov 2026). Past the limit the wallet counts as
 * not connected; a late answer still connects (`watchAccount`).
 */
export const reconnectLimitMs = 8_000

/**
 * Waits for `work` for at most `ms`. Resolves either way (true when the
 * work finished in time); a failure counts as finished.
 */
export function within(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    work.then(
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      () => {
        clearTimeout(timer)
        resolve(true)
      },
    )
  })
}
