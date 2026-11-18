import {
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  type Ref,
} from "react"

/**
 * `asChild` support: renders the only child with the slot's props merged in
 * (classes joined, styles spread, handlers composed child first, refs
 * combined). A few lines in place of Radix Slot on every route.
 */

type SlotProps = Record<string, unknown> & { children?: ReactNode }

function isHandler(
  key: string,
  value: unknown,
): value is (...args: unknown[]) => void {
  return /^on[A-Z]/.test(key) && typeof value === "function"
}

function mergeRefs(...refs: unknown[]): Ref<unknown> {
  return (node: unknown) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node)
      else if (typeof ref === "object" && ref !== null && "current" in ref) {
        Reflect.set(ref, "current", node)
      }
    }
  }
}

export function Root({ children, ...slot }: SlotProps): ReactNode {
  const child = Children.only(children)
  if (!isValidElement<Record<string, unknown>>(child)) return null
  const own = child.props
  const merged: Record<string, unknown> = { ...slot, ...own }
  for (const [key, value] of Object.entries(slot)) {
    const theirs = own[key]
    if (isHandler(key, value) && isHandler(key, theirs)) {
      merged[key] = (...args: unknown[]) => {
        theirs(...args)
        value(...args)
      }
    } else if (key === "className" && typeof theirs === "string") {
      merged.className = `${String(value ?? "")} ${theirs}`
    } else if (
      key === "style" &&
      typeof theirs === "object" &&
      theirs !== null
    ) {
      merged.style =
        typeof value === "object" && value !== null
          ? { ...value, ...theirs }
          : theirs
    } else if (key === "ref" && theirs !== undefined) {
      merged.ref = mergeRefs(value, theirs)
    }
  }
  return cloneElement(child, merged)
}

Root.displayName = "Slot"
