// Borrow routes for measure and Lighthouse, on the fixtures' ids: the
// BTC / mUSDC Morpho market (MORPHO_MARKETS in @matchbox/chain), the
// fixture wallet (a trove, a Morpho position, an Enclave position) and its
// Enclave position (world.ts `enclavePositionId`).
export const borrowMarket =
  "0x6f88e79e8acb3a3ac2f990dcfb83b42ddae96ef406cd735f1721b2a2e1b733db"
export const borrowWallet = "0x4582a89e307387293c7f93c11a095a8dd3d3f901"
export const borrowEnclavePosition = `0x${"e7c1a7e01".padStart(64, "0")}`
// The fixture wallet's loan transactions (entities.ts `loanTransactions`):
// its trove borrowing and its Enclave position's opening.
export const troveLoanTx = `0x${"b1".padStart(64, "0")}`
export const enclaveLoanTx = `0x${"ba".padStart(64, "0")}`

export const borrowRoutes = [
  "/borrow/enclaves",
  "/borrow/markets",
  "/borrow/positions",
  "/borrow/liquidations",
  "/borrow/troves",
  `/borrow/markets/${borrowMarket}`,
  `/borrow/markets/${borrowMarket}/${borrowWallet}`,
  `/borrow/troves/${borrowWallet}`,
  `/borrow/enclaves/${borrowEnclavePosition}`,
  `/tx/${troveLoanTx}`,
  `/tx/${enclaveLoanTx}`,
]

export const borrowLighthouseRoutes = [
  "/borrow",
  `/borrow/markets/${borrowMarket}`,
  `/borrow/markets/${borrowMarket}/${borrowWallet}`,
]
