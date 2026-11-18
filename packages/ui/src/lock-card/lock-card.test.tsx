import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { shapes } from "../icons"
import * as LockCard from "./index"

afterEach(() => {
  cleanup()
})

function Card({
  onAdd = () => {},
  onTransfer = () => {},
}: {
  onAdd?: () => void
  onTransfer?: () => void
}): ReactNode {
  return (
    <LockCard.Root kind="vemezo">
      <LockCard.Front>
        <LockCard.Tab href="/locks/2930">veMEZO #2930</LockCard.Tab>
        <LockCard.Body>
          <LockCard.Amount>18,402.00 MEZO</LockCard.Amount>
          <LockCard.Rows>
            <LockCard.Row label="Voting power">18,402 veMEZO</LockCard.Row>
          </LockCard.Rows>
          <LockCard.Manage />
        </LockCard.Body>
      </LockCard.Front>
      <LockCard.Back>
        <LockCard.Tab>veMEZO #2930</LockCard.Tab>
        <LockCard.Menu>
          <LockCard.MenuItem icon={null} onClick={onAdd}>
            Add MEZO
          </LockCard.MenuItem>
          <LockCard.MenuItem icon={null} disabled value="Auto max">
            Extend
          </LockCard.MenuItem>
          <LockCard.MenuItem icon={null} onClick={onTransfer}>
            Transfer
          </LockCard.MenuItem>
          <LockCard.Done />
        </LockCard.Menu>
      </LockCard.Back>
    </LockCard.Root>
  )
}

function flipped(container: HTMLElement): string | null | undefined {
  return container.querySelector("article")?.getAttribute("data-flipped")
}

describe("LockCard flip", () => {
  it("flips when the card itself is clicked, and back again", async () => {
    const user = userEvent.setup()
    const { container } = render(<Card />)
    expect(flipped(container)).toBe("false")
    await user.click(screen.getByText("18,402.00 MEZO"))
    expect(flipped(container)).toBe("true")
    expect(document.activeElement?.textContent).toContain("Add MEZO")
    const back = container.querySelectorAll("article > div > div")[1]
    if (!(back instanceof HTMLElement)) throw new Error("No back face")
    await user.click(back)
    expect(flipped(container)).toBe("false")
  })

  it("does not flip on the tab's link", async () => {
    const user = userEvent.setup()
    const { container } = render(<Card />)
    const link = screen.getByRole("link", { name: "veMEZO #2930" })
    link.addEventListener("click", (event) => event.preventDefault())
    await user.click(link)
    expect(flipped(container)).toBe("false")
  })

  it("runs a back face action without flipping the card", async () => {
    const user = userEvent.setup()
    const onTransfer = vi.fn()
    const { container } = render(<Card onTransfer={onTransfer} />)
    await user.click(screen.getByRole("button", { name: "Manage" }))
    await user.click(screen.getByRole("button", { name: "Transfer" }))
    expect(onTransfer).toHaveBeenCalledOnce()
    expect(flipped(container)).toBe("true")
  })

  it("keeps an off action focusable with its reason, and inert", async () => {
    const user = userEvent.setup()
    const { container } = render(<Card />)
    await user.click(screen.getByRole("button", { name: "Manage" }))
    const extend = screen.getByRole("button", { name: /Extend/ })
    expect(extend.getAttribute("aria-disabled")).toBe("true")
    expect(extend.textContent).toContain("Auto max")
    await user.click(extend)
    expect(flipped(container)).toBe("true")
  })

  it("flips from the keyboard with Manage and Done, moving focus", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const { container } = render(<Card onAdd={onAdd} />)
    await user.tab()
    await user.tab()
    expect(document.activeElement?.textContent).toBe("Manage")
    await user.keyboard("{Enter}")
    expect(flipped(container)).toBe("true")
    expect(document.activeElement?.textContent).toContain("Add MEZO")
    await user.keyboard("{Enter}")
    expect(onAdd).toHaveBeenCalledOnce()
    screen.getByRole("button", { name: "Done" }).focus()
    await user.keyboard("{Enter}")
    expect(flipped(container)).toBe("false")
    expect(document.activeElement?.textContent).toBe("Manage")
  })

  it("animates transform only, and not at all under reduced motion", () => {
    const { container } = render(<Card />)
    const flipper = container.querySelector("article > div")
    const classes = flipper?.className ?? ""
    expect(classes).toContain("transition-transform")
    expect(classes).toContain("motion-reduce:transition-none")
    for (const face of container.querySelectorAll("article > div > div")) {
      expect(face.className).not.toMatch(/transition-(all|opacity)/)
    }
  })
})

function Refined({ onClaim }: { onClaim: () => void }): ReactNode {
  return (
    <LockCard.Root kind="vemezo">
      <LockCard.Front>
        <LockCard.Tab aside={<LockCard.Flip />}>#2930</LockCard.Tab>
        <LockCard.Body>
          <LockCard.Headline unit="veMEZO">500,000</LockCard.Headline>
          <LockCard.Meta>
            <LockCard.Prop mark={<span>M</span>} label="Locked">
              500,000.00
            </LockCard.Prop>
            <LockCard.Prop icon={shapes.infinity} label="Auto max" />
          </LockCard.Meta>
          <LockCard.Lines>
            <LockCard.Line icon={shapes.gift} label="Claimable" tone="positive">
              $3.89
            </LockCard.Line>
          </LockCard.Lines>
          <LockCard.Action intent="primary" onClick={onClaim}>
            Claim $3.89
          </LockCard.Action>
        </LockCard.Body>
      </LockCard.Front>
      <LockCard.Back>
        <LockCard.Tab>#2930</LockCard.Tab>
        <LockCard.Menu>
          <LockCard.MenuItem icon={null}>Add MEZO</LockCard.MenuItem>
        </LockCard.Menu>
      </LockCard.Back>
    </LockCard.Root>
  )
}

describe("LockCard refined front", () => {
  it("runs the pill's action without flipping", async () => {
    const user = userEvent.setup()
    const onClaim = vi.fn()
    const { container } = render(<Refined onClaim={onClaim} />)
    await user.click(screen.getByRole("button", { name: "Claim $3.89" }))
    expect(onClaim).toHaveBeenCalledOnce()
    expect(flipped(container)).toBe("false")
  })

  it("names each meta property and does not flip on one", async () => {
    const user = userEvent.setup()
    const { container } = render(<Refined onClaim={() => {}} />)
    expect(screen.getByRole("img", { name: "Auto max" })).toBeTruthy()
    expect(screen.getByRole("img", { name: "Locked" })).toBeTruthy()
    await user.click(screen.getByText("500,000.00"))
    expect(flipped(container)).toBe("false")
    await user.click(screen.getByText("Claimable"))
    expect(flipped(container)).toBe("true")
  })

  it("flips from the tab's chevron and returns focus to it", async () => {
    const user = userEvent.setup()
    const { container } = render(<Refined onClaim={() => {}} />)
    await user.click(screen.getByRole("button", { name: "Manage" }))
    expect(flipped(container)).toBe("true")
    // The back tab's return arrow sits where the chevron was.
    await user.click(screen.getByRole("button", { name: "Back" }))
    expect(flipped(container)).toBe("false")
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Manage")
  })
})
