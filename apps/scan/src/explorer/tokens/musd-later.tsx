import { type ReactNode, useEffect, useState } from "react"
import { getMusdLater, type MusdLater } from "../../data/token-pages"
import { Panel, PanelState } from "../voting/parts"
import type { PeriodView } from "../voting/range"
import { SeriesBody } from "../voting/series-panel"
import { SplitView } from "./split-panel"

/**
 * MUSD's savings vault, MUSD borrowed and repaid per day, MUSD in DEX
 * pools and where MUSD sits (each pool's share included), read once the
 * page has painted (`musdLater`): their reads would take the page's
 * loader past its budget. Until they answer nothing is drawn; a failed
 * read says so.
 */
export function MusdLaterPanels({
  period,
  toggle,
}: {
  period: PeriodView
  toggle: ReactNode
}): ReactNode {
  // The period as asked again: a range, or the span the server settled on.
  const { range, from, to } = period
  const [later, setLater] = useState<MusdLater | "failed" | null>(null)
  useEffect(() => {
    let live = true
    setLater(null)
    getMusdLater({
      data: range === null ? { range: "30d", from, to } : { range },
    }).then(
      (data) => {
        if (live) setLater(data)
      },
      () => {
        if (live) setLater("failed")
      },
    )
    return () => {
      live = false
    }
  }, [range, from, to])
  if (later === null) return null
  if (later === "failed") {
    return (
      <Panel label="Savings vault and where MUSD sits">
        <PanelState section={{ status: "unavailable" }} />
      </Panel>
    )
  }
  return (
    <>
      {later.panels.map((panel) => (
        <Panel key={panel.id} label={panel.label} aside={toggle}>
          {panel.data.status !== "ok" ? (
            <PanelState section={panel.data} />
          ) : (
            <SeriesBody
              name={panel.label}
              data={panel.data.data}
              stats={panel.stats}
              empty={panel.empty}
            />
          )}
        </Panel>
      ))}
      {later.splits.map((split) => (
        <SplitView key={split.id} split={split} />
      ))}
    </>
  )
}
