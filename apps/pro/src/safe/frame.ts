/**
 * Whether Pro runs inside an iframe (Safe{Wallet} loads Safe Apps in one).
 * Dependency free, so the first paint can decide to load the wallet early
 * without pulling wagmi or the Safe SDK.
 */
export function insideFrame(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top
  } catch {
    // A cross-origin parent can throw on access: still a frame.
    return true
  }
}
