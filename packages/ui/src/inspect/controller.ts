import { change, describe, nearest, step } from "./logic"

/**
 * Chart inspection, one listener set for the whole page (loaded by `./arm`
 * once the page is idle or a chart is first touched). Charts are server
 * drawn markup that says what each point is:
 *
 * - the chart: `data-inspect` ("x": the point nearest the pointer across
 *   the chart; "items": the point under the pointer), `data-inspect-change`
 *   ("relative": the change from the point before, in percent) and
 *   `data-inspect-readout` ("figure": the panel's big number reads the
 *   point; else a small tooltip does);
 * - each point: `data-inspect-point` with `data-inspect-label` ("Epoch 31"),
 *   `data-inspect-value` (the exact formatted value) and `data-inspect-n`
 *   (the number, for the change); a line's points are zero-size circles;
 * - a line's guide and dot: `data-inspect-guide`, `data-inspect-dot`;
 * - the panel: `data-inspect-scope`, holding the figure's slots
 *   (`data-inspect-slot` "value" and "note", see `Value` and `Note`).
 *
 * Pointer hover, a touch (tap or drag) and keyboard focus show a point: it
 * stays at full strength while the others dim, the figure or tooltip shows
 * its label, value and change, and leaving puts the latest back; when the
 * page scrolls under a resting mouse, what is under it then. Arrow keys,
 * Home and End move between points. The page's React tree is never
 * written to: only attributes and the slots' empty live halves.
 */

type Via = "pointer" | "touch" | "key"

type Active = { root: Element; index: number; via: Via }

let active: Active | null = null
/** Where a mouse or pen last was, to look again when the page scrolls. */
let pointerAt: { x: number; y: number } | null = null
/** A look under the pointer is waiting for the next frame. */
let lookPending = false
let bubble: HTMLElement | null = null
let speaker: HTMLElement | null = null
let installed = false

const focusable =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

function rootOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest("[data-inspect]") : null
}

function pointsOf(root: Element): Element[] {
  return Array.from(root.querySelectorAll("[data-inspect-point]")).filter(
    (point) => point.closest("[data-inspect]") === root,
  )
}

function pointAt(target: EventTarget | null, root: Element): Element | null {
  if (!(target instanceof Element)) return null
  const point = target.closest("[data-inspect-point]")
  return point !== null && root.contains(point) ? point : null
}

