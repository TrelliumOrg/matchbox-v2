import type { WalletChainReader } from "../src/warehouse/chain"

// Shared by the fixture recorder and the tests that replay it.

/** Wallets the recorded snapshot sweeps (keeps the fixture small). */
export const fixtureSweepWallets = 4

/** Chain reads that return nothing: no voting power, nothing claimable. */
export const emptyChainReader: WalletChainReader = {
  async poolGauges() {
    return { gauges: new Map(), failed: [] }
  },
  async rewardContracts() {
    return { contracts: [], failed: [] }
  },
  async rewardTokens() {
    return { tokens: new Map(), failed: [], truncated: [] }
  },
  async votingPower() {
    return new Map()
  },
  async earned() {
    return { earned: new Map(), failed: [] }
  },
  async locked() {
    return new Map()
  },
  diagnostics() {
    return { rejectedRequests: 0, lostRequests: 0, errors: [] }
  },
  async head() {
    return null
  },
}
