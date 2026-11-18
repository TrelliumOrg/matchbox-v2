import type { ReactNode } from "react"
import { cleanUntrusted } from "./untrusted"

/**
 * Renders a chain-supplied string safely: inside a `<bdi>` (its direction is
 * isolated, so it cannot reorder the text around it), with bidi, control
 * and invisible characters shown as escapes, cut to `limit` characters with
 * an ellipsis. Every token name, label, method name and decoded value in
 * Matchscan goes through this.
 */
export function Root({
  value,
  limit = 200,
  className,
}: {
  value: string
  limit?: number
  className?: string
}): ReactNode {
  const { segments, truncated } = cleanUntrusted(value, limit)
  return (
    <bdi className={`[unicode-bidi:isolate] ${className ?? ""}`}>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          // Segments are positional: the same text can repeat.
          // biome-ignore lint/suspicious/noArrayIndexKey: order is the key
          <span key={index}>{segment.text}</span>
        ) : (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: order is the key
            key={index}
            title={`Hidden character ${segment.code}`}
            className="mx-px rounded-sm bg-soft2 px-0.5 font-mono text-[0.8em] text-sec"
          >
            {segment.code}
          </span>
        ),
      )}
      {truncated ? "…" : null}
    </bdi>
  )
}

Root.displayName = "UntrustedText.Root"
