declare namespace Cloudflare {
  interface Env {
    /** "fixtures" serves the bundled Epoch 47 demo data, "api" reads the API Worker. */
    PRO_DATA: string
    /** Used when the API service binding is missing (local dev against a deployed API). */
    API_ORIGIN: string
    /** Shared secret for the API Worker's internal routes. */
    INTERNAL_TOKEN?: string
    /**
     * Salt for the end-user key sent to the API (X-Matchbox-End-User), at
     * least 32 bytes; a wrangler secret. Without it every visitor shares
     * Pro's anonymous rate-limit bucket.
     */
    BLOCKSCOUT_CALLER_SALT?: string
    API?: Fetcher
    /** Public Mezo RPC the browser polls for eth_blockNumber when the BlockHub socket drops. */
    MEZO_RPC_URL?: string
    /**
     * "report-only" sends the Content Security Policy as report-only
     * (framing stays enforced) and logs each violation the browser reports
     * (csp-report.server): the switch for a wallet the policy breaks.
     * "enforce" or unset, it is enforced.
     */
    PRO_CSP?: string
  }
}
