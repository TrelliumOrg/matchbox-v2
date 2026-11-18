import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { island, steadyProps } from "./island"

type RowProps = {
  locks: string[]
  onPick: (id: string) => void
  format: (id: string) => string
}

let renders = 0

function Rows({ locks, onPick, format }: RowProps): ReactNode {
  renders += 1
  return (
    <ul>
      {locks.map((id) => (
        <li key={id}>
          <button type="button" onClick={() => onPick(id)}>
            {format(id)}
          </button>
        </li>
      ))}
    </ul>
  )
}

afterEach(() => {
  renders = 0
  vi.restoreAllMocks()
})

describe("which function props an island keeps steady", () => {
  it("wraps handlers only and passes any other function through", () => {
    const wrappers = new Map<string, (...args: unknown[]) => unknown>()
    const other: string[] = []
    const props: RowProps = {
      locks: ["2207"],
      onPick: () => undefined,
      format: (id) => `#${id}`,
    }
    const steady = steadyProps(props, { current: props }, wrappers, (key) =>
      other.push(key),
    )
    expect(steady.onPick).not.toBe(props.onPick)
    // Not a handler: the very function the parent passed, and reported.
    expect(steady.format).toBe(props.format)
    expect(other).toEqual(["format"])
    expect([...wrappers.keys()]).toEqual(["onPick"])
  })

  it("does not render again for a new handler, and calls the latest one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const Section = island<RowProps>("test-handlers", async () => Rows)
    const format = (id: string): string => `#${id}`
    const locks = ["2207"]
    const first = vi.fn()
    const view = render(
      <Section locks={locks} onPick={first} format={format} />,
    )
    await screen.findByRole("button", { name: "#2207" })
    const before = renders

    const second = vi.fn()
    view.rerender(<Section locks={locks} onPick={second} format={format} />)
    expect(renders).toBe(before)
    fireEvent.click(screen.getByRole("button", { name: "#2207" }))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith("2207")
  })

  it("renders again for a new function that is not a handler", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const Section = island<RowProps>("test-format", async () => Rows)
    const onPick = vi.fn()
    const locks = ["2207"]
    const view = render(
      <Section locks={locks} onPick={onPick} format={(id) => `#${id}`} />,
    )
    await screen.findByRole("button", { name: "#2207" })
    const before = renders

    view.rerender(
      <Section locks={locks} onPick={onPick} format={(id) => `Lock ${id}`} />,
    )
    // The output follows the parent's new closure instead of going stale.
    expect(
      await screen.findByRole("button", { name: "Lock 2207" }),
    ).toBeTruthy()
    expect(renders).toBeGreaterThan(before)
    // Said once in development, naming the island and the prop.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('"test-format"')
    expect(String(warn.mock.calls[0]?.[0])).toContain('"format"')
  })
})
