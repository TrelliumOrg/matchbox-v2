import type { ReactNode } from "react"

/**
 * Classic signed people in with Bitcoin wallets (Unisat, OKX, Xverse)
 * through Mezo Passport; this Matchbox ID does not (README, "Not
 * supported"). The sign-in page shows this notice only when the build sets
 * VITE_BITCOIN_WALLET_NOTICE=true, for the weeks after cutover; the copy
 * is the owner-approved draft.
 */
export const bitcoinWalletNotice = {
  title: "Bitcoin wallets can't sign in here",
  body: "Sign in with an EVM wallet, like MetaMask, Rabby or OKX, or with WalletConnect. If you used Unisat, Xverse or OKX's Bitcoin account before, this starts a new Matchbox ID: apps you connected will ask you to connect again.",
} as const

export function bitcoinWalletNoticeEnabled(
  flag: string | undefined = import.meta.env.VITE_BITCOIN_WALLET_NOTICE,
): boolean {
  return flag === "true"
}

export function BitcoinWalletNotice(): ReactNode {
  return (
    <aside
      aria-labelledby="bitcoin-wallet-notice"
      className="mt-6 rounded-[20px] bg-soft px-5 py-4"
    >
      <h2
        id="bitcoin-wallet-notice"
        className="text-[15.5px] font-semibold text-ink"
      >
        {bitcoinWalletNotice.title}
      </h2>
      <p className="mt-1 text-[15px] text-sec">{bitcoinWalletNotice.body}</p>
    </aside>
  )
}
