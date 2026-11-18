import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"
import { whenIdle } from "./idle"

/**
 * Phone haptics, from the guideline's Build notes. Sharp ticks, never buzzes,
 * always at full intensity (lower intensities are split into 20ms slices that
 * phone motors ignore). Only call these inside a user gesture: never on page
 * load, scroll or timers.
 */

export type HapticName = "pick" | "success" | "error" | "nudge"

export const hapticPatterns = {
  /** Gauge pick or unpick. */
  pick: [8],
  /** Vote or claim signed. */
  success: [10, 70, 14],
  /** Signature rejected or transaction failed. */
  error: [12, 45, 12, 45, 12],
  /** Optimize applied. */
  nudge: [14, 55, 8],
} as const satisfies Record<HapticName, readonly number[]>

export const hapticOptions = { intensity: 1 } as const

export const hapticsStorageKey = "mbx-haptics"

type ReadableStorage = Pick<Storage, "getItem">

type WritableStorage = Pick<Storage, "setItem">

/** The Haptics setting. Defaults to on; only an explicit "off" turns it off. */
export function readHapticsSetting(storage: ReadableStorage | null): boolean {
  if (storage === null) return true
  try {
    return storage.getItem(hapticsStorageKey) !== "off"
  } catch {
    return true
  }
}

export function writeHapticsSetting(
  storage: WritableStorage,
  enabled: boolean,
): boolean {
  try {
    storage.setItem(hapticsStorageKey, enabled ? "on" : "off")
    return true
  } catch {
    return false
  }
}

const listeners = new Set<() => void>()

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  function onStorage(event: StorageEvent): void {
    if (event.key === hapticsStorageKey) onChange()
  }
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage)
  }
  return () => {
    listeners.delete(onChange)
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage)
    }
  }
}

function getSnapshot(): boolean {
  return readHapticsSetting(browserStorage())
}

function getServerSnapshot(): boolean {
  return true
}

/** Sets the Haptics setting for this device and notifies every subscriber. */
export function setHapticsSetting(enabled: boolean): void {
  const storage = browserStorage()
  if (storage !== null) writeHapticsSetting(storage, enabled)
  for (const listener of listeners) listener()
}

/**
 * The Haptics switch: on by default, stored on the device, synced across tabs.
 * Independent of reduced motion, which is about visual motion.
 */
export function useHapticsSetting(): readonly [
  boolean,
  (enabled: boolean) => void,
] {
  const enabled = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )
  return [enabled, setHapticsSetting] as const
}

export type Haptics = {
  [K in HapticName]: () => void
} & {
  enabled: boolean
  supported: boolean
}

type Engine = {
  trigger: (pattern: number[], options: typeof hapticOptions) => Promise<void>
  supported: boolean
}

let engine: Engine | null = null
let loadingEngine: Promise<Engine> | null = null
const engineListeners = new Set<() => void>()

/**
 * Loads web-haptics. useHaptics calls this when the page is idle, so the
 * engine is ready before the first tap without weighing on first paint.
 */
export function preloadHaptics(): Promise<Engine> {
  loadingEngine ??= import("web-haptics").then(({ WebHaptics }) => {
    const instance = new WebHaptics()
    engine = {
      trigger: (pattern, options) => instance.trigger(pattern, options),
      supported: WebHaptics.isSupported,
    }
    for (const listener of engineListeners) listener()
    return engine
  })
  return loadingEngine
}

function subscribeEngine(listener: () => void): () => void {
  engineListeners.add(listener)
  return () => engineListeners.delete(listener)
}

/**
 * Gated haptic triggers. Each fires its pattern at intensity 1 when on. A
 * tap before the engine has loaded (the first second or so) has no tick.
 */
export function useHaptics(): Haptics {
  const [enabled] = useHapticsSetting()
  const loaded = useSyncExternalStore(
    subscribeEngine,
    () => engine,
    () => null,
  )

  useEffect(() => whenIdle(() => void preloadHaptics()), [])

  const fire = useCallback(
    (name: HapticName) => {
      if (!enabled || loaded === null) return
      void loaded.trigger([...hapticPatterns[name]], hapticOptions)
    },
    [enabled, loaded],
  )

  return useMemo(
    () => ({
      pick: () => fire("pick"),
      success: () => fire("success"),
      error: () => fire("error"),
      nudge: () => fire("nudge"),
      enabled,
      supported: loaded?.supported ?? false,
    }),
    [fire, enabled, loaded],
  )
}

/**
 * Fires a pattern outside React (in a gesture handler), honouring the
 * Haptics setting. Does nothing until `preloadHaptics` has resolved.
 */
export function fireHaptic(name: HapticName): void {
  if (engine === null || !readHapticsSetting(browserStorage())) return
  void engine.trigger([...hapticPatterns[name]], hapticOptions)
}
