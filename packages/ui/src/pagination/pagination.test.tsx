import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import * as Pagination from "./index"

afterEach(cleanup)

describe("page arithmetic", () => {
  it("counts pages and keeps a page in range", () => {
    expect(Pagination.pageCount(131, 24)).toBe(6)
    expect(Pagination.pageCount(0, 24)).toBe(1)
    expect(Pagination.pageCount(24, 24)).toBe(1)
    expect(Pagination.clampPage(9, 6)).toBe(6)
    expect(Pagination.clampPage(0, 6)).toBe(1)
    expect(Pagination.clampPage(Number.NaN, 6)).toBe(1)
    expect(Pagination.clampPage(2.7, 6)).toBe(2)
  })

  it("says which items a page holds", () => {
    expect(Pagination.rangeText(1, 24, 131)).toBe("1 to 24 of 131")
    expect(Pagination.rangeText(6, 24, 131)).toBe("121 to 131 of 131")
    expect(Pagination.rangeText(9, 24, 131)).toBe("121 to 131 of 131")
    expect(Pagination.rangeText(1, 24, 1200)).toBe("1 to 24 of 1,200")
    expect(Pagination.pageRange(1, 24, 0)).toEqual({ from: 0, to: 0 })
  })

  it("lists every page when they fit", () => {
    expect(Pagination.pageItems(1, 1)).toEqual([1])
    expect(Pagination.pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it("leaves gaps around the current page, never a gap of one page", () => {
    expect(Pagination.pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20])
    expect(Pagination.pageItems(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20])
    expect(Pagination.pageItems(5, 20)).toEqual([1, "gap", 4, 5, 6, "gap", 20])
    expect(Pagination.pageItems(17, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20])
    expect(Pagination.pageItems(20, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20])
    for (let page = 1; page <= 20; page += 1) {
      const items = Pagination.pageItems(page, 20)
      expect(items).toHaveLength(7)
      expect(items).toContain(page)
    }
  })
})

function Pager({ page, count }: { page: number; count: number }): ReactNode {
  return (
    <Pagination.Root aria-label="Gauge pages">
      <Pagination.Summary>
        {Pagination.rangeText(page, 24, count * 24)}
      </Pagination.Summary>
      <Pagination.Previous disabled={page === 1} href={`?page=${page - 1}`} />
      <Pagination.List>
        {Pagination.pageItems(page, count).map((item, index) =>
          item === "gap" ? (
            <Pagination.Gap key={`gap-${index === 1 ? "start" : "end"}`} />
          ) : (
            <Pagination.Page
              key={item}
              page={item}
              current={item === page}
              href={`?page=${item}`}
            />
          ),
        )}
      </Pagination.List>
      <Pagination.Next disabled={page === count} href={`?page=${page + 1}`} />
    </Pagination.Root>
  )
}

describe("Pagination", () => {
  it("is a labelled navigation of links with the current page marked", () => {
    render(<Pager page={2} count={6} />)
    expect(screen.getByRole("navigation", { name: "Gauge pages" })).toBeTruthy()
    const current = screen.getByRole("link", { name: "Page 2" })
    expect(current.getAttribute("aria-current")).toBe("page")
    expect(
      screen.getByRole("link", { name: "Page 3" }).getAttribute("aria-current"),
    ).toBeNull()
    expect(
      screen.getByRole("link", { name: "Previous page" }).getAttribute("href"),
    ).toBe("?page=1")
    expect(
      screen.getByRole("link", { name: "Next page" }).getAttribute("rel"),
    ).toBe("next")
    expect(screen.getByText("25 to 48 of 144")).toBeTruthy()
  })

  it("disables the step past either end", () => {
    render(<Pager page={1} count={3} />)
    const previous = screen.getByRole("button", { name: "Previous page" })
    expect(previous.hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("link", { name: "Next page" })).toBeTruthy()
  })

  it("hides gaps from screen readers", () => {
    const view = render(<Pager page={10} count={20} />)
    const gaps = view.container.querySelectorAll("li[aria-hidden='true']")
    expect(gaps).toHaveLength(2)
  })

  it("renders the app's link with asChild", () => {
    render(
      <Pagination.List>
        <Pagination.Page page={4} current asChild>
          <a href="/vote?page=4" data-router="">
            ignored
          </a>
        </Pagination.Page>
      </Pagination.List>,
    )
    const link = screen.getByRole("link", { name: "Page 4" })
    expect(link.getAttribute("data-router")).toBe("")
    expect(link.textContent).toBe("4")
    expect(link.getAttribute("aria-current")).toBe("page")
  })
})
