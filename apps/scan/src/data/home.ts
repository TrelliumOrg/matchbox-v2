import { createServerFn } from "@tanstack/react-start"
import { setCacheClass } from "../cache-class.server"
import { homePage } from "./home.server"

/**
 * Home's live sections. The work is in home.server; this module stays
 * light so the browser keeps only the RPC stub.
 */

export type { HomePage } from "./home.server"
export type { HomeGauge, HomeTile } from "./scan/home-views"

export const getHome = createServerFn({ method: "GET" }).handler(
  function getHomeHandler() {
    setCacheClass("list")
    return homePage()
  },
)