function numberOf(
  point: Element | undefined,
  name = "data-inspect-n",
): number | null {
  const raw = point?.getAttribute(name)
  if (raw === null || raw === undefined || raw === "") return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function anchorOf(point: Element): Element {
  return point.querySelector("[data-inspect-anchor]") ?? point
}

function centreX(point: Element): number {
  const rect = anchorOf(point).getBoundingClientRect()
  return rect.left + rect.width / 2
}

/** The panel slots this chart reads into, when it has them. */
function slotsFor(
  root: Element,
): { scope: Element; value: Element; note: Element | null } | null {
  if (root.getAttribute("data-inspect-readout") !== "figure") return null
  const scope = root.closest("[data-inspect-scope]")
  if (scope === null) return null
  const own = (name: string): Element | null =>
    Array.from(scope.querySelectorAll(`[data-inspect-slot="${name}"]`)).find(
      (slot) => slot.closest("[data-inspect-scope]") === scope,
    ) ?? null
  const value = own("value")?.querySelector(":scope > [data-inspect-live]")
  if (value === null || value === undefined) return null
  const note = own("note")?.querySelector(":scope > [data-inspect-live]")
  return { scope, value, note: note ?? null }
}

function toneClass(tone: "pos" | "neg" | "flat"): string {
  return tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-sec"
}

function tip(): HTMLElement {
  if (bubble !== null) return bubble
  const element = document.createElement("div")
  element.setAttribute("popover", "manual")
  element.setAttribute("aria-hidden", "true")
  element.setAttribute("data-mbx-pop", "")
  element.setAttribute("data-mbx-motion", "")
  element.setAttribute("data-inspect-tip", "")
  element.className =
    "pointer-events-none fixed m-0 w-max max-w-72 rounded-xl border-0 bg-tip px-3 py-2 text-left font-sans text-[13.5px] leading-[1.45] font-medium text-on-tip tabular-nums"
  element.style.inset = "auto"
  document.body.appendChild(element)
  bubble = element
  return element
}

function say(text: string): void {
  if (speaker === null) {
    speaker = document.createElement("div")
    speaker.setAttribute("aria-live", "polite")
    speaker.setAttribute("data-inspect-speaker", "")
    speaker.className = "sr-only"
    document.body.appendChild(speaker)
  }
  speaker.textContent = text
}

function placeTip(element: HTMLElement, anchor: Element): void {
  const rect = anchor.getBoundingClientRect()
  const gap = 10
  const edge = 8
  const width = element.offsetWidth
  const height = element.offsetHeight
  let top = rect.top - gap - height
  if (top < edge) top = rect.bottom + gap
  let left = rect.left + rect.width / 2 - width / 2
  left = Math.max(edge, Math.min(left, window.innerWidth - edge - width))
  element.style.top = `${Math.round(top)}px`
  element.style.left = `${Math.round(left)}px`
}

function moveGuide(root: Element, point: Element): void {
  const x = point.getAttribute("cx")
  const y = point.getAttribute("cy")
  if (x === null || y === null) return
  root
    .querySelector("[data-inspect-guide]")
    ?.setAttribute("transform", `translate(${x} 0)`)
  root
    .querySelector("[data-inspect-dot]")
    ?.setAttribute("transform", `translate(${x} ${y})`)
}

/** Shows point `index` of `root`. */
export function show(root: Element, index: number, via: Via): void {
  const points = pointsOf(root)
  const point = points[index]
  if (point === undefined) return
  if (active !== null && (active.root !== root || !active.root.isConnected))
    clear()
  if (active?.root === root && active.index === index) {
    active.via = via
    return
  }
  for (const each of points) each.removeAttribute("data-active")
  point.setAttribute("data-active", "")
  root.setAttribute("data-inspecting", "")
  moveGuide(root, point)
  active = { root, index, via }

  const label = point.getAttribute("data-inspect-label") ?? ""
  const value = point.getAttribute("data-inspect-value") ?? ""
  const now = numberOf(point)
  const before =
    numberOf(points[index - 1]) ?? numberOf(point, "data-inspect-before")
  const delta =
    root.getAttribute("data-inspect-change") === "relative" &&
    now !== null &&
    !point.hasAttribute("data-inspect-partial")
      ? change(before, now)
      : null

  const slots = slotsFor(root)
  if (slots !== null) {
    slots.value.textContent = value
    if (slots.note !== null) {
      const parts: Node[] = [document.createTextNode(label)]
      if (delta !== null) {
        const span = document.createElement("span")
        span.className = `ml-2 font-semibold ${toneClass(delta.tone)}`
        span.textContent = delta.text
        parts.push(span)
      }
      slots.note.replaceChildren(...parts)
    }
    slots.scope.setAttribute("data-inspecting", "")
  } else {
    const element = tip()
    const head = document.createElement("span")
    head.className = "block text-on-tip/70"
    head.textContent = label
    const body = document.createElement("span")
    body.className = "block font-semibold"
    body.textContent = value
    if (delta !== null) {
      const span = document.createElement("span")
      span.className = "ml-2 font-medium text-on-tip/70"
      span.textContent = delta.text
      body.appendChild(span)
    }
    element.replaceChildren(head, body)
    element.setAttribute("data-open", "")
    if (
      typeof element.showPopover === "function" &&
      !element.matches(":popover-open")
    ) {
      try {
        element.showPopover()
      } catch {
        // Already shown: the fixed position holds.
      }
    }
    placeTip(element, anchorOf(point))
  }
  // The keyboard hears what the focused point's own name does not say.
  const focused = document.activeElement
  if (
    via === "key" &&
    focused !== null &&
    (focused === root ||
      (pointAt(focused, root) === point &&
        !(focused.getAttribute("aria-label") ?? "").includes(value)))
  ) {
    say(describe(label, value, delta))
  }
}

/** Puts the latest back: the figure's own text, no tooltip, no dimming. */
export function clear(): void {
  if (active === null) return
  const { root } = active
  active = null
  root.removeAttribute("data-inspecting")
  for (const point of pointsOf(root)) point.removeAttribute("data-active")
  const slots = slotsFor(root)
  if (slots !== null) {
    slots.scope.removeAttribute("data-inspecting")
    slots.value.textContent = ""
    slots.note?.replaceChildren()
  }
  if (bubble !== null) {
    bubble.removeAttribute("data-open")
    if (typeof bubble.hidePopover === "function") {
      try {
        bubble.hidePopover()
      } catch {
        // Not shown.
      }
    }
  }
}

/** Clears what a chart that has left the page was showing. */
export function clearDetached(): void {
  if (active !== null && !active.root.isConnected) clear()
}

/** The point of `root` at `target` (`items`) or nearest `x` (`x`). */
function indexFor(
  root: Element,
  target: EventTarget | null,
  x: number,
): number | null {
  const points = pointsOf(root)
  if (root.getAttribute("data-inspect") === "items") {
    const point = pointAt(target, root)
    return point === null ? null : points.indexOf(point)
  }
  const index = nearest(points.map(centreX), x)
  return index < 0 ? null : index
}

function onPointer(event: PointerEvent): void {
  const touch = event.pointerType === "touch"
  if (!touch) pointerAt = { x: event.clientX, y: event.clientY }
  const root = rootOf(event.target)
  if (root === null) {
    if (active !== null && (event.type === "pointerdown" || !touch)) {
      if (active.via !== "key" || event.type === "pointerdown") clear()
    }
    return
  }
  // A touch shows a point on press and drag; a mouse on hover.
  if (touch && event.type === "pointerover") return
  const index = indexFor(root, event.target, event.clientX)
  if (index === null) return
  show(root, index, touch ? "touch" : "pointer")
}

function onPointerOut(event: PointerEvent): void {
  if (active === null || active.via !== "pointer") return
  const next = event.relatedTarget
  if (next instanceof Node && active.root.contains(next)) return
  clear()
}

/** A touch lifted: a chart its tap replaced (a new page) shows nothing. */
function onPointerUp(): void {
  clearDetached()
}

/**
 * The page moved under the pointer (a scroll, a resize). A resting mouse
 * sends no event of its own, so look again where it is, once a frame:
 * the point under it now, or nothing. A touch's point goes; a key's stays.
 */
function onScroll(): void {
  if (active === null || active.via === "key") return
  if (active.via !== "pointer" || pointerAt === null) {
    clear()
    return
  }
  if (lookPending) return
  lookPending = true
  requestAnimationFrame(lookAgain)
}

function lookAgain(): void {
  lookPending = false
  if (active === null || active.via !== "pointer" || pointerAt === null) return
  const target = document.elementFromPoint?.(pointerAt.x, pointerAt.y) ?? null
  // Still over the bar it shows: nothing to do.
  const shown = pointsOf(active.root)[active.index]
  if (shown !== undefined && target !== null && shown.contains(target)) return
  const root = rootOf(target)
  const index = root === null ? null : indexFor(root, target, pointerAt.x)
  if (root !== null && index !== null) show(root, index, "pointer")
  else clear()
}

function onFocusIn(event: FocusEvent): void {
  const target = event.target
  const root = rootOf(target)
  if (root === null || !(target instanceof Element)) return
  // A click focuses a bar too; only the keyboard's focus shows one.
  if (!target.matches(":focus-visible")) return
  const points = pointsOf(root)
  const own = pointAt(target, root)
  const index =
    own !== null
      ? points.indexOf(own)
      : active?.root === root
        ? active.index
        : points.length - 1
  show(root, index, "key")
}

function onFocusOut(event: FocusEvent): void {
  if (active === null || active.via !== "key") return
  const next = event.relatedTarget
  if (next instanceof Node && active.root.contains(next)) return
  clear()
}

function onKey(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey)
    return
  const target = event.target
  const root = rootOf(target)
  if (root === null || !(target instanceof Element)) return
  if (event.key === "Escape") {
    if (active?.root === root) clear()
    return
  }
  const vertical = root.getAttribute("data-inspect") === "items"
  const key =
    !vertical && (event.key === "ArrowUp" || event.key === "ArrowDown")
      ? ""
      : event.key
  const points = pointsOf(root)
  const own = pointAt(target, root)
  const from =
    active?.root === root
      ? active.index
      : own !== null
        ? points.indexOf(own)
        : points.length - 1
  const next = step(from, key, points.length)
  if (next === null) return
  const to = points[next]
  if (to === undefined) return
  if (own !== null) {
    // Bars that are links or buttons: focus moves, and focus shows it.
    const stop = to.matches(focusable) ? to : to.querySelector(focusable)
    if (stop instanceof HTMLElement || stop instanceof SVGElement) {
      event.preventDefault()
      stop.focus()
    }
    return
  }
  event.preventDefault()
  show(root, next, "key")
}

/** Handles an event the loader caught before this module arrived. */
export function replay(event: Event): void {
  if (event instanceof FocusEvent) onFocusIn(event)
  else if (event instanceof KeyboardEvent) onKey(event)
  else if (event instanceof PointerEvent) onPointer(event)
}

/** Listens on the document, once. */
export function install(): void {
  if (installed || typeof document === "undefined") return
  installed = true
  const passive = { passive: true }
  document.addEventListener("pointerover", onPointer, passive)
  document.addEventListener("pointermove", onPointer, passive)
  document.addEventListener("pointerdown", onPointer, passive)
  document.addEventListener("pointerout", onPointerOut, passive)
  document.addEventListener("pointerup", onPointerUp, passive)
  document.addEventListener("pointercancel", onPointerUp, passive)
  document.addEventListener("focusin", onFocusIn)
  document.addEventListener("focusout", onFocusOut)
  document.addEventListener("keydown", onKey)
  window.addEventListener("scroll", onScroll, { capture: true, passive: true })
  window.addEventListener("resize", onScroll, passive)
}
