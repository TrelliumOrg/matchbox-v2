import { render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as DataTable from "./index"

afterEach(() => vi.restoreAllMocks())

describe("DataTable reflow", () => {
  it("hides a cell with no phone place instead of stacking it", () => {
    render(
      <DataTable.Root caption="Blocks">
        <DataTable.Body>
          <DataTable.Row>
            <DataTable.Cell phone="title">13,078,795</DataTable.Cell>
            <DataTable.Cell>Northfield Nodes</DataTable.Cell>
            <DataTable.Cell>5 txns</DataTable.Cell>
          </DataTable.Row>
        </DataTable.Body>
      </DataTable.Root>,
    )
    for (const name of ["Northfield Nodes", "5 txns"]) {
      expect(screen.getByRole("cell", { name }).className).toContain(
        "max-md:hidden",
      )
    }
  })

  it("warns in development when two cells claim one place", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    render(
      <DataTable.Root caption="Blocks">
        <DataTable.Body>
          <DataTable.Row>
            <DataTable.Cell phone="detail">a</DataTable.Cell>
            <DataTable.Cell phone="detail">b</DataTable.Cell>
          </DataTable.Row>
        </DataTable.Body>
      </DataTable.Root>,
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('phone="detail"'))
    expect(
      DataTable.phoneCollisions([
        <DataTable.Cell key="1" phone="meta" />,
        <DataTable.Cell key="2" phone="meta" />,
        <DataTable.Cell key="3" />,
        <DataTable.Cell key="4" />,
      ]),
    ).toEqual(["meta"])
  })

  it("reflows at the breakpoint the app's phone layout uses", () => {
    render(
      <DataTable.Root caption="Transactions" reflow="xl">
        <DataTable.Header>
          <DataTable.Column>Action</DataTable.Column>
        </DataTable.Header>
        <DataTable.Body>
          <DataTable.Row>
            <DataTable.Cell phone="title">Repaid MUSD</DataTable.Cell>
            <DataTable.Cell phone="value">12m</DataTable.Cell>
          </DataTable.Row>
        </DataTable.Body>
      </DataTable.Root>,
    )
    const title = screen.getByRole("cell", { name: "Repaid MUSD" })
    expect(title.className).toContain("max-xl:row-start-1")
    expect(title.className).not.toContain("max-md:")
    expect(
      screen.getByRole("row", { name: /Repaid MUSD/ }).className,
    ).toContain("max-xl:grid")
  })

  it("scrolls wide tables in a labelled, focusable region", () => {
    render(
      <DataTable.Root caption="Token transfers">
        <DataTable.Body>
          <DataTable.Empty columns={6}>No transfers</DataTable.Empty>
        </DataTable.Body>
      </DataTable.Root>,
    )
    const region = screen.getByRole("region", { name: "Token transfers" })
    expect(region.className).toContain("overflow-x-auto")
    expect(region.tabIndex).toBe(0)
    expect(within(region).getByRole("table")).toBeTruthy()
  })
})
