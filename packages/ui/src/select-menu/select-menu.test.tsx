import { readFileSync } from "node:fs"
import { join } from "node:path"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { presetNames, tokenContrast } from "../contrast"
import * as SelectMenu from "."
import { stepTo, typeahead } from "./select-menu"

afterEach(cleanup)

const sorts: Record<string, string> = {
  incentives: "Incentives",
  apy: "APY",
  votes: "Votes",
  room: "Room to 5×",
}

function Harness({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState<string>("incentives")
  return (
    <>
      <SelectMenu.Root
        label="Sort by"
        value={value}
        valueText={sorts[value]}
        onValueChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
      >
        {Object.entries(sorts).map(([key, label]) => (
          <SelectMenu.Item key={key} value={key}>
            {label}
          </SelectMenu.Item>
        ))}
      </SelectMenu.Root>
      <input aria-label="Search" />
    </>
  )
}

const trigger = () => screen.getByRole("button", { name: /^Sort by/ })

describe("SelectMenu", () => {
  it("names the trigger with its label and the current choice", () => {
    render(<Harness />)
    expect(trigger().textContent).toContain("Incentives")
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu")
    expect(trigger().getAttribute("aria-expanded")).toBe("false")
  })

  it("opens on the current choice and chooses with a press", async () => {
    const user = userEvent.setup()
    const chosen: string[] = []
    render(<Harness onChange={(value) => chosen.push(value)} />)
    await user.click(trigger())
    const menu = screen.getByRole("menu", { name: "Sort by" })
    expect(trigger().getAttribute("aria-controls")).toBe(menu.id)
    const current = screen.getByRole("menuitemradio", { name: "Incentives" })
    expect(current.getAttribute("aria-checked")).toBe("true")
    expect(document.activeElement).toBe(current)
    await user.click(screen.getByRole("menuitemradio", { name: "Votes" }))
    expect(chosen).toEqual(["votes"])
    expect(trigger().textContent).toContain("Votes")
    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(trigger())
  })

  it("works from the keyboard: arrows, typeahead, Enter and Escape", async () => {
    const user = userEvent.setup()
    const chosen: string[] = []
    render(<Harness onChange={(value) => chosen.push(value)} />)
    trigger().focus()
    await user.keyboard("{ArrowDown}")
    expect(document.activeElement?.textContent).toBe("Incentives")
    await user.keyboard("{ArrowDown}")
    expect(document.activeElement?.textContent).toBe("APY")
    await user.keyboard("{End}")
    expect(document.activeElement?.textContent).toBe("Room to 5×")
    await user.keyboard("{ArrowDown}")
    expect(document.activeElement?.textContent).toBe("Incentives")
    await user.keyboard("v")
    expect(document.activeElement?.textContent).toBe("Votes")
    await user.keyboard("{Escape}")
    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(trigger())
    expect(chosen).toEqual([])

    await user.keyboard("{Enter}")
    expect(trigger().getAttribute("aria-expanded")).toBe("true")
    await user.keyboard("{ArrowUp}{Enter}")
    expect(chosen).toEqual(["room"])
    expect(document.activeElement).toBe(trigger())
  })

  it("closes when Tab moves on", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(trigger())
    await user.tab()
    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(screen.getByLabelText("Search"))
  })

  it("does not call back when the current choice is chosen again", async () => {
    const user = userEvent.setup()
    const chosen: string[] = []
    render(<Harness onChange={(value) => chosen.push(value)} />)
    await user.click(trigger())
    await user.click(screen.getByRole("menuitemradio", { name: "Incentives" }))
    expect(chosen).toEqual([])
  })
})

describe("menu keys", () => {
  it("steps and wraps", () => {
    expect(stepTo(4, 0, "ArrowDown")).toBe(1)
    expect(stepTo(4, 3, "ArrowDown")).toBe(0)
    expect(stepTo(4, 0, "ArrowUp")).toBe(3)
    expect(stepTo(4, -1, "ArrowDown")).toBe(0)
    expect(stepTo(4, 2, "Home")).toBe(0)
    expect(stepTo(4, 0, "End")).toBe(3)
    expect(stepTo(4, 0, "a")).toBeNull()
    expect(stepTo(0, 0, "ArrowDown")).toBeNull()
  })

  it("jumps by first letters, and a repeated letter cycles", () => {
    const labels = ["Incentives", "APY", "Votes", "Values"]
    expect(typeahead(labels, 0, "v")).toBe(2)
    expect(typeahead(labels, 2, "vv")).toBe(3)
    expect(typeahead(labels, 3, "vvv")).toBe(2)
    expect(typeahead(labels, 2, "va")).toBe(3)
    expect(typeahead(labels, 0, "x")).toBeNull()
  })
})

describe("SelectMenu colours meet WCAG 2.2 AA in every preset", () => {
  // happy-dom gives import.meta.url no file scheme: resolve from the package.
  const css = readFileSync(
    join(process.cwd(), "../tokens/src/themes.css"),
    "utf8",
  )
  const pairs: readonly (readonly [string, string, number, string])[] = [
    ["sec", "bg", 4.5, "trigger"],
    ["ink", "pop", 4.5, "rows"],
    ["ink", "soft2", 4.5, "row under the pointer or focus"],
    ["ink", "soft2", 3, "focus outline and check"],
  ]
  for (const preset of presetNames) {
    for (const [text, background, minimum, use] of pairs) {
      it(`${preset}: ${text} on ${background} (${use})`, () => {
        expect(
          tokenContrast(css, preset, text, background),
        ).toBeGreaterThanOrEqual(minimum)
      })
    }
  }
})
