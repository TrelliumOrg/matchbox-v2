import { createServerFn } from "@tanstack/react-start"
import { loadShell } from "./shell.server"

/**
 * The root loader's server function. It runs on the Scan Worker, which
 * reads the API Worker over the `API` binding, so the browser never talks
 * to `/internal/*` and never downloads zod.
 */
export const getShell = createServerFn({ method: "GET" }).handler(
  function getShellHandler() {
    return loadShell()
  },
)
