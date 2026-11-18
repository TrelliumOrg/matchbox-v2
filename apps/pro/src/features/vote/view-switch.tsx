import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import type { ReactNode } from "react"
import {
  type GaugeView,
  setSettings,
  useSettings,
} from "../../settings/settings-store"

/**
 * Cards or rows for Vote's gauge list, remembered in this browser (the
 * settings store). The list itself reads the choice from <html> (see
 * `gaugeViewScript`), so only these two buttons wait for hydration.
 */

const views: { view: GaugeView; label: string; icon: GlyphShape }[] = [
  { view: "comfortable", label: "Comfortable", icon: shapes.layoutGrid },
  { view: "compact", label: "Compact", icon: shapes.rows3 },
]

export function ViewSwitch(): ReactNode {
  const { gaugeView } = useSettings()
  return (
    <fieldset className="m-0 flex h-10 min-w-0 flex-none items-center gap-0.5 rounded-[20px] border-0 bg-soft p-1">
      <legend className="sr-only">Gauge view</legend>
      {views.map(({ view, label, icon }) => (
        <button
          key={view}
          type="button"
          aria-pressed={gaugeView === view}
          aria-label={`${label} view`}
          title={label}
          onClick={() => setSettings({ gaugeView: view })}
          className="grid size-8 cursor-pointer place-items-center rounded-full text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink aria-pressed:bg-raised aria-pressed:text-ink aria-pressed:shadow-lift"
        >
          <Glyph shape={icon} size={17} strokeWidth={2} />
        </button>
      ))}
    </fieldset>
  )
}
