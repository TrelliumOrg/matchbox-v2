import type { ReactNode } from "react"
import type { Section } from "../../data/explorer"
import type { SigningNote as SigningNoteData } from "../../data/uptime"

/**
 * The blocks page's header line (`YY3BAmH_lR`): how many validators signed
 * the newest block counted, "20 of 21 signing", and where that came from
 * (CometBFT commit signatures read from a community node) and how fresh
 * it is. While uptime is paused it says so instead of a count. A failed
 * read shows nothing: the blocks list stands on its own.
 */
export function SigningNote({
  note,
}: {
  note: Section<SigningNoteData>
}): ReactNode {
  if (note.status !== "ok") return null
  const { signing, freshness } = note.data
  return (
    <p
      role={freshness.live ? undefined : "status"}
      className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[15px]"
    >
      {signing === null ? null : (
        <span className="font-semibold tabular-nums">{signing}</span>
      )}
      <span className={freshness.live ? "text-sec" : "font-semibold text-ink2"}>
        {freshness.line}
      </span>
    </p>
  )
}
