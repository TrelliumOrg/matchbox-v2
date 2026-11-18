// Entry for the Workers test runtime: exports the Durable Objects under test.
export { RateLimiter } from "@matchbox/server/rate-limiter"
export { BlockHub } from "../src/heads/block-hub"

export default {
  fetch(): Response {
    return new Response("matchbox-api test entry")
  },
}
