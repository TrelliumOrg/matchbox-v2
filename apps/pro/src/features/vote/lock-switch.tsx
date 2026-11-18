import { TokenIcon } from "@matchbox/token-icons"
import type { ReactNode } from "react"
import type { Lock } from "../../data/view-models"

/**
 * Which lock the ballot votes with, under the Vote title: the lock's coin
 * and id, or one radio per lock when the wallet has several (veMEZO votes
 * boost and MEZO gauges, veBTC votes validators and pools).
 */
export function LockSwitch({
  locks,
  lock,
  onLock,
}: {
  locks: readonly Lock[]
  lock: Lock
  onLock: (tokenId: string) => void
}): ReactNode {
  if (locks.length < 2) {
    return (
      <>
        <TokenIcon ticker={lock.kind === "vebtc" ? "BTC" : "MEZO"} size={18} />#
        {lock.tokenId}
      </>
    )
  }
  return (
    <span
      role="radiogroup"
      aria-label="Vote with"
      className="flex flex-wrap gap-3"
    >
      {locks.map((candidate) => {
        const active = candidate.tokenId === lock.tokenId
        return (
          // biome-ignore lint/a11y/useSemanticElements: a compact lock switch, one radio per lock
          <button
            key={`${candidate.kind}-${candidate.tokenId}`}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onLock(candidate.tokenId)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ink ${active ? "font-semibold text-ink" : "text-sec hover:text-ink2"}`}
          >
            <TokenIcon
              ticker={candidate.kind === "vebtc" ? "BTC" : "MEZO"}
              size={18}
            />
            #{candidate.tokenId}
          </button>
        )
      })}
    </span>
  )
}
