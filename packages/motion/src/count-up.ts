import NumberFlow from "number-flow"
import { duration, easing } from "./easing"
import { prefersReducedMotion } from "./reduced-motion"

/**
 * Headline count-ups, started on idle by `startPageMotion` (no first-paint
 * code: AnimatedNumber only stamps `data-count-up="<session key>"` on its
 * server-rendered text). The first time a headline is in view in the
 * session, a NumberFlow laid over it counts from zero up to its value while
 * the text underneath keeps its place (transparent, still read by screen
 * readers), so nothing around it moves (CLS 0). Never under reduced motion.
 *
 * The headline is usually the page's LCP element, and it still counts: the
 * count starts on idle, after LCP has painted, and the overlay is the same
 * size as the text, so it is never a larger LCP candidate. (Skipping the LCP
 * element meant the main number never ticked on any page.)
 */

const storageKey = "mbx-counted"

/** Session keys that have counted up (kept for the tab's session). */
const counted = new Set<string>(readCounted())

function readCounted(): string[] {
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    const list: unknown = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(list)
      ? list.filter((key): key is string => typeof key === "string")
      : []
  } catch {
    return []
  }
}

function markCounted(key: string): void {
  counted.add(key)
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify([...counted]))
  } catch {
    // Storage blocked: counted for this page only.
  }
}

type Figure = {
  prefix: string
  suffix: string
  value: number
  places: number
}

/** "$1,284.40" as prefix, value and places; null when it is not a figure. */
export function parseFigure(text: string): Figure | null {
  const match = /^([^\d-]*)(-?[\d,]*\d(?:\.(\d+))?)(\D*)$/.exec(text.trim())
  if (match === null) return null
  const value = Number((match[2] ?? "").replaceAll(",", ""))
  if (!Number.isFinite(value)) return null
  return {
    prefix: match[1] ?? "",
    suffix: match[4] ?? "",
    value,
    places: match[3]?.length ?? 0,
  }
}

const timing = { duration: duration.roll + 160, easing: easing.roll }

function countUp(element: HTMLElement, figure: Figure): void {
  const flow = new NumberFlow()
  flow.locales = "en-US"
  flow.format = {
    minimumFractionDigits: figure.places,
    maximumFractionDigits: figure.places,
  }
  flow.numberPrefix = figure.prefix
  flow.numberSuffix = figure.suffix
  flow.transformTiming = timing
  flow.spinTiming = timing
  flow.setAttribute("aria-hidden", "true")
  Object.assign(flow.style, {
    position: "absolute",
    left: "0",
    top: "0",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    color: getComputedStyle(element).color,
  })
  element.style.position = "relative"
  element.style.color = "transparent"
  element.appendChild(flow)
  flow.update(0)
  // Centre the digits on the text underneath, so removing them moves nothing.
  const under = element.getBoundingClientRect()
  const over = flow.getBoundingClientRect()
  flow.style.top = `${under.top + under.height / 2 - (over.top + over.height / 2)}px`
  requestAnimationFrame(() =>
    requestAnimationFrame(() => flow.update(figure.value)),
  )
  setTimeout(() => {
    flow.remove()
    element.style.color = ""
    element.style.position = ""
  }, timing.duration + 400)
}

function arm(element: HTMLElement): void {
  const key = element.dataset.countUp ?? ""
  const figure = parseFigure(element.textContent ?? "")
  if (counted.has(key) || figure === null || figure.value === 0) return
  markCounted(key)
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      // Read again: the value may have changed while it was off screen.
      const now = parseFigure(element.textContent ?? "")
      if (element.isConnected && now !== null) countUp(element, now)
    },
    { threshold: 0.6 },
  )
  observer.observe(element)
}

function armWithin(node: Node): void {
  if (!(node instanceof HTMLElement)) return
  if (node.dataset.countUp !== undefined) arm(node)
  for (const element of node.querySelectorAll<HTMLElement>("[data-count-up]")) {
    arm(element)
  }
}

/**
 * Counts up every `data-count-up` headline as it comes into view, now and
 * on later client navigations. Call once, when the page is idle.
 */
export function watchCountUps(): void {
  if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
    return
  }
  armWithin(document.body)
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) armWithin(node)
    }
  }).observe(document.body, { childList: true, subtree: true })
}
