type MatchboxConsoleWorkerEnv = import("./src/worker/env").WorkerBindings

declare namespace Cloudflare {
  // The console server's bindings and vars (src/worker/env.ts).
  interface Env extends MatchboxConsoleWorkerEnv {
    /** Where Classic's /docs URLs redirect (src/lib/docs-redirect.ts). */
    DOCS_ORIGIN?: string
  }
}
