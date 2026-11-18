import { useSyncExternalStore } from "react"

/**
 * Account panel settings that live in this browser only (localStorage,
 * every access in try/catch, so a private window or blocked storage falls
 * back to the defaults):
 *
 * - network: "matchbox" reads through Matchbox (the RPC the Worker names),
 *   "custom" sends every read and simulation to `rpcUrl` instead.
 * - signing: "wallet" signs each step in the wallet; "multisig" makes every
 *   review's primary "Export for Safe" and remembers the Safe address.
 * - gaugeView: Vote's gauge list as cards ("comfortable") or one row per
 *   gauge ("compact"). `gaugeViewScript` sets it on <html> before first
 *   paint, so the list never changes shape after load.
 *
 * Haptics keep their own switch in @matchbox/motion (`mbx-haptics`).
 * Tiny and dependency free: it may sit in the first paint.
 */

export type NetworkSetting =
  | { mode: "matchbox" }
  | { mode: "custom"; rpcUrl: string }

export type SigningSetting =
  | { mode: "wallet" }
  | { mode: "multisig"; safe: string | null }

export type GaugeView = "comfortable" | "compact"

export type Settings = {
  network: NetworkSetting
  signing: SigningSetting
  gaugeView: GaugeView
}

export const settingsStorageKey = "mbx-settings"

export const defaultSettings: Settings = {
  network: { mode: "matchbox" },
  signing: { mode: "wallet" },
  gaugeView: "comfortable",
}

/** The <html> attribute the gauge card's compact styles key on. */
export const gaugeViewAttribute = "data-gauge-view"

/**
 * Runs in <head> before first paint: a stored compact view applies before
 * the server HTML is drawn. Kept to the one field it reads.
 */
export const gaugeViewScript = `(function(){try{var s=JSON.parse(window.localStorage.getItem("${settingsStorageKey}")||"null");if(s&&s.gaugeView==="compact")document.documentElement.setAttribute("${gaugeViewAttribute}","compact")}catch(e){}})()`

const address = /^0x[0-9a-fA-F]{40}$/

/**
 * Hosts that name this machine: a node of your own may run without TLS.
 * Not [::1]: browsers ignore an IPv6 address in a Content Security Policy,
 * so the page could never reach it.
 */
function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1"
  )
}

/**
 * A custom RPC Pro can reach: https anywhere, plain http only on this
 * machine. The page's Content Security Policy allows exactly these
 * (security.server.ts), and a browser blocks other http from an https page.
 */
export function isRpcUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && isLocalHost(url.hostname))
    )
  } catch {
    return false
  }
}

/** Reads stored settings without trusting them. */
export function parseSettings(raw: string | null): Settings {
  if (raw === null) return defaultSettings
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return defaultSettings
  }
  if (typeof value !== "object" || value === null) return defaultSettings
  const network: unknown = Reflect.get(value, "network")
  const signing: unknown = Reflect.get(value, "signing")
  const rpcUrl =
    typeof network === "object" && network !== null
      ? Reflect.get(network, "rpcUrl")
      : null
  const safe =
    typeof signing === "object" && signing !== null
      ? Reflect.get(signing, "safe")
      : null
  const gaugeView: unknown = Reflect.get(value, "gaugeView")
  return {
    network:
      typeof network === "object" &&
      network !== null &&
      Reflect.get(network, "mode") === "custom" &&
      typeof rpcUrl === "string" &&
      isRpcUrl(rpcUrl)
        ? { mode: "custom", rpcUrl }
        : { mode: "matchbox" },
    signing:
      typeof signing === "object" &&
      signing !== null &&
      Reflect.get(signing, "mode") === "multisig"
        ? {
            mode: "multisig",
            safe: typeof safe === "string" && address.test(safe) ? safe : null,
          }
        : { mode: "wallet" },
    gaugeView: gaugeView === "compact" ? "compact" : "comfortable",
  }
}

let current: Settings | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function getSettings(): Settings {
  if (current !== null) return current
  try {
    current = parseSettings(storage()?.getItem(settingsStorageKey) ?? null)
  } catch {
    current = defaultSettings
  }
  return current
}

/** Points the page's compact styles at the view (see `gaugeViewScript`). */
export function applyGaugeView(view: GaugeView): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  if (view === "compact") root.setAttribute(gaugeViewAttribute, "compact")
  else root.removeAttribute(gaugeViewAttribute)
}

export function setSettings(patch: Partial<Settings>): void {
  current = { ...getSettings(), ...patch }
  if (patch.gaugeView !== undefined) applyGaugeView(patch.gaugeView)
  try {
    storage()?.setItem(settingsStorageKey, JSON.stringify(current))
  } catch {
    // Kept for this tab only.
  }
  for (const listener of listeners) listener()
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Settings as React state. The server always renders the defaults. */
export function useSettings(): Settings {
  return useSyncExternalStore(
    subscribeSettings,
    getSettings,
    () => defaultSettings,
  )
}

/** The RPC reads and simulations use: the custom one, or Matchbox's. */
export function readRpc(matchbox: string): string {
  const network = getSettings().network
  return network.mode === "custom" ? network.rpcUrl : matchbox
}

/** Test helper. */
export function resetSettings(): void {
  current = null
}
