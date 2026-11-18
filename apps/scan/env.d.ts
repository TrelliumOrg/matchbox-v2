/// <reference path="../../packages/app-kit/src/env.d.ts" />

declare namespace Cloudflare {
  interface Env {
    /** "fixtures" serves bundled demo data, "api" reads the API Worker. */
    SCAN_DATA: string
    /**
     * Secret salt (at least 32 bytes) for the end-user key sent to the API
     * (a hash of the visitor's IP prefix). Without it, or shorter, no key
     * is sent, reads share the anonymous bucket and one line is logged.
     */
    BLOCKSCOUT_CALLER_SALT?: string
    /**
     * Fixtures mode only: how long each recorded Blockscout read takes, so
     * the loader timing gate catches reads made one after another.
     */
    SCAN_FIXTURE_LATENCY_MS?: string
  }
}

interface ImportMetaEnv {
  /** Matchscan's WalletConnect project; without it the drawer has no WalletConnect row. */
  readonly VITE_WALLET_CONNECT_PROJECT_ID?: string
}

/** Set per build by vite.config.ts; part of the page cache key. */
declare const __SCAN_BUILD_ID__: string
