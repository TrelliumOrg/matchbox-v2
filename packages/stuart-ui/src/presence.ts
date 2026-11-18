import { useEffect, useState } from "react"

/**
 * Keeps a surface mounted while its exit plays, so exits mirror entries
 * (matchbox-v3 Motion): `open` true mounts it with state "open"; false
 * flips it to "closed" (the stylesheet runs the reverse animation) and
 * unmounts after `exitMs`. No timer runs while nothing changes.
 */
export function usePresence(
  open: boolean,
  exitMs: number,
): { mounted: boolean; state: "open" | "closed" } {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(timer)
  }, [open, exitMs])
  return { mounted: open || mounted, state: open ? "open" : "closed" }
}
