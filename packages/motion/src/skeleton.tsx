import type { ReactNode } from "react"
import { SkulletProvider } from "skullet/react"

export { forgetShapes } from "skullet"
export {
  Skeleton,
  SkeletonBox,
  type SkeletonBoxProps,
  type SkeletonProps,
  SkeletonSuspense,
  type SkeletonSuspenseProps,
} from "skullet/react"

/** Provider theme from the guideline's Build notes and `matchbox-themes`. */
export const skeletonTheme = {
  light: { base: "rgb(14 15 12 / .07)", highlight: "rgb(255 255 255 / .6)" },
  dark: { base: "rgb(244 244 242 / .08)", highlight: "rgb(244 244 242 / .1)" },
  radius: "6px",
  animation: "shimmer",
  speed: "slow",
} as const

export type SkeletonProviderProps = {
  /** Follows the resolved theme's mode. */
  mode: "light" | "dark" | "system"
  nonce?: string
  children: ReactNode
}

/**
 * Wrap the app once. Every loading state is a `Skeleton` with `data`,
 * `sample`, an `id` and a `label`. Call `forgetShapes()` on sign-out.
 */
export function SkeletonProvider({
  mode,
  nonce,
  children,
}: SkeletonProviderProps): ReactNode {
  return (
    <SkulletProvider
      theme={skeletonTheme}
      mode={mode}
      reveal="smart"
      {...(nonce === undefined ? {} : { nonce })}
    >
      {children}
    </SkulletProvider>
  )
}

SkeletonProvider.displayName = "SkeletonProvider"
