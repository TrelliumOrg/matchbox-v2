import { Glyph, shapes } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import type { ReactNode } from "react"
import { explorerTxUrl, scanTxUrl } from "./steps"

/**
 * A transaction's links (the success, pending and Activity sheets): "View
 * on Matchscan" as the button, and Mezo Explorer beside it as a smaller
 * link. Both open in a new tab, as Pro's other explorer links do. Matchscan
 * shows a transaction from the moment it is sent.
 */
export function TxLinks({
  hash,
  className,
}: {
  hash: string
  className?: string
}): ReactNode {
  return (
    <p
      className={`flex flex-wrap items-center gap-x-5 gap-y-3 ${className ?? ""}`}
    >
      <PillButton.Root asChild intent="secondary">
        <a href={scanTxUrl(hash)} target="_blank" rel="noreferrer noopener">
          View on Matchscan
          <Glyph shape={shapes.arrowUpRight} size={16} strokeWidth={2.2} />
        </a>
      </PillButton.Root>
      <a
        href={explorerTxUrl(hash)}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 rounded-sm text-[14px] text-sec underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
      >
        Mezo Explorer
        <Glyph shape={shapes.arrowUpRight} size={13} strokeWidth={2.2} />
      </a>
    </p>
  )
}
