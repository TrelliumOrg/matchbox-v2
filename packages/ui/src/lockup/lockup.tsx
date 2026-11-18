import type { ReactNode, Ref, SVGProps } from "react"
import { Draw, iconWidth, type Part, textStart, unitHeight } from "./draw"
import {
  CLASSIC,
  DEVELOPER,
  ID,
  type LockupGlyph,
  lockupCh,
  MATCH,
  MATCHBOX,
  PRO,
  SCAN,
} from "./glyphs"

/**
 * The Matchbox lockup as one inline SVG: the matchbox icon traced from the
 * official artwork, then the wordmark outlined from Martian Mono 380 at width
 * 112.5, so the font is never downloaded. Geometry follows the Doop snippet
 * (`z2EJi529-k`) with c = height / 1.51, here drawn at c = 100.
 */

export type LockupProduct =
  | "matchbox"
  | "pro"
  | "scan"
  | "id"
  | "developer"
  | "classic"

export type LockupForm = "full" | "short" | "icon"

export type LockupProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  product?: LockupProduct
  /**
   * Full lockup for desktop headers, short form for phones and Developer,
   * icon alone for the tablet icon rail.
   */
  form?: LockupForm
  /** Rendered height in px. 22 in headers, 32+ in marketing, never below 18. */
  height?: number
  /**
   * "fold": the header animation. Shows the full lockup, then folds to the
   * short form once per session; hover or focus on the link unfolds it.
   * The width stays the full lockup's, so nothing moves. Full form only.
   */
  collapse?: "fold"
  ref?: Ref<SVGSVGElement>
}

export const lockupNames: Record<LockupProduct, string> = {
  matchbox: "Matchbox",
  pro: "Matchbox Pro",
  scan: "Matchscan",
  id: "Matchbox ID",
  developer: "Matchbox Developer",
  classic: "Matchbox Classic",
}

const suffix: Record<"pro" | "id" | "developer" | "classic", LockupGlyph> = {
  pro: PRO,
  id: ID,
  developer: DEVELOPER,
  classic: CLASSIC,
}

function parts(product: LockupProduct, form: LockupForm): Part[] {
  if (form === "icon") return []
  if (product === "matchbox") {
    return [{ glyph: MATCHBOX, tone: "ink", gapBefore: false }]
  }
  if (product === "scan") {
    return [
      { glyph: MATCH, tone: "ink", gapBefore: false },
      { glyph: SCAN, tone: form === "full" ? "sec" : "ink", gapBefore: false },
    ]
  }
  if (form === "short") {
    return [{ glyph: suffix[product], tone: "ink", gapBefore: false }]
  }
  return [
    { glyph: MATCHBOX, tone: "ink", gapBefore: false },
    { glyph: suffix[product], tone: "sec", gapBefore: true },
  ]
}

export function lockupWidth(
  product: LockupProduct,
  form: LockupForm,
  height: number,
): number {
  const placed = parts(product, form)
  const units =
    placed.length === 0
      ? iconWidth
      : placed.reduce(
          (x, part) => x + (part.gapBefore ? lockupCh : 0) + part.glyph.width,
          textStart,
        )
  return (units / unitHeight) * height
}

export function Root({
  product = "matchbox",
  form = "full",
  ...props
}: LockupProps): ReactNode {
  return (
    <Draw
      items={parts(product, form)}
      label={lockupNames[product]}
      {...props}
    />
  )
}

Root.displayName = "Lockup"

/**
 * The Matchbox Pro lockup alone. Same drawing as `Root` with
 * `product="pro"`, but it only references the MATCHBOX and PRO glyphs, so
 * the other products' outlines are tree-shaken out of Pro's bundle.
 */
export function Pro({
  form = "full",
  ...props
}: Omit<LockupProps, "product">): ReactNode {
  const items: Part[] =
    form === "icon"
      ? []
      : form === "short"
        ? [{ glyph: PRO, tone: "ink", gapBefore: false }]
        : [
            { glyph: MATCHBOX, tone: "ink", gapBefore: false },
            { glyph: PRO, tone: "sec", gapBefore: true },
          ]
  return <Draw items={items} label={lockupNames.pro} {...props} />
}

Pro.displayName = "Lockup.Pro"
