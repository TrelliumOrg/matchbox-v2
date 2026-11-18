import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as HashChip from "../hash-chip"
import * as RawViewer from "../raw-viewer"

afterEach(cleanup)

const hash = `0x${"ab".repeat(32)}`

function clipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  })
}

describe("copy feedback", () => {
  it("announces from a live region outside the button", async () => {
    const user = userEvent.setup()
    clipboard(vi.fn(async () => undefined))
    render(<HashChip.Root value={hash} kind="hash" />)
    const button = screen.getByRole("button", { name: "Copy hash" })
    await user.click(button)
    const status = screen.getByRole("status")
    expect(status.textContent).toBe("Copied")
    expect(button.contains(status)).toBe(false)
    // The button's name stays the action, not the result.
    expect(button.getAttribute("aria-label")).toBe("Copy hash")
  })

  it("says so when the clipboard refuses", async () => {
    const user = userEvent.setup()
    clipboard(
      vi.fn(async () => {
        throw new DOMException("Denied", "NotAllowedError")
      }),
    )
    render(
      <RawViewer.Root
        title="Input"
        decoded={null}
        raw={{ kind: "input", data: "0x1234" }}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Copy" }))
    expect(screen.getByRole("status").textContent).toBe("Copy failed")
    expect(screen.getByRole("button", { name: "Copy failed" })).toBeTruthy()
  })
})
