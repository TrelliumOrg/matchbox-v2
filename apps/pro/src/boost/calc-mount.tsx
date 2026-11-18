import { useRouter, useSearch } from "@tanstack/react-router"
import { lazy, type ReactNode, Suspense, useRef } from "react"
import type { CalcSearch } from "./calc-link"

const BoostCalculator = lazy(() => import("./boost-calculator"))

/** Starts loading the calculator. Safe to call on every hover. */
export function loadCalculator(): void {
  void import("./boost-calculator")
}

/**
 * In the shell on every page. The calculator is open while the URL says so
 * (`?calc=1`, see `calc-link`), so a link opens it filled, Back closes it,
 * and it survives a reload. Its code loads on first open.
 */
export function CalcMount(): ReactNode {
  const search = useSearch({ from: "__root__" })
  const router = useRouter()
  const open = search.calc !== undefined
  // The link's fill, kept while the sheet slides out after `calc` is gone.
  const fill = useRef<CalcSearch>({})
  const seen = useRef(false)
  if (open) {
    fill.current = search
    seen.current = true
  }
  if (!seen.current) return null
  return (
    <Suspense fallback={null}>
      <BoostCalculator
        // A new link is a new calculation.
        key={`${fill.current.vebtc ?? ""}|${fill.current.vemezo ?? ""}|${fill.current.for ?? ""}|${fill.current.solve ?? ""}`}
        open={open}
        fill={fill.current}
        onClose={() => {
          void router.navigate({
            to: ".",
            // Without the calculator's keys: what closing it leaves.
            search: ({ address }) => (address === undefined ? {} : { address }),
            replace: true,
            resetScroll: false,
          })
        }}
      />
    </Suspense>
  )
}
