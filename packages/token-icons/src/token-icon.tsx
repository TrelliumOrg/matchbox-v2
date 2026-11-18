import { type CSSProperties, type ReactNode, type Ref, useState } from "react"
import { bundledTokenIcon } from "./registry"

export type TokenIconProps = {
  /** Shown as alt text and used for the bundled icon and the fallback. */
  ticker: string
  /** Explicit image, for example a Blockscout `icon_url` from a snapshot. */
  src?: string | null
  /** Diameter in px. The guideline uses 18, 22, 26, 28 and 48. */
  size?: number
  className?: string
  style?: CSSProperties
  ref?: Ref<HTMLElement>
}

const displayName = "TokenIcon"

/**
 * An official token coin, or a soft2 circle with the ticker's first letter
 * when Mezo has no art for it (or the image fails to load).
 */
export function TokenIcon({
  ticker,
  src,
  size = 24,
  className,
  style,
  ref,
}: TokenIconProps): ReactNode {
  const resolved = src ?? bundledTokenIcon(ticker)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = resolved !== null && failedSrc === resolved

  const box: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flex: "none",
    display: "block",
    ...style,
  }

  if (resolved === null || failed) {
    return (
      <span
        ref={ref}
        role="img"
        aria-label={ticker}
        className={className}
        data-token-fallback=""
        style={{
          ...box,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--soft2)",
          color: "var(--ink2)",
          fontSize: Math.max(9, Math.round(size * 0.45)),
          fontWeight: 650,
          lineHeight: 1,
        }}
      >
        <span aria-hidden="true">{firstLetter(ticker)}</span>
      </span>
    )
  }

  return (
    <img
      ref={ref as Ref<HTMLImageElement>}
      src={resolved}
      alt={ticker}
      width={size}
      height={size}
      decoding="async"
      className={className}
      style={box}
      onError={() => setFailedSrc(resolved)}
    />
  )
}

TokenIcon.displayName = displayName

function firstLetter(ticker: string): string {
  const letter = ticker.replace(/^[^A-Za-z0-9]+/, "").charAt(0)
  return letter === "" ? "?" : letter.toUpperCase()
}
