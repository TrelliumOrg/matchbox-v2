import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ActivityEvent, ActivityPage } from "../../data/view-models"
import { activitySample } from "../samples"
import { ActivityView, mergeEvents } from "./activity-view"

vi.mock("../../lib/viewer", () => ({
  useViewer: () => ({ kind: "viewing", address: activitySample.address }),
}))

afterEach(cleanup)

const [first, second, third] = activitySample.events
if (first === undefined || second === undefined || third === undefined) {
  throw new Error("the sample needs three events")
}

function page(
  events: ActivityEvent[],
  nextCursor: string | null,
): ActivityPage {
  return { ...activitySample, events, nextCursor }
}

const today = first.at

describe("mergeEvents", () => {
  it("appends later pages and keeps a row once, where it first appears", () => {
    expect(mergeEvents([first, second], [third]).map((e) => e.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ])
    // The live first page grew: its last row is also the next page's first.
    expect(
      mergeEvents([first, second], [second, third]).map((e) => e.id),
    ).toEqual([first.id, second.id, third.id])
    expect(mergeEvents([], [])).toEqual([])
  })
})

describe("ActivityView paging", () => {
  it("offers no Load more on a single page", () => {
    render(
      <ActivityView
        data={page([first], null)}
        filter="all"
        today={today}
        onFilter={() => {}}
        loadMore={async () => page([], null)}
      />,
    )
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
  })

  it("loads the next page from the cursor until there is none", async () => {
    const loadMore = vi.fn(async (cursor: string) =>
      cursor === first.id ? page([second], second.id) : page([third], null),
    )
    render(
      <ActivityView
        data={page([first], first.id)}
        filter="all"
        today={today}
        onFilter={() => {}}
        loadMore={loadMore}
      />,
    )
    expect(document.querySelectorAll("li")).toHaveLength(1)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    })
    expect(loadMore).toHaveBeenLastCalledWith(first.id)
    expect(document.querySelectorAll("li")).toHaveLength(2)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    })
    expect(loadMore).toHaveBeenLastCalledWith(second.id)
    expect(document.querySelectorAll("li")).toHaveLength(3)
    // The last page: nothing more to ask for.
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
  })

  it("keeps what is loaded and offers Try again when a page fails", async () => {
    let fail = true
    const loadMore = vi.fn(async () => {
      if (fail) throw new Error("offline")
      return page([second], null)
    })
    render(
      <ActivityView
        data={page([first], first.id)}
        filter="all"
        today={today}
        onFilter={() => {}}
        loadMore={loadMore}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    })
    expect(document.querySelectorAll("li")).toHaveLength(1)
    fail = false
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    })
    expect(document.querySelectorAll("li")).toHaveLength(2)
  })

  it("starts over for another filter", async () => {
    const loadMore = vi.fn(async () => page([second], null))
    const view = render(
      <ActivityView
        data={page([first], first.id)}
        filter="all"
        today={today}
        onFilter={() => {}}
        loadMore={loadMore}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    })
    expect(document.querySelectorAll("li")).toHaveLength(2)
    view.rerender(
      <ActivityView
        data={page([third], null)}
        filter="votes"
        today={today}
        onFilter={() => {}}
        loadMore={loadMore}
      />,
    )
    expect(document.querySelectorAll("li")).toHaveLength(1)
  })
})
