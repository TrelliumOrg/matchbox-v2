import type { Chain } from "viem"

export const CHAIN_ID = {
  testnet: 31611,
  mainnet: 31612,
} as const

export type SupportedChainId = (typeof CHAIN_ID)[keyof typeof CHAIN_ID]

/** Mezo mainnet as a viem chain, for wallets and transaction review. */
export const MEZO_MAINNET = {
  id: CHAIN_ID.mainnet,
  name: "Mezo",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mainnet.mezo.public.validationcloud.io"] },
  },
  blockExplorers: {
    default: { name: "Mezo Explorer", url: "https://explorer.mezo.org" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
} as const satisfies Chain
