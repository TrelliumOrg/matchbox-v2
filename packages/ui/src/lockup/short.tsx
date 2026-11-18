import type { ReactNode } from "react"
import { Draw, type Part } from "./draw"
import { PRO } from "./glyph-pro"
import type { LockupProps } from "./lockup"

/**
 * Pro's lockup where it is never drawn in full: the mark alone, or the
 * mark and "PRO". It does not reference the MATCHBOX outline (2.3 kB of
 * path data that barely compresses), so a screen that only shows these two
 * forms does not ship it. Pro's phone top bar is one: it is in the first
 * paint of every route.
 */
export function ProShort({
  form = "short",
  ...props
}: Omit<LockupProps, "product" | "form"> & {
  form?: "short" | "icon"
}): ReactNode {
  const items: Part[] =
    form === "icon" ? [] : [{ glyph: PRO, tone: "ink", gapBefore: false }]
  return <Draw items={items} label={"Matchbox Pro"} {...props} />
}

ProShort.displayName = "Lockup.ProShort"
