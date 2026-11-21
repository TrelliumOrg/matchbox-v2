import {
  enterMs,
  prefersReducedMotion,
  Skeleton,
  SkeletonProvider,
} from "@matchbox/motion"
import { useRouter } from "@tanstack/react-router"
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
  // Skullet's inline boot script runs under the page's strict script-src
  // only with this response's nonce (see routes/__root.tsx).
  const nonce = useRouter().options.ssr?.nonce
  // The server cannot know the theme. The provider always writes the light
  // colours, so its style hydrates as the server sent it (a dark style in
  // the client threw React error 418, 19 Nov 2026), and the dark presets
  // override them in styles.css, from the first paint.
  return (
    <div ref={revealSuccessor} className="contents">
      <SkeletonProvider
        mode="light"
        {...(nonce === undefined ? {} : { nonce })}
      >
        <Skeleton id={id} label={label} loading>
          {sample}
        </Skeleton>
      </SkeletonProvider>
    </div>
  )
}
