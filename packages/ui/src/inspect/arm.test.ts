import { describe, expect, it, vi } from "vitest"

const controller = vi.hoisted(() => ({
  install: vi.fn(),
  replay: vi.fn(),
  clearDetached: vi.fn(),
}))
vi.mock("./controller", () => controller)
// Never idle: the code loads only on an event.
vi.mock("@matchbox/motion", () => ({ whenIdle: vi.fn() }))

const { arm } = await import("./arm")

function pointer(
  type: string,
  target: Element,
  init: PointerEventInit = {},
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    pointerType: "mouse",
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

describe("arming the page's charts", () => {
  it("marks the page, and drops a hover that left before the code came", async () => {
    document.body.innerHTML = `
      <ul data-inspect="x"><li><a data-inspect-point id="one"></a></li>
        <li><a data-inspect-point id="two"></a></li></ul>
      <p id="away"></p>`
    const one = document.getElementById("one") as Element
    const two = document.getElementById("two") as Element
    const away = document.getElementById("away") as Element
    arm()
    expect(document.documentElement.hasAttribute("data-inspect-armed")).toBe(
      true,
    )
    // Over a bar, to the next one (still the chart), then off it: all
    // before the code arrives.
    pointer("pointerover", one)
    pointer("pointerout", one, { relatedTarget: two })
    pointer("pointerover", two)
    pointer("pointerout", two, { relatedTarget: away })
    const key = new KeyboardEvent("keydown", { key: "End", bubbles: true })
    two.dispatchEvent(key)
    await vi.waitFor(() => expect(controller.install).toHaveBeenCalled())
    // Only the key is handed on.
    expect(controller.replay.mock.calls.map(([event]) => event)).toEqual([key])
  })
})
