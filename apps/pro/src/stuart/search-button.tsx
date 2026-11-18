import { openStuartSearch, warmStuart } from "@matchbox/stuart-ui/launcher"
import type { ReactNode } from "react"

/**
 * Phones (matchbox-v3 Layout): the top bar's search icon opens Stuart's
 * search sheet. 40px, the bar is hidden below 768px. Place it in the top
 * bar between the price slot and the avatar.
 */
export function StuartSearchButton({
  className = "",
}: {
  className?: string
}): ReactNode {
  return (
    <button
      type="button"
      aria-label="Ask Stuart or search"
      onClick={openStuartSearch}
      onTouchStart={warmStuart}
      data-tap=""
      className={`grid size-10 flex-none place-items-center rounded-full text-ink2 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink md:hidden ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    </button>
  )
}
