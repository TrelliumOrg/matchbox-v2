import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CustomPeriod } from "./custom-period"
import { RangeToggle } from "./parts"
import type { PeriodView } from "./range"

/**
 * The period toggle's custom span: a labelled calendar button that opens
 * a native popover with From and To days and Apply, which navigates with
 * `from` and `to` and drops the range; a range link drops the span.
 */

async function inRouter(node: ReactNode, at = "/") {
  const root = createRootRoute({ component: () => node })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: [at] }),
  })
  render(<RouterProvider router={router} />)
  await router.load()
  return router
}

const span: PeriodView = {
  range: null,
  from: "2026-01-01",
  to: "2026-03-31",
  min: "2025-05-06",
  max: "2026-11-16",
  text: "1 Jan to 31 Mar",
}

describe("the custom period", () => {
  it("is a labelled button with a popover of two labelled days", async () => {
    await inRouter(
      <RangeToggle
        period={{ ...span, range: "30d", text: "30d" }}
        to="/"
        search={{}}
      >
        <CustomPeriod
          period={{ ...span, range: "30d", text: "30d" }}
          search={{}}
        />
      </RangeToggle>,
    )
    const button = screen.getByRole("button", { name: "Custom period" })
    expect(button.getAttribute("aria-current")).toBeNull()
    const id = button.getAttribute("popovertarget")
    const box = document.getElementById(id ?? "")
    expect(box?.getAttribute("popover")).toBe("auto")
    expect(box?.getAttribute("role")).toBe("dialog")
    const from = screen.getByLabelText<HTMLInputElement>("From")
    const to = screen.getByLabelText<HTMLInputElement>("To")
    expect(from.type).toBe("date")
    expect(from.min).toBe("2025-05-06")
    expect(to.max).toBe("2026-11-16")
    // The picked range is current ("page" once the router sees it active).
    expect(
      screen.getByRole("link", { name: "30d" }).getAttribute("aria-current"),
    ).not.toBeNull()
  })

  it("shows a span as picked, and its range links drop it", async () => {
    await inRouter(
      <RangeToggle period={span} to="/" search={{ tab: "x" }}>
        <CustomPeriod period={span} search={{ tab: "x" }} />
      </RangeToggle>,
      "/?from=2026-01-01&to=2026-03-31&tab=x",
    )
    const button = screen.getByRole("button", {
      name: "Custom period, 1 Jan to 31 Mar",
    })
    expect(button.getAttribute("aria-current")).toBe("true")
    expect(button.textContent).toBe("1 Jan to 31 Mar")
    const all = screen.getByRole("link", { name: "All" })
    expect(all.getAttribute("aria-current")).toBeNull()
    expect(all.getAttribute("href")).toBe("/?tab=x&range=All")
    expect(screen.getByRole("link", { name: "30d" }).getAttribute("href")).toBe(
      "/?tab=x",
    )
  })

  it("applies From and To as a GET to this page, keeping its other params", async () => {
    await inRouter(
      <RangeToggle
        period={{ ...span, range: "90d", text: "90d" }}
        to="/"
        search={{ tab: "x", order: undefined }}
      >
        <CustomPeriod
          period={{ ...span, range: "90d", text: "90d" }}
          search={{ tab: "x", order: undefined }}
        />
      </RangeToggle>,
      "/?range=90d&tab=x",
    )
    const button = screen.getByRole("button", { name: "Custom period" })
    const form = document.getElementById(
      button.getAttribute("popovertarget") ?? "",
    )
    if (!(form instanceof HTMLFormElement)) throw new Error("no form")
    // GET by default: Apply lands back at this toggle's button.
    expect(form.getAttribute("method")).toBeNull()
    expect(form.getAttribute("action")).toBe(`#${button.id}`)
    const data = new FormData(form)
    expect([...data.keys()]).toEqual(["tab", "from", "to"])
    expect(data.get("tab")).toBe("x")
    expect(data.get("from")).toBe("2026-01-01")
    // The server's HTML marks From autofocus: the popover focuses it.
    expect(renderToString(<CustomPeriod period={span} search={{}} />)).toMatch(
      /autofocus=""[^>]*name="from"/,
    )
    expect(
      screen.getByRole("button", { name: "Apply" }).getAttribute("type"),
    ).toBe("submit")
  })
})
