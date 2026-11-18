import { feedbackLimits } from "@matchbox/contracts/feedback"

/**
 * Screenshots, only when the user asks for one. The capture library loads
 * on that first ask. It draws what the user sees (the viewport at its
 * scroll position), without the feedback panel, with every typed field
 * blacked out, and never leaves the device until the report is sent.
 *
 * A screen opts out with `data-feedback="no-capture"` on any element
 * (`data-feedback-reason` says why, in one line). An element marked
 * `data-feedback="mask"` is blacked out like a field.
 */

const maskedSelector =
  'textarea, select, [contenteditable=""], [contenteditable="true"], [data-feedback="mask"]'

/** Why screenshots are not offered on this screen, or null. */
export function pageBlocksCapture(doc: Document): string | null {
  const marked = doc.querySelector('[data-feedback="no-capture"]')
  if (marked === null) return null
  return marked.getAttribute("data-feedback-reason") ?? "It shows private data"
}

function isTypedInput(element: Element): boolean {
  if (!(element instanceof HTMLInputElement)) return false
  return ![
    "checkbox",
    "radio",
    "button",
    "submit",
    "reset",
    "hidden",
    "range",
    "color",
    "image",
  ].includes(element.type)
}

function hasText(element: Element): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return element.value !== "" || (element.getAttribute("value") ?? "") !== ""
  }
  if (element instanceof HTMLSelectElement) return element.value !== ""
  return (element.textContent ?? "").trim() !== ""
}

/** Marks read in the clone, set on the live page and removed afterwards. */
const shiftAttribute = "data-feedback-shift"
const hideAttribute = "data-feedback-hide"

/** True for a matrix whose first column points backwards (a half turn). */
function turnedAway(style: CSSStyleDeclaration): boolean {
  if (style.backfaceVisibility !== "hidden") return false
  const first = /matrix(?:3d)?\(\s*(-?[\d.e+-]+)/.exec(style.transform)?.[1]
  return first !== undefined && Number(first) < 0
}

/**
 * The capture library writes each element's computed style into classes,
 * so what the clone needs is decided here, on the live page:
 *
 * - The page is drawn from its top and moved up by the scroll. A sticky
 *   element that is stuck would move with it, so it gets the offset that
 *   keeps it where the user sees it. (Fixed elements need nothing: they
 *   keep to the drawing's viewport.)
 * - The back face of a flip card (backface-visibility hidden, turned half
 *   a revolution) is invisible on the page, but would be drawn mirrored
 *   over the front.
 */
function markPage(root: HTMLElement, exclude: Element): Element[] {
  const marked: Element[] = []
  for (const element of root.querySelectorAll("*")) {
    if (exclude.contains(element)) continue
    const style = getComputedStyle(element)
    if (turnedAway(style)) {
      element.setAttribute(hideAttribute, "")
      marked.push(element)
    } else if (style.position === "sticky" && element instanceof HTMLElement) {
      const stuck = element.getBoundingClientRect()
      // Measured unstuck and restored in the same task: nothing paints.
      const inline = element.style.position
      element.style.position = "relative"
      const natural = element.getBoundingClientRect()
      element.style.position = inline
      const dx = stuck.left - natural.left
      const dy = stuck.top - natural.top
      if (dx !== 0 || dy !== 0) {
        element.setAttribute(shiftAttribute, `${dx} ${dy}`)
        marked.push(element)
      }
    }
  }
  return marked
}

/**
 * Applies the marks to a cloned element. The library writes each computed
 * value inline, `visibility: visible` on every descendant included, so a
 * face is hidden with opacity, and a stuck element is moved with
 * `translate`, which renders where a relative offset did not.
 */
function applyMarks(element: HTMLElement): void {
  if (element.hasAttribute(hideAttribute)) {
    element.removeAttribute(hideAttribute)
    element.style.opacity = "0"
  }
  const shift = element.getAttribute(shiftAttribute)
  if (shift !== null) {
    element.removeAttribute(shiftAttribute)
    const [dx, dy] = shift.split(" ").map(Number)
    element.style.position = "relative"
    element.style.translate = `${dx ?? 0}px ${dy ?? 0}px`
  }
}

function mask(element: HTMLElement): void {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    element.value = ""
    element.setAttribute("value", "")
    element.setAttribute("placeholder", "")
  }
  if (element instanceof HTMLTextAreaElement) element.textContent = ""
  element.style.color = "transparent"
  element.style.backgroundColor = "#000"
  element.style.backgroundImage = "none"
  for (const child of element.querySelectorAll<HTMLElement>("*")) {
    child.style.visibility = "hidden"
  }
}

export type Capture = { blob: Blob; preview: string; masked: number }

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => {
      const result: unknown = reader.result
      if (typeof result === "string") resolve(result)
      else reject(new Error("No preview"))
    })
    reader.addEventListener("error", () => reject(new Error("No preview")))
    reader.readAsDataURL(blob)
  })
}

/** Captures the viewport, leaving out `exclude` (the panel). */
export async function captureViewport(exclude: Element): Promise<Capture> {
  const { domToBlob } = await import("modern-screenshot")
  const body = document.body
  const marked = markPage(body, exclude)
  let masked = 0
  const options = {
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
    scale: Math.min(window.devicePixelRatio || 1, 2),
    backgroundColor: getComputedStyle(body).backgroundColor,
    timeout: 15_000,
    // A negative margin, not a transform: a transform would carry fixed
    // bars along with the page. The open panel locks the page's scroll
    // (overflow hidden on <body>), which would clip the drawing.
    style: {
      marginTop: `${-window.scrollY}px`,
      marginLeft: `${-window.scrollX}px`,
      overflow: "visible",
      height: "auto",
    },
    filter: (node: Node) =>
      !(node instanceof Element && exclude.contains(node)),
    onCloneEachNode: (cloned: Node) => {
      if (!(cloned instanceof HTMLElement)) return
      applyMarks(cloned)
      // A field with text is blacked out; an empty one keeps its
      // placeholder, which the page wrote, not the user.
      if (
        (cloned.matches(maskedSelector) || isTypedInput(cloned)) &&
        hasText(cloned)
      ) {
        masked += 1
        mask(cloned)
      }
    },
  }
  try {
    let blob = await domToBlob(body, { ...options, type: "image/png" })
    if (blob.size > feedbackLimits.screenshotBytes) {
      masked = 0
      blob = await domToBlob(body, {
        ...options,
        type: "image/jpeg",
        quality: 0.85,
      })
    }
    if (blob.size > feedbackLimits.screenshotBytes) {
      throw new Error("Screenshot over 5 MB")
    }
    return { blob, preview: await dataUrlOf(blob), masked }
  } finally {
    for (const element of marked) {
      element.removeAttribute(shiftAttribute)
      element.removeAttribute(hideAttribute)
    }
  }
}

/** An image the user attached instead: PNG, JPEG or WebP up to 5 MB. */
export async function attachedImage(
  file: File,
): Promise<{ blob: Blob; preview: string } | null> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > feedbackLimits.screenshotBytes ||
    file.size === 0
  ) {
    return null
  }
  return { blob: file, preview: await dataUrlOf(file) }
}
