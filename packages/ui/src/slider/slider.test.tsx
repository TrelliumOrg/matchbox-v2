import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode, useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import * as Slider from "."

afterEach(() => {
  cleanup()
})

const marks = [1, 2, 3, 4, 5].map((each) => ({
  value: each * 100,
  label: `${each}×`,
}))

function Boost({ disabled = false }: { disabled?: boolean }): ReactNode {
  const [value, setValue] = useState(325)
  return (
    <>
      <Slider.Root
        aria-label="Boost"
        min={100}
        max={500}
        value={value}
        onValueChange={setValue}
        valueText={`${(value / 100).toFixed(2)}×`}
        marks={marks}
        markLabel={(mark) => `Set ${mark.label}`}
        disabled={disabled}
      />
      <output>{value}</output>
    </>
  )
}

describe("Slider", () => {
  it("is a labelled range with its value read out as text", () => {
    render(<Boost />)
    const slider = screen.getByRole<HTMLInputElement>("slider", {
      name: "Boost",
    })
    expect(slider.type).toBe("range")
    expect(slider.min).toBe("100")
    expect(slider.max).toBe("500")
    expect(slider.value).toBe("325")
    expect(slider.getAttribute("aria-valuetext")).toBe("3.25×")
    // The fill follows the value: 325 is 56.25% of the way from 100 to 500.
    expect(slider.style.getPropertyValue("--mbx-slider-at")).toBe("0.5625")
  })

  it("follows changes, including from the keyboard", async () => {
    render(<Boost />)
    const slider = screen.getByRole<HTMLInputElement>("slider", {
      name: "Boost",
    })
    fireEvent.change(slider, { target: { value: "410" } })
    expect(screen.getByText("410")).toBeTruthy()
    expect(slider.getAttribute("aria-valuetext")).toBe("4.10×")
    slider.focus()
    expect(document.activeElement).toBe(slider)
  })

  it("sets a mark's value from its button", async () => {
    render(<Boost />)
    await userEvent.click(screen.getByRole("button", { name: "Set 5×" }))
    expect(screen.getByText("500")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Set 5×" }).dataset.current).toBe(
      "",
    )
  })

  it("only shows its value when disabled", async () => {
    render(<Boost disabled />)
    const slider = screen.getByRole<HTMLInputElement>("slider", {
      name: "Boost",
    })
    expect(slider.disabled).toBe(true)
    const five = screen.getByRole<HTMLButtonElement>("button", {
      name: "Set 5×",
    })
    expect(five.disabled).toBe(true)
    await userEvent.click(five)
    expect(screen.getByText("325")).toBeTruthy()
  })
})
