import {
  enterMs,
  prefersReducedMotion,
  Skeleton,
  SkeletonProvider,
} from "@matchbox/motion"
import { isDarkPreset } from "@matchbox/tokens"
import type { ReactNode } from "react"
import type { LoadingProps } from "./loading"

/**
 * When the skeleton goes, whatever took its place in the same parent fades
 * in (opacity only; it fills the space the skeleton held, so nothing
 * shifts). Runs before the content's first paint.
 */
function revealSuccessor(
  element: HTMLElement | null,
): (() => void) | undefined {
  const parent = element?.parentElement ?? null
  if (parent === null) return
  const before = new Set(parent.children)
  return () => {
    if (prefersReducedMotion()) return
    requestAnimationFrame(() => {
      for (const child of parent.children) {
        if (before.has(child)) continue
        child.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: enterMs,
          easing: "ease-out",
        })
      }
    })
  }
}

export default function LoadingImpl({
  id,
  label,
  sample,
}: LoadingProps): ReactNode {
  const painted =
    typeof document === "undefined"
      ? null
      : document.documentElement.getAttribute("data-theme")
  const mode = isDarkPreset(painted) ? "dark" : "light"
  return (
    <div ref={revealSuccessor} className="contents">
      <SkeletonProvider mode={mode}>
        <Skeleton id={id} label={label} loading>
          {sample}
        </Skeleton>
      </SkeletonProvider>
    </div>
  )
}
