import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setWallet } from "../wallet/wallet-store"
import { type ClassicRowProps, FloatingNote, SidebarNote } from "./classic-note"
import { ClassicNoteMount } from "./note-mount"
import { getNote, noteKeys, resetNote } from "./note-store"

function Row({ ref, held, fading, className }: ClassicRowProps) {
  return (
    <a
      ref={ref}
      href="https://app.matchbox.markets"
      data-testid="row"
      data-held={held === true ? "" : undefined}
      data-fading={fading === true ? "" : undefined}
      className={className}
    >
      Matchbox Classic
    </a>
  )
}

/** Past the 600ms settle and the idle wait, or through an exit. */
async function settle(ms = 4000): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const wallet = {
  address: "0x1111111111111111111111111111111111111111",
  chainId: 31612,
}

const animate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "animate",
)

beforeEach(() => {
  vi.useFakeTimers()
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem(noteKeys.visit, "show")
  resetNote()
  setWallet({ account: null })
  // No Web Animations: every animation here ends at once, so the tests
  // follow the states and the timers, not frames.
  Object.defineProperty(HTMLElement.prototype, "animate", {
    value: undefined,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  if (animate === undefined) {
    Reflect.deleteProperty(HTMLElement.prototype, "animate")
  } else {
    Object.defineProperty(HTMLElement.prototype, "animate", animate)
  }
  setWallet({ account: null })
  resetNote()
})

describe("SidebarNote", () => {
  it("waits for the page to settle, then stands in for the Classic row", async () => {
    render(<SidebarNote Row={Row} />)
    expect(screen.queryByText("Looking for the old Matchbox?")).toBeNull()
    expect(screen.getByTestId("row").className).toBe("")
    await settle()
    expect(screen.getByText("Looking for the old Matchbox?")).toBeTruthy()
    const link = screen.getByRole("link", { name: "Go to Matchbox Classic" })
    expect(link.getAttribute("href")).toBe("https://app.matchbox.markets")
    // Same tab.
    expect(link.hasAttribute("target")).toBe(false)
    expect(
      screen.getByRole("complementary", { name: "Matchbox Classic" }),
    ).toBeTruthy()
    // The row gives way where the card shows, and stays for the rail.
    expect(screen.getByTestId("row").className).toBe("lg:hidden rail:flex")
    expect(getNote().entered).toBe(true)
  })

  it("is simply there when it already entered in this visit", () => {
    window.sessionStorage.setItem(noteKeys.visit, "shown")
    resetNote()
    render(<SidebarNote Row={Row} />)
    expect(screen.getByText("Looking for the old Matchbox?")).toBeTruthy()
  })

  it("folds into the row on dismissal: held, focused, then at rest", async () => {
    render(<SidebarNote Row={Row} />)
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss banner" }))
    expect(window.localStorage.getItem(noteKeys.dismissed)).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    )
    await settle(100)
    expect(screen.queryByText("Looking for the old Matchbox?")).toBeNull()
    const row = screen.getByTestId("row")
    expect(row.className).toBe("")
    expect(row.hasAttribute("data-held")).toBe(true)
    expect(document.activeElement).toBe(row)
    await settle(1200)
    expect(row.hasAttribute("data-held")).toBe(false)
    expect(row.hasAttribute("data-fading")).toBe(true)
    await settle(400)
    expect(row.hasAttribute("data-fading")).toBe(false)
  })

  it("goes without the fold or the focus move when a wallet connects", async () => {
    render(
      <>
        <ClassicNoteMount />
        <SidebarNote Row={Row} />
      </>,
    )
    await settle()
    expect(
      screen.getByRole("link", { name: "Go to Matchbox Classic" }),
    ).toBeTruthy()
    act(() => setWallet({ account: wallet }))
    await settle(100)
    expect(
      screen.queryByRole("link", { name: "Go to Matchbox Classic" }),
    ).toBeNull()
    const row = screen.getByTestId("row")
    expect(row.hasAttribute("data-held")).toBe(false)
    expect(document.activeElement).not.toBe(row)
    expect(window.localStorage.getItem(noteKeys.used)).toBe("1")
    expect(window.localStorage.getItem(noteKeys.dismissed)).toBeNull()
  })
})

describe("FloatingNote", () => {
  it("uses the sidebar note's wording and leaves on dismissal", async () => {
    render(<FloatingNote />)
    expect(screen.queryByRole("complementary")).toBeNull()
    await settle()
    expect(screen.getByText("Looking for the old Matchbox?")).toBeTruthy()
    expect(screen.queryByText("Looking for old Matchbox?")).toBeNull()
    const link = screen.getByRole("link", { name: "Go to Matchbox Classic" })
    expect(link.getAttribute("href")).toBe("https://app.matchbox.markets")
    fireEvent.click(screen.getByRole("button", { name: "Dismiss banner" }))
    await settle(100)
    expect(screen.queryByRole("complementary")).toBeNull()
    expect(getNote().phase).toBe("dismissed")
  })
})

describe("ClassicNoteMount", () => {
  it("mounts nothing for a visit that did not come from the homepage", async () => {
    window.sessionStorage.clear()
    resetNote()
    const view = render(<ClassicNoteMount />)
    await settle()
    expect(view.container.innerHTML).toBe("")
  })

  it("records a wallet connection even when the note is not up", async () => {
    window.sessionStorage.clear()
    resetNote()
    render(<ClassicNoteMount />)
    act(() => setWallet({ account: wallet }))
    await settle(10)
    expect(window.localStorage.getItem(noteKeys.used)).toBe("1")
  })
})
