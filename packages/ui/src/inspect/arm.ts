import { whenIdle } from "@matchbox/motion"
import { armedAttribute } from "./armed"

/**
 * The few lines every page with a chart carries: the inspection code itself
 * (`./controller`) is not in the first paint's scripts. A chart arms the
 * page once it has hydrated (`useInspect`); from then on the code loads
 * once the page is idle, or at once when someone points at, touches,
 * focuses or keys into a chart, and those events are handed on in order
 * once it has arrived. A pointer that leaves the chart before then takes
 * its point with it. Before the page hydrates nothing listens: keys go to
 * the page as they would without script. A load that fails (a dropped
 * connection) is tried again on the next such event.
 */

type Controller = typeof import("./controller")

let armed = false
let loading: Promise<void> | null = null
let loaded: Controller | null = null
const caught: Event[] = []

const early = ["pointerover", "pointerdown", "focusin", "keydown"] as const

/**
 * A mouse or pen that left a chart before the code arrived: its point
 * goes, so the replay does not show a point nobody is over.
 */
function onEarlyOut(event: Event): void {
  if (!(event instanceof PointerEvent) || event.pointerType === "touch") return
  const target = event.target
  const root =
    target instanceof Element ? target.closest("[data-inspect]") : null
  if (root === null) return
  const next = event.relatedTarget
  if (next instanceof Node && root.contains(next)) return
  for (let index = caught.length - 1; index >= 0; index -= 1) {
    const each = caught[index]
    if (
      each instanceof PointerEvent &&
      each.pointerType !== "touch" &&
      each.target instanceof Node &&
      root.contains(each.target)
    ) {
      caught.splice(index, 1)
    }
  }
}

function onEarly(event: Event): void {
  const target = event.target
  if (!(target instanceof Element) || target.closest("[data-inspect]") === null)
    return
  // The latest few: a focus and the keys after it.
  caught.push(event)
  if (caught.length > 8) caught.shift()
  void load()
}

function load(): Promise<void> {
  loading ??= import("./controller").then(
    (controller) => {
      for (const type of early) {
        document.removeEventListener(type, onEarly, true)
      }
      document.removeEventListener("pointerout", onEarlyOut, true)
      loaded = controller
      controller.install()
      for (const event of caught.splice(0)) controller.replay(event)
    },
    () => {
      // Tried again on the next point, touch, focus or key.
      loading = null
    },
  )
  return loading
}

/**
 * A chart left the page (a new page of bars, a link followed): whatever
 * it showed goes with it, the tooltip included, once React has removed it.
 */
export function release(): void {
  queueMicrotask(() => loaded?.clearDetached())
}

/** Makes the charts on this page inspectable. Safe to call many times. */
export function arm(): void {
  if (armed || typeof document === "undefined") return
  armed = true
  for (const type of early) {
    document.addEventListener(type, onEarly, { capture: true, passive: true })
  }
  document.addEventListener("pointerout", onEarlyOut, {
    capture: true,
    passive: true,
  })
  document.documentElement.setAttribute(armedAttribute, "")
  whenIdle(() => void load())
}
