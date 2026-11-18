import { createServerFn } from "@tanstack/react-start"
import type { HomeFigures } from "./figures"
import { getHomeFigures, loadSeed } from "./figures.server"

/**
 * The page's loader: the last snapshot, never an upstream wait. It runs on
 * the homepage Worker, which reads the API Worker over the `API` binding,
 * so the browser never talks to `/internal/*` and never downloads zod.
 */
export const getSeed = createServerFn({ method: "GET" }).handler(
  function getSeedHandler() {
    return loadSeed()
  },
)

/** The browser's fresh request after first paint, and every refresh after. */
export const getFreshFigures = createServerFn({ method: "GET" }).handler(
  function getFreshFiguresHandler(): Promise<HomeFigures> {
    return getHomeFigures({ fresh: true })
  },
)
