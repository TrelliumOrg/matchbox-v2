type MatchboxIdWorkerEnv = import("./src/worker/config").WorkerEnv

declare namespace Cloudflare {
  // The OIDC server's bindings and vars (src/worker/config.ts).
  interface Env extends MatchboxIdWorkerEnv {}
}
