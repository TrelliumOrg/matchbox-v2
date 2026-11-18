import type { GaugePicture } from "@matchbox/contracts/read-models"
import { TokenIcon } from "@matchbox/token-icons"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import type { ReactNode } from "react"

/**
 * A gauge's fixed picture: profile image, token pair, or initials. Its own
 * module so the search sheet draws gauges without the answer blocks.
 */

function hueOf(address: string): number {
  const byte = Number.parseInt(address.slice(2, 4), 16)
  return Math.round(((Number.isNaN(byte) ? 0 : byte) * 360) / 256)
}

function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()
    .split(/\s+/)
  const letters = words.map((word) => word[0] ?? "").join("")
  return (letters.slice(0, 2) || "?").toUpperCase()
}

/**
 * Official coins, 18px, overlapping with a ring in the card colour. A plain
 * stack (no popover): an answer's totals carry no text breakdown, and Pro's
 * own coin-stack chunk stays unshared with the panel.
 */
export function CoinRow({
  tickers,
  label,
}: {
  tickers: readonly string[]
  label?: string
}): ReactNode {
  const coins = tickers.map((ticker) => (
    <TokenIcon key={ticker} ticker={ticker} size={18} />
  ))
  if (label === undefined) {
    return (
      <span className="stuart-coins" aria-hidden="true">
        {coins}
      </span>
    )
  }
  return (
    <span className="stuart-coins" role="img" aria-label={label}>
      {coins}
    </span>
  )
}

export function GaugeMark({
  picture,
  address,
  name,
  size = 30,
}: {
  picture: GaugePicture | null
  address: string
  name: string
  size?: number
}): ReactNode {
  if (picture?.type === "pair") {
    return (
      <span className="stuart-pair" style={{ width: size, height: size }}>
        <CoinRow tickers={picture.tokens.map((token) => token.symbol)} />
      </span>
    )
  }
  const shown: GaugeCard.PictureData =
    picture?.type === "image"
      ? { kind: "image", url: picture.url }
      : {
          kind: "initials",
          initials:
            picture?.type === "initials" ? picture.text : initialsOf(name),
          hue: hueOf(address),
        }
  return <GaugeCard.Picture picture={shown} size={size} />
}
