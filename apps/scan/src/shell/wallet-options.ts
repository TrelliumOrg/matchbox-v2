import type { WalletOptions } from "@matchbox/wallet/runtime"

/**
 * Matchbox's WalletConnect project, the same one Matchbox Pro uses (its
 * committed default in apps/pro/src/wallet/wallet-runtime.ts). Public: it
 * ships in the client bundle of every WalletConnect dapp. Committed so
 * every build (CI, previews) shows the WalletConnect row;
 * VITE_WALLET_CONNECT_PROJECT_ID overrides it at build time. The project
 * must allow scan.matchbox.markets among its origins (WalletConnect Cloud).
 */
export const walletConnectProjectId = "0bb73069e0eb41e3044476c5338cd586"

const fromEnv: string = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID ?? ""

/** Matchscan's wallet: identity and watch lists only, never a transaction. */
export const walletOptions: WalletOptions = {
  app: { name: "Matchscan", description: "Mezo's explorer" },
  walletConnectProjectId: fromEnv === "" ? walletConnectProjectId : fromEnv,
}
