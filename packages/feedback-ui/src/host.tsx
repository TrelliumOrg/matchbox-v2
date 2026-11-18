import type { FeedbackKind } from "@matchbox/contracts/feedback"
import { createRoot, type Root } from "react-dom/client"
import type { FeedbackOptions } from "./entry"
import { FeedbackPanel } from "./panel"
import { openPanel } from "./store"

/**
 * The panel's chunk: loaded on the first hover, focus or tap of an entry.
 * The panel renders in its own root at the end of <body>, outside the
 * host app's tree, so any entry (a sidebar row, a footer link, later a
 * command or an error toast) opens the same panel and the screenshot can
 * leave it out by one container.
 */

let root: Root | null = null

export function showFeedback(
  options: FeedbackOptions & { kind?: FeedbackKind },
): void {
  if (root === null) {
    const container = document.createElement("div")
    container.setAttribute("data-feedback-root", "")
    document.body.appendChild(container)
    root = createRoot(container)
    root.render(<FeedbackPanel container={container} />)
  }
  openPanel(options)
}
