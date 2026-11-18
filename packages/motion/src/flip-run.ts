import { duration, easing } from "./easing"
import { presets } from "./presets"
import { prefersReducedMotion } from "./reduced-motion"

/**
 * Lists that animate their layout (FLIP): items carrying `data-flip="<key>"`
 * inside a watched container slide from where they were to where they are
 * (transform only), new ones fade and scale in, and removed ones fade out
 * where they were as inert copies that take no clicks.
 *
 * Mark the container `data-flip-list` (`="deep"` to follow items below its
 * children, `="quiet"` when items have their own entry) and call
 * `watchLists()` once when the page is idle (Pro does it from ThemeSync).
 * There is no hook and no first-paint code: a MutationObserver sees React's
 * commit before the browser paints, and finds lists that client navigation
 * adds. Positions are kept relative to the container (a scroll between
 * changes moves nothing) and re-measured when it resizes. Nothing moves
 * under reduced motion.
 */

type Place = { x: number; y: number; width: number; height: number }

type Snapshot = Map<string, { at: Place; element: HTMLElement }>

const watched = new WeakSet<HTMLElement>()

/**
 * An element's layout position in the page: offsets ignore transforms, so
 * a slide in progress never skews the next measurement.
 */
function pagePosition(element: HTMLElement): { x: number; y: number } {
  let x = 0
  let y = 0
  let node: Element | null = element
  while (node instanceof HTMLElement) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent
  }
  return { x, y }
}

function measure(root: HTMLElement, into: Snapshot): void {
  const origin = pagePosition(root)
  into.clear()
  for (const element of root.querySelectorAll<HTMLElement>("[data-flip]")) {
    const at = pagePosition(element)
    into.set(element.dataset.flip ?? "", {
      element,
      at: {
        x: at.x - origin.x,
        y: at.y - origin.y,
        width: element.offsetWidth,
        height: element.offsetHeight,
      },
    })
  }
}

/** An item React removed fades and shrinks out where it was. */
function ghost(root: HTMLElement, element: HTMLElement, at: Place): void {
  const copy = element.cloneNode(true)
  if (!(copy instanceof HTMLElement)) return
  copy.removeAttribute("data-flip")
  copy.setAttribute("data-ghost", "")
  copy.setAttribute("aria-hidden", "true")
  copy.inert = true
  Object.assign(copy.style, {
    position: "absolute",
    margin: "0",
    width: `${at.width}px`,
    height: `${at.height}px`,
    pointerEvents: "none",
    boxSizing: "border-box",
  })
  root.appendChild(copy)
  const parent = copy.offsetParent
  const base =
    parent instanceof HTMLElement ? pagePosition(parent) : { x: 0, y: 0 }
  const origin = pagePosition(root)
  const border = parent ?? document.documentElement
  copy.style.left = `${origin.x + at.x - base.x - border.clientLeft}px`
  copy.style.top = `${origin.y + at.y - base.y - border.clientTop}px`
  copy
    .animate(presets.list.exit.keyframes, {
      ...presets.list.exit.options,
      fill: "forwards",
    })
    .finished.finally(() => copy.remove())
}

/** Animates what changed from `before` to `now`. */
function play(
  root: HTMLElement,
  before: Snapshot,
  now: Snapshot,
  enter: boolean,
): void {
  for (const [key, { at, element }] of now) {
    const from = before.get(key)?.at
    if (from === undefined) {
      if (enter) {
        element.animate(
          presets.list.enter.keyframes,
          presets.list.enter.options,
        )
      }
      continue
    }
    const dx = from.x - at.x
    const dy = from.y - at.y
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    element.animate(
      [{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }],
      { duration: duration.roll, easing: easing.roll },
    )
  }
  for (const [key, { at, element }] of before) {
    // Items kept for their own exit (usePresenceList) have already left.
    if (now.has(key) || element.isConnected || "leaving" in element.dataset) {
      continue
    }
    ghost(root, element, at)
  }
}

function touchesItems(records: MutationRecord[]): boolean {
  return records.some((record) =>
    [...record.addedNodes, ...record.removedNodes].some(
      (node) =>
        node instanceof HTMLElement &&
        !node.hasAttribute("data-ghost") &&
        (node.hasAttribute("data-flip") ||
          node.querySelector("[data-flip]") !== null),
    ),
  )
}

/** Watches one `data-flip-list` container from now on. */
function watchList(root: HTMLElement): void {
  if (watched.has(root)) return
  watched.add(root)
  const mode = root.dataset.flipList
  const snapshot: Snapshot = new Map()
  measure(root, snapshot)
  new MutationObserver((records) => {
    if (!touchesItems(records)) return
    const before = new Map(snapshot)
    measure(root, snapshot)
    if (!prefersReducedMotion()) {
      play(root, before, snapshot, mode !== "quiet")
    }
  }).observe(root, { childList: true, subtree: mode === "deep" })
  new ResizeObserver(() => measure(root, snapshot)).observe(root)
}

function watchWithin(node: Node): void {
  if (!(node instanceof HTMLElement)) return
  if (node.hasAttribute("data-flip-list")) watchList(node)
  for (const list of node.querySelectorAll<HTMLElement>("[data-flip-list]")) {
    watchList(list)
  }
}

let started = false

/**
 * Animates every `data-flip-list` on the page, now and as they appear.
 * Call once, when the page is idle.
 */
export function watchLists(): void {
  if (started) return
  started = true
  watchWithin(document.body)
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) watchWithin(node)
    }
  }).observe(document.body, { childList: true, subtree: true })
}
