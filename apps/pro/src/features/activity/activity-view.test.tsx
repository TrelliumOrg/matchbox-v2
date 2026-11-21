import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ActivityEvent, ActivityPage } from "../../data/view-models"
import { activitySample } from "../samples"
import { ActivityView, mergeEvents } from "./activity-view"

vi.mock("../../lib/viewer", () => ({
  useViewer: () => ({ kind: "viewing", address: activitySample.address }),
  useViewingOther: () => false,
}))

afterEach(cleanup)

const [first, second, third] = activitySample.events
if (first === undefined || second === undefined || third === undefined) {
  throw new Error("the sample needs three events")
}

function page(
  events: ActivityEvent[],
  nextCursor: string | null,
  pending = false,
): ActivityPage {
  return { ...activitySample, events, nextCursor, pending }
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
  it("offers no earlier epochs on a single page", () => {
    render(
      <ActivityView
        data={page([first], null)}
        filter="all"
        today={today}
        onFilter={() => {}}
        loadMore={async () => page([], null)}
      />,
    )
    expect(
      screen.queryByRole("button", { name: "Show earlier epochs" }),
    ).toBeNull()
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
      fireEvent.click(
        screen.getByRole("button", { name: "Show earlier epochs" }),
      )
    })
    expect(loadMore).toHaveBeenLastCalledWith(first.id)
    expect(document.querySelectorAll("li")).toHaveLength(2)
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Show earlier epochs" }),
      )
    })
    expect(loadMore).toHaveBeenLastCalledWith(second.id)
    expect(document.querySelectorAll("li")).toHaveLength(3)
    // The last page: nothing more to ask for.
    expect(
      screen.queryByRole("button", { name: "Show earlier epochs" }),
    ).toBeNull()
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
      fireEvent.click(
        screen.getByRole("button", { name: "Show earlier epochs" }),
      )
    })
    expect(document.querySelectorAll("li")).toHaveLength(1)
    expect(screen.getByRole("alert").textContent).toBe("Not loaded")
    fail = false
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    })
    expect(document.querySelectorAll("li")).toHaveLength(2)
  })

  it("says which epochs are still being added", async () => {
    const loadMore = vi.fn(async () => page([second], null, true))
    render(
      <ActivityView
        data={page([first], first.id)}
        filter="all"
        today={today}
        onFilter={() => {}}
        loadMore={loadMore}
      />,
    )
    expect(screen.queryByText(/still being added/)).toBeNull()
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Show earlier epochs" }),
      )
    })
    const from = Math.min(first.epoch, second.epoch)
    expect(
      screen.getByText(`Epoch ${from} and earlier are still being added`),
    ).toBeTruthy()
    expect(screen.getByText("Check back in a few days")).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Show earlier epochs" }),
    ).toBeNull()
  })

  it("promises nothing when the last page is not pending", async () => {
    const loadMore = vi.fn(async () => page([second], null, false))
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
      fireEvent.click(
        screen.getByRole("button", { name: "Show earlier epochs" }),
      )
    })
    expect(screen.queryByText(/still being added/)).toBeNull()
    expect(screen.queryByText("Check back in a few days")).toBeNull()
    expect(document.querySelector("[data-epoch-span]")?.textContent).not.toBe(
      "",
    )
  })

  it("moves focus to the range line when the last page takes the button", async () => {
    const loadMore = vi.fn(async () => page([second], null))
    render(
      <ActivityView
        data={page([first], first.id)}
        filter="all"
        today={today}
        onFilter={() => {}}
        loadMore={loadMore}
      />,
    )
    const button = screen.getByRole("button", { name: "Show earlier epochs" })
    button.focus()
    await act(async () => {
      fireEvent.click(button)
    })
    const range = document.querySelector("[data-epoch-span]")?.parentElement
    expect(range).toBeTruthy()
    expect(document.activeElement).toBe(range)
    // The live region says how many rows arrived.
    expect(range?.textContent).toContain("1 row added")
  })

  it("names the epochs the loaded pages cover", async () => {
    const older = { ...third, id: "older", epoch: first.epoch - 9 }
    const loadMore = vi.fn(async () => page([older], null))
    render(
      <ActivityView
        data={page([first], first.id)}
        filter="all"
        today={today}
        onFilter={() => {}}
        loadMore={loadMore}
      />,
    )
    const span = () => document.querySelector("[data-epoch-span]")?.textContent
    expect(span()).toBe(`Epoch ${first.epoch}`)
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Show earlier epochs" }),
      )
    })
    expect(span()).toBe(`Epoch ${first.epoch - 9} to ${first.epoch}`)
  })

  it("drops a page that arrives after its filter was left", async () => {
    let finish: (value: ActivityPage) => void = () => {}
    const slow = new Promise<ActivityPage>((resolve) => {
      finish = resolve
    })
    const loadMore = vi
      .fn<(cursor: string) => Promise<ActivityPage>>()
      .mockImplementationOnce(() => slow)
      .mockImplementation(async () => page([second], null))
    const view = render(
      <ActivityView
        data={page([first], first.id)}
        filter="all"
        today={today}
        onFilter={() => {}}
        loadMore={loadMore}
      />,
    )
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Show earlier epochs" }),
      )
    })
    view.rerender(
      <ActivityView
        data={page([third], third.id)}
        filter="votes"
        today={today}
        onFilter={() => {}}
        loadMore={loadMore}
      />,
    )
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Show earlier epochs" }),
      )
    })
    expect(document.querySelectorAll("li")).toHaveLength(2)
    // The first filter's page comes back late: Votes keeps its own.
    await act(async () => {
      finish(page([first, second, third], null))
    })
    expect(document.querySelectorAll("li")).toHaveLength(2)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("lets the button work again after leaving a filter mid-load and coming back", async () => {
    let finish: (value: ActivityPage) => void = () => {}
    const slow = new Promise<ActivityPage>((resolve) => {
      finish = resolve
    })
    const loadMore = vi
      .fn<(cursor: string) => Promise<ActivityPage>>()
      .mockImplementationOnce(() => slow)
      .mockImplementation(async () => page([second], null))
    const all = (
      <ActivityView
        data={page([first], first.id)}
        filter="all"
        today={today}
        onFilter={() => {}}
        loadMore={loadMore}
      />
    )
    const view = render(all)
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Show earlier epochs" }),
      )
    })
    view.rerender(
      <ActivityView
        data={page([third], third.id)}
        filter="votes"
        today={today}
        onFilter={() => {}}
        loadMore={loadMore}
      />,
    )
    // The page arrives while Votes is shown, and is dropped.
    await act(async () => {
      finish(page([second], null))
    })
    view.rerender(all)
    const button = screen.getByRole("button", { name: "Show earlier epochs" })
    expect(button.getAttribute("aria-busy")).not.toBe("true")
    await act(async () => {
      fireEvent.click(button)
    })
    expect(loadMore).toHaveBeenCalledTimes(2)
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
      fireEvent.click(
        screen.getByRole("button", { name: "Show earlier epochs" }),
      )
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
