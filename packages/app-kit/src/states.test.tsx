import { shapes } from "@matchbox/ui/icons"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { EmptyState, SignedOut } from "./states"

describe("states", () => {
  it("draws an empty state as one line and one action", () => {
    render(
      <EmptyState
        icon={shapes.search}
        title="No transactions"
        action={<button type="button">Reset</button>}
      />,
    )
    expect(
      screen.getByRole("heading", { name: "No transactions" }),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy()
  })

  it("takes the connect action from the app", () => {
    render(
      <SignedOut
        title="Rewards"
        icon={shapes.wallet}
        action={<button type="button">Connect wallet</button>}
      />,
    )
    expect(screen.getByText("No wallet connected")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeTruthy()
  })
})
