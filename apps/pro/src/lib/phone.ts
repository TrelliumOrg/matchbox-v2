import { useSyncExternalStore } from "react"

/** Below 768px: the phone layout (the md breakpoint). */
const phoneQuery = "(width < 48rem)"

function subscribePhone(onChange: () => void): () => void {
  const media = window.matchMedia(phoneQuery)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

/** True on phones. The server renders the wide layout (false). */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(phoneQuery).matches,
    () => false,
  )
}
