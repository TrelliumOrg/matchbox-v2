// The feedback Worker's origin, from VITE_FEEDBACK_URL (the variable every
// surface builds with) in the environment or an .env file. The page CSP
// (scripts/postbuild.mjs) reads it here; the header's Feedback entry reads
// the same variable. Unset, the docs build has no Feedback entry and the
// CSP allows nothing for it.
import { fileURLToPath } from "node:url"
import { loadEnv } from "vite"

const appRoot = fileURLToPath(new URL("..", import.meta.url))

/** Turnstile: the panel's check loads its script and frame from here. */
export const turnstileOrigin = "https://challenges.cloudflare.com"

export function feedbackOrigin(mode = "production") {
  const value = loadEnv(mode, appRoot, "VITE_").VITE_FEEDBACK_URL ?? ""
  if (value.trim() === "") return null
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(`VITE_FEEDBACK_URL is not a URL: ${value}`)
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1"
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("VITE_FEEDBACK_URL must be https, or http on localhost")
  }
  return url.origin
}
