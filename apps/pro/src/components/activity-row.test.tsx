import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { groupByDay } from "../features/activity/activity-view"
import { activitySample } from "../features/samples"
import { ActivityRow, describeEvent } from "./activity-row"

const activity = activitySample.events

function byKind(kind: string, index = 0) {
  const event = activity.filter((entry) => entry.detail.kind === kind)[index]
  if (event === undefined) throw new Error(`no ${kind} event`)
  return event
}

describe("activity rows", () => {
  it("words each event the way the frames do", () => {
    const vote = describeEvent(byKind("vote"), "summary")
    expect(vote.title).toMatch(/^Voted? with #\d+$/)
    expect(vote.main).toMatch(/votes$|veBTC$/)
    const claim = describeEvent(byKind("claim"), "dated")
    expect(claim).toMatchObject({
      title: "Claimed rewards",
      mainTone: "positive",
    })
    expect(claim.main).toMatch(/^\+\$[\d,]+\.\d\d$/)
    expect(claim.subline).toMatch(/^Epoch \d+, \d\d:\d\d$/)
    expect(describeEvent(byKind("lock"), "summary")).toMatchObject({
      title: "Added to #2207",
      main: "+6,000.00 MEZO",
    })
    expect(describeEvent(byKind("incentive"), "dated").title).toMatch(
      /^Incentive to /,
    )
  })

  it("reads an auto-max lock as Auto max, never as a 1970 date", () => {
    const lock = byKind("lock")
    if (lock.detail.kind !== "lock") throw new Error("not a lock event")
    const autoMax = describeEvent(
      { ...lock, detail: { ...lock.detail, unlocksAt: 0 } },
      "dated",
    )
    expect(autoMax.sub).toBe("Auto max")
    const dated = describeEvent(
      { ...lock, detail: { ...lock.detail, unlocksAt: 1_800_000_000 } },
      "dated",
    )
    expect(dated.sub).toMatch(/^Unlocks \d/)
    expect(dated.sub).not.toContain("1970")
    expect(
      describeEvent(
        { ...lock, detail: { ...lock.detail, unlocksAt: null } },
        "dated",
      ).sub,
    ).toBeNull()
  })

  it("opens the transaction from the title button", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(
      <ul>
        <ActivityRow event={byKind("claim")} context="dated" onOpen={onOpen} />
      </ul>,
    )
    await user.click(screen.getByRole("button", { name: "Claimed rewards" }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Claimed tokens" })).toBeTruthy()
  })

  it("groups by UTC day with Today first", () => {
    const today = Date.UTC(2026, 10, 8, 11, 53) / 1000
    const groups = groupByDay(activity, today)
    expect(groups.map((group) => group.heading).slice(0, 4)).toEqual([
      "Today",
      "Thursday 5 Nov",
      "Monday 2 Nov",
      "Sunday 1 Nov",
    ])
    expect(groups.reduce((sum, group) => sum + group.events.length, 0)).toBe(
      activity.length,
    )
  })
})
