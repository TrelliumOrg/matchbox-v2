import * as DocsLockup from "@matchbox/ui/docs-lockup"
import type { LockupProduct } from "@matchbox/ui/lockup"
import type { CSSProperties, ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { lockupImage, svgUri } from "./assets"
import { bg, ink, line, mezo, mut, sec } from "./palette"
import { cardSize } from "./render"

/**
 * The static link preview card a site without live figures shares: the
 * brand card of Matchbox Pro's (apps/pro/src/og/cards.tsx) with another
 * product's lockup. Graphite ground, the 10px
 * Matchbox pink stripe, the lockup, a label, the headline, a rule and the
 * host in DM Mono. Satori lays out with flexbox only, so every box with
 * more than one child is `display: flex`.
 */

export type SiteCardProduct = LockupProduct | "docs"

export type SiteCard = {
  product: SiteCardProduct
  /** Above the headline, in secondary ("Mezo explorer"). */
  label: string
  /** The site's own heading ("Explore Mezo"). */
  headline: string
  /** Bottom right, as the address bar shows it ("scan.matchbox.markets"). */
  host: string
}

/** Figtree 650, the house figure weight, registered with Satori as 600. */
const semibold = 600

const lockupHeight = 34

type Image = { uri: string; width: number; height: number; alt: string }

/** MATCHBOX DOCS, drawn as `lockupImage` draws the other products. */
function docsLockupImage(): Image {
  const markup = renderToStaticMarkup(
    <DocsLockup.Root
      height={lockupHeight}
      xmlns="http://www.w3.org/2000/svg"
    />,
  )
    .replaceAll("var(--sec)", sec)
    .replace(/ style="[^"]*"/, "")
    .replace('fill="currentColor"', `fill="${ink}"`)
  return {
    uri: svgUri(markup),
    width: DocsLockup.width("full", lockupHeight),
    height: lockupHeight,
    alt: "Matchbox Docs",
  }
}

const altNames: Record<LockupProduct, string> = {
  matchbox: "Matchbox",
  pro: "Matchbox Pro",
  scan: "Matchscan",
  id: "Matchbox ID",
  developer: "Matchbox Developer",
  classic: "Matchbox Classic",
}

function lockupFor(product: SiteCardProduct): Image {
  if (product === "docs") return docsLockupImage()
  return { ...lockupImage(product), alt: altNames[product] }
}

const headlineStyle: CSSProperties = {
  fontWeight: semibold,
  letterSpacing: "-0.025em",
  lineHeight: 1.05,
  color: ink,
  marginTop: 10,
}

export function SiteCardView({ card }: { card: SiteCard }): ReactNode {
  const lockup = lockupFor(card.product)
  // One line at 104px fits about 17 characters in the 1056px column.
  const fontSize = card.headline.length <= 17 ? 104 : 88
  return (
    <div
      style={{
        width: cardSize.width,
        height: cardSize.height,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        padding: "64px 72px",
        backgroundColor: bg,
        color: ink,
        fontFamily: "Figtree",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 10,
          backgroundColor: mezo,
        }}
      />
      <div style={{ display: "flex" }}>
        <img
          src={lockup.uri}
          width={lockup.width}
          height={lockup.height}
          alt={lockup.alt}
        />
      </div>
      <div
        style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}
      >
        <span style={{ fontSize: 24, color: sec, fontWeight: 400 }}>
          {card.label}
        </span>
        <span style={{ ...headlineStyle, fontSize }}>{card.headline}</span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: 44,
          paddingTop: 28,
          borderTop: `2px solid ${line}`,
        }}
      >
        <span style={{ fontFamily: "DM Mono", fontSize: 22, color: mut }}>
          {card.host}
        </span>
      </div>
    </div>
  )
}
