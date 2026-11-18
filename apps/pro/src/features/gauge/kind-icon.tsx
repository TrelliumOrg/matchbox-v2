import { Tip } from "@matchbox/ui/floating"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import type { ReactNode } from "react"
import type { GaugeKind } from "../../data/view-models"
import { gaugeKinds } from "./kinds"

/** Each gauge type's icon: lock, globe, server, droplets. */
export const kindShape: Record<GaugeKind, GlyphShape> = {
  vebtc: shapes.lock,
  mezo: shapes.globe,
  validator: shapes.server,
  pool: shapes.droplets,
}

/**
 * A gauge's type as an icon with its tooltip ("veBTC gauge"), on cards,
 * ballot rows, rewards rows and the profile. Only the four type shapes, so
 * it never pulls the other property icons into a route.
 */
export function KindIcon({
  kind,
  size = 16,
}: {
  kind: GaugeKind
  size?: 14 | 16 | 18
}): ReactNode {
  const label = gaugeKinds[kind].singular
  return (
    <Tip
      content={label}
      trigger={(tip) => (
        <span
          role="img"
          aria-label={label}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need the tooltip
          tabIndex={0}
          className="inline-grid flex-none cursor-default place-items-center rounded-sm text-sec outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          {...tip}
        >
          <Glyph shape={kindShape[kind]} size={size} strokeWidth={1.75} />
        </span>
      )}
    />
  )
}
