import type { ReactNode } from "react"

/**
 * Under a list the API answered with rows left out (`meta.skipped`: stored
 * rows that failed their schema), so the list never passes for complete.
 * Paged lists say it in their Pager; this is for unpaged ones.
 */
export function SkippedNote({
  skipped,
  what,
}: {
  skipped: number | undefined
  /** The rows, plural: "validators", "tokens". */
  what: string
}): ReactNode {
  if (skipped === undefined || skipped <= 0) return null
  return (
    <p role="status" className="mt-3 text-[14.5px] text-sec">
      {skipped === 1 ? `1 of the ${what} is` : `${skipped} of the ${what} are`}{" "}
      not shown: the data for {skipped === 1 ? "it" : "them"} could not be read.
    </p>
  )
}
