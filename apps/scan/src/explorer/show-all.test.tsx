import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { ShowAll } from "./show-all"

function blocks(count: number): ReactNode[] {
  return Array.from({ length: count }, (_, index) => `Log ${index}`).map(
    (text) => <p key={text}>{text}</p>,
  )
}

describe("ShowAll", () => {
  it("shows a short stack whole, with no control", () => {
    render(<ShowAll noun="logs">{blocks(4)}</ShowAll>)
    expect(screen.getByText("Log 3").closest("details")).toBeNull()
    expect(document.querySelector("details")).toBeNull()
  })

  it("keeps the first three open and the rest behind Show all", async () => {
    const user = userEvent.setup()
    render(<ShowAll noun="logs">{blocks(25)}</ShowAll>)
    const details = document.querySelector("details")
    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
    expect(screen.getByText("Log 2").closest("details")).toBeNull()
    expect(screen.getByText("Log 3").closest("details")).toBe(details)
    expect(screen.getByText("Log 24").closest("details")).toBe(details)
    const summary = screen.getByText("Show all 25 logs").closest("summary")
    expect(summary).not.toBeNull()
    if (summary !== null) await user.click(summary)
    expect(details?.open).toBe(true)
  })
})
