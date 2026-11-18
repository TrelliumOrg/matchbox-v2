import { CopyStatus, useCopy } from "@matchbox/ui/copy"
import * as PillButton from "@matchbox/ui/pill-button"
import type { ReactNode } from "react"

/**
 * In place of the Google button inside an app's built-in browser, where
 * Google refuses to sign in: a plain line and the page's link to copy into
 * the phone's own browser. No window.open: a wallet's browser opens it in
 * itself. If the clipboard is refused the link shows, selectable.
 */
export function EmbeddedBrowserNotice(): ReactNode {
  const href = window.location.href
  const { state, copy } = useCopy(href)
  return (
    <div className="flex flex-col items-center gap-4 rounded-[20px] bg-soft px-5 py-5 text-center">
      <p className="text-[15px] leading-[1.45] text-ink">
        Google sign-in does not work in this app's browser. Copy the link and
        open it in your phone's browser.
      </p>
      <PillButton.Root intent="neutral" onClick={() => void copy()}>
        {state === "copied" ? "Link copied" : "Copy link"}
      </PillButton.Root>
      {state === "failed" ? (
        <input
          readOnly
          aria-label="Link to this page"
          value={href}
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 w-full rounded-[14px] bg-raised px-3 font-mono text-[16px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink"
        />
      ) : null}
      <CopyStatus state={state} />
    </div>
  )
}
