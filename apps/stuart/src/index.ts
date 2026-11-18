import { createStuartApp } from "./app"

// matchbox-stuart Worker entry. The RateLimiter Durable Object class must be
// exported from the entry for its binding (wrangler.jsonc).
export { RateLimiter } from "@matchbox/server/rate-limiter"

export default createStuartApp()
