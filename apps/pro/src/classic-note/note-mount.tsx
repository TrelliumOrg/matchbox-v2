import { lazy, type ReactNode, Suspense, useEffect } from "react"
import { useWallet } from "../wallet/wallet-store"
import { noteWalletConnected, useClassicNote } from "./note-store"

const FloatingNote = lazy(() =>
  import("./classic-note").then((module) => ({
    default: module.FloatingNote,
  })),
)

/**
 * In the shell on every page. Records the first wallet connection, which
 * retires the note for good, and mounts the floating card (phones and rail
 * widths) for a visit that shows the note. The note's code loads only then.
 */
export function ClassicNoteMount(): ReactNode {
  const note = useClassicNote()
  const connected = useWallet().account !== null
  useEffect(() => {
    if (connected) noteWalletConnected()
  }, [connected])
  if (note.phase === "off") return null
  return (
    <Suspense fallback={null}>
      <FloatingNote />
    </Suspense>
  )
}
