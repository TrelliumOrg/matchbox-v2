import type { ReactNode } from "react"
import type { SplitPanel } from "../../data/token-pages"
import { Figure, Panel, ShareBar, Stats } from "../voting/parts"

/** A whole split into its parts now (where MUSD sits, MEZO's supply). */
export function SplitView({ split }: { split: SplitPanel }): ReactNode {
  return (
    <Panel
      label={split.label}
      aside={
        split.aside === null ? null : (
          <span className="text-[14px] font-semibold">{split.aside}</span>
        )
      }
    >
      <Figure
        value={split.figure}
        {...(split.note === null ? {} : { note: split.note })}
      />
      <ShareBar label={split.label} segments={split.segments} />
      {split.mismatch === null ? null : (
        <p className="mt-3 text-[14px] text-sec">{split.mismatch}</p>
      )}
      <Stats stats={split.stats} />
    </Panel>
  )
}
