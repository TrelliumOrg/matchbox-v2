import { lazy, type ReactNode, Suspense } from "react"

/**
 * Every loading state is a Skullet skeleton measured from a sample render,
 * with an id so the shape is remembered across visits. Skullet loads only
 * when something is loading, so it never weighs on a server-rendered first
 * paint. Until it arrives the sample holds the exact space, invisibly.
 */

const SkeletonImpl = lazy(() => import("./loading-impl"))

export type LoadingProps = {
  id: string
  /** Read to screen readers while loading, for example "Loading rewards". */
  label: string
  /** The screen rendered from sample data. */
  sample: ReactNode
}

export function Loading({ id, label, sample }: LoadingProps): ReactNode {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-busy="true"
          aria-label={label}
          className="invisible"
        >
          {sample}
        </div>
      }
    >
      <SkeletonImpl id={id} label={label} sample={sample} />
    </Suspense>
  )
}
