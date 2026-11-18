import { whenIdle } from "@matchbox/motion"
import {
  barInputId,
  openStuartSearch,
  useStuart,
  warmStuart,
} from "@matchbox/stuart-ui/launcher"
import {
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
} from "react"

/**
 * Stuart in Pro's shell: the Ctrl K bar, server rendered on every route
 * (fixed, so it never shifts layout), and on intent the panel and, on
 * phones, the search sheet. The bar owns Ctrl K and Cmd K.
 *
 * The bar's code is off the first-paint budget: the server renders its HTML
 * (so it is on screen at once), and the browser loads its code once the
 * page has loaded and gone idle, then hydrates it in place. Until then a
 * few lines here keep Ctrl K and Cmd K working: they focus the server
 * rendered input (phones open the sheet) and start the load.
 */

type Bar = ComponentType

let ready: Bar | null = null
let loading: Promise<Bar> | null = null

function loadBar(): Promise<Bar> {
  loading ??= import("./stuart-bar").then((module) => {
    ready = module.StuartBar
    return module.StuartBar
  })
  return loading
}

if (import.meta.env.SSR) void loadBar()

/** After the load event, once the page is idle (at most 1.5s later). */
function afterLoad(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  return new Promise((resolve) => {
    const idle = (): unknown => whenIdle(resolve, 1_500)
    if (document.readyState === "complete") idle()
    else window.addEventListener("load", idle, { once: true })
  })
}

const DeferredBar = lazy(() =>
  afterLoad()
    .then(loadBar)
    .then((component) => ({ default: component })),
)

const PanelLoader = lazy(() => import("./panel-loader"))
const SearchSheetLoader = lazy(() => import("./search-sheet-loader"))

function isPhone(): boolean {
  return window.matchMedia?.("(max-width: 767.98px)").matches === true
}

/** Ctrl K and Cmd K before the bar's own handler has loaded. */
function useEarlyShortcut(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (ready !== null) return
      if (event.key.toLowerCase() !== "k") return
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      event.preventDefault()
      warmStuart()
      void loadBar()
      if (isPhone()) {
        openStuartSearch()
        return
      }
      const input = document.getElementById(barInputId)
      if (input instanceof HTMLInputElement) input.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}

export function StuartMount(): ReactNode {
  const state = useStuart()
  useEarlyShortcut()
  // The server renders the resolved bar; the browser always renders the
  // same lazy wrapper, so the bar never remounts (and never loses focus)
  // when its code arrives mid-session.
  const Bar = import.meta.env.SSR ? (ready ?? DeferredBar) : DeferredBar
  return (
    <>
      <Suspense fallback={null}>
        <Bar />
      </Suspense>
      {state.wanted ? (
        <Suspense fallback={null}>
          <PanelLoader />
          <SearchSheetLoader open={state.searchOpen} />
        </Suspense>
      ) : null}
    </>
  )
}
