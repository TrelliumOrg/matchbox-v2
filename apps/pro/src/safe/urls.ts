/**
 * Safe{Wallet} on Mezo: safe.mezo.org, run by Den, with its own
 * Transaction Service. Chain 31612, short name "mezo". Its one Safe App is
 * Transaction Builder, which only takes a dropped file, so Pro's export
 * opens it and the sheet says to drop the JSON.
 */

export const safeWebOrigin = "https://safe.mezo.org"

export const safeTxServiceOrigin =
  "https://safe-transaction-mezo.safe.onchainden.com"

export const safeChainShortName = "mezo"

export const safeChainId = 31612

export const txBuilderAppUrl = "https://apps-portal.safe.global/tx-builder"

export const proAppUrl = "https://pro.matchbox.markets"

function safeParam(safe: string): string {
  return `${safeChainShortName}:${safe}`
}

/** The Safe's queue, where co-signers confirm and execute. */
export function safeQueueUrl(safe: string): string {
  return `${safeWebOrigin}/transactions/queue?safe=${safeParam(safe)}`
}

/** One queued transaction, by its SafeTx hash. */
export function safeTxUrl(safe: string, safeTxHash: string): string {
  return `${safeWebOrigin}/transactions/tx?safe=${safeParam(safe)}&id=multisig_${safe}_${safeTxHash}`
}

/** Opens a Safe App inside the Safe. */
export function safeAppOpenUrl(safe: string, appUrl: string): string {
  return `${safeWebOrigin}/apps/open?safe=${safeParam(safe)}&appUrl=${encodeURIComponent(appUrl)}`
}

/** Transaction Builder inside the Safe, for an exported batch. */
export function txBuilderOpenUrl(safe: string): string {
  return safeAppOpenUrl(safe, txBuilderAppUrl)
}

/** Pro itself inside the Safe, as a Safe App. */
export function proInSafeUrl(safe: string): string {
  return safeAppOpenUrl(safe, proAppUrl)
}
