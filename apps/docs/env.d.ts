declare namespace Cloudflare {
  interface Env {
    /** The static assets: every page, chunk and file the build wrote. */
    ASSETS: Fetcher
  }
}

/** Set per build by vite.config.ts: the prerender crawler's token. */
declare const __DOCS_PRERENDER_TOKEN__: string

/** Set per build by vite.config.ts from VITE_STUART_URL, or null. */
declare const __DOCS_STUART_ORIGIN__: string | null
