import { createServerFn } from "@tanstack/react-start"
import { signingNote } from "./uptime.server"

/**
 * The blocks page's signing note as a server function. Its work is in
 * uptime.server; this module stays light so the browser keeps only the RPC
 * stub. The validators pages read uptime in their own loaders.
 */

export type { SigningNote } from "./uptime.server"
export type {
  StripBlock,
  UptimeFigures,
  UptimeFreshness,
  ValidatorUptimeView,
} from "./uptime-views"

export const getSigningNote = createServerFn({ method: "GET" }).handler(() =>
  signingNote(),
)
