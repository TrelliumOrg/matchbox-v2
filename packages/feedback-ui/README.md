# @matchbox/feedback-ui

The in-product feedback widget for the Matchbox v2 surfaces: the Feedback
entry, the panel, its states and the optional screenshot. Reports go to the
`matchbox-feedback` Worker ([apps/feedback](../../apps/feedback)). Tests
need nothing: `pnpm --filter @matchbox/feedback-ui test`. To try the widget
end to end, run the feedback Worker locally ("Try it locally" in its
README) and point Pro at it.

## Mounting

Only `@matchbox/feedback-ui/entry` is imported by a page. Gate it on the
build-time URL so a build without it carries none of the code:

```tsx
import { FeedbackEntry } from "@matchbox/feedback-ui/entry";

const feedbackUrl: unknown = import.meta.env.VITE_FEEDBACK_URL;

{
  feedbackUrl ? (
    <FeedbackEntry endpoint={feedbackUrl} surface="scan" className="…">
      <Glyph shape={shapes.messageSquare} size={16} />
      Feedback
    </FeedbackEntry>
  ) : null;
}
```

The entry is a plain `<button>` styled by the host, so it sits in each
product's own secondary links. The panel, Turnstile and its stylesheet load
on the first hover, focus or tap; `modern-screenshot` loads on the first
"Take screenshot". `openFeedback(options)` opens the same panel from any
other place (a Ctrl K command, "Report a problem" on an error with
`kind: "bug"`).

Options, read when the panel opens:

- `wallet`: the connected wallet (`{ address, chainId }`) or null. The
  address is only sent if the user ticks the box that shows it.
- `screenshotBlocked`: a one-line reason screenshots are not offered right
  now (Pro passes "A signing review is open" while a transaction sheet is
  open), or null.

## Page markers

- `data-feedback="no-capture"` on any element: no screenshot while it is in
  the page; `data-feedback-reason` gives the one line the panel shows.
- `data-feedback="mask"`: blacked out in screenshots, like every input,
  textarea, select and contenteditable.

## Content Security Policy

A page with a strict CSP must allow the Worker's origin and
`https://challenges.cloudflare.com` in `connect-src`, and Turnstile's
`https://challenges.cloudflare.com` in `frame-src`. Scripts load through
the page's nonce and `'strict-dynamic'`. The thumbnail is a `data:` URL.

## Tests

`pnpm --filter @matchbox/feedback-ui test`: the state machine, query
stripping and the context, the client, and the panel's accessibility
(labelled fields, Escape, focus, the wallet box, blocked screenshots) with
a full send against a faked Worker and Turnstile.
