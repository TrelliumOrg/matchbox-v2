import { createFeedbackApp, defaultDeps } from "./app"
import type { FeedbackBindings } from "./env"
import { runSweep } from "./sweep"

// matchbox-feedback Worker entry. The RateLimiter Durable Object class must
// be exported from the entry for its binding (wrangler.jsonc).
export { RateLimiter } from "@matchbox/server/rate-limiter"

const app = createFeedbackApp()

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runSweep(env, defaultDeps).then(() => undefined))
  },
} satisfies ExportedHandler<FeedbackBindings>
