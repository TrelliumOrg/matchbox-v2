// Stuart's origin for "Ask about this page", from VITE_STUART_URL (the same
// variable Pro builds with) in the environment or an .env file. The client
// bundle (vite.config.ts) and the page CSP's connect-src
// (scripts/postbuild.mjs) both read it here, so they always agree. Unset,
// the docs build has no Stuart and the button opens search instead.
import { fileURLToPath } from "node:url"
import { loadEnv } from "vite"

const appRoot = fileURLToPath(new URL("..", import.meta.url))

export function stuartOrigin(mode = "production") {
  const value = loadEnv(mode, appRoot, "VITE_").VITE_STUART_URL ?? ""
  if (value.trim() === "") return null
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(`VITE_STUART_URL is not a URL: ${value}`)
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1"
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("VITE_STUART_URL must be https, or http on localhost")
  }
  return url.origin
}
