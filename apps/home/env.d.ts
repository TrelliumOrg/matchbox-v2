/// <reference path="../../packages/app-kit/src/env.d.ts" />

/** This build's id (vite.config.ts), in the figures snapshot's cache key. */
declare const __HOME_BUILD_ID__: string

declare namespace Cloudflare {
  interface Env {
    /** "fixtures" serves bundled figures, "api" reads the API Worker. */
    HOME_DATA: string
  }
}
