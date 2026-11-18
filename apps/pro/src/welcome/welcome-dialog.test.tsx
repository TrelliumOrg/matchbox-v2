import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WelcomeDialog } from "./welcome-dialog"
import { WelcomeMount } from "./welcome-mount"
import { resetWelcomeForTests, welcomeKeys } from "./welcome-store"

async function settle(ms = 4000): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  window.history.replaceState(null, "", "/")
  resetWelcomeForTests()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("WelcomeDialog", () => {
  it("walks the three steps and remembers the close", async () => {
    render(<WelcomeDialog />)
    expect(
      screen.getByRole("dialog", { name: "Meet the new Matchbox Pro" }),
    ).toBeTruthy()
    expect(screen.getByText("Vote with every lock")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(
      screen.getByRole("dialog", { name: "Explore Mezo with Matchscan" }),
    ).toBeTruthy()
    expect(screen.getAllByText("Preview").length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Build with Matchbox")).toBeTruthy()
    expect(window.localStorage.getItem(welcomeKeys.seen)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Get started" }))
    await settle()
    expect(window.localStorage.getItem(welcomeKeys.seen)).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    )
  })

  it("goes back to a step from its dot", () => {
    render(<WelcomeDialog />)
    fireEvent.click(screen.getByRole("button", { name: "Step 3 of 3" }))
    expect(screen.getByText("Build with Matchbox")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Step 1 of 3" }))
    expect(screen.getByText("Vote with every lock")).toBeTruthy()
  })

  it("remembers a close from the X", async () => {
    render(<WelcomeDialog />)
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    await settle()
    expect(window.localStorage.getItem(welcomeKeys.seen)).not.toBeNull()
  })

  it("remembers leaving for Classic, and links there", () => {
    render(<WelcomeDialog />)
    const link = screen.getByRole("link", { name: "Go to Matchbox Classic" })
    expect(link.getAttribute("href")).toBe("https://app.matchbox.markets")
    link.addEventListener("click", (event) => event.preventDefault())
    fireEvent.click(link)
    expect(window.localStorage.getItem(welcomeKeys.seen)).not.toBeNull()
  })

  it("takes ?welcome=show out of the address", () => {
    window.history.replaceState(null, "", "/vote?tab=funded&welcome=show")
    render(<WelcomeDialog />)
    expect(window.location.search).toBe("?tab=funded")
  })
})

describe("WelcomeMount", () => {
  it("mounts nothing for a browser that has seen it", async () => {
    window.localStorage.setItem(welcomeKeys.seen, "2026-11-13")
    render(<WelcomeMount />)
    await settle()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("mounts nothing in an automated browser, as the test runner's is", async () => {
    expect(window.navigator.webdriver).toBe(true)
    render(<WelcomeMount />)
    await settle()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("shows after the page settles, and goes when closed", async () => {
    vi.spyOn(window.navigator, "webdriver", "get").mockReturnValue(false)
    render(<WelcomeMount />)
    expect(screen.queryByRole("dialog")).toBeNull()
    await settle()
    // The lazy chunk, then the render it was holding back.
    await act(async () => {
      await import("./welcome-dialog")
    })
    await settle(50)
    expect(screen.getByRole("dialog")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    await settle()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(window.localStorage.getItem(welcomeKeys.seen)).not.toBeNull()
  })
})
